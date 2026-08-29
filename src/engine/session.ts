import {
  expectedToken,
  isMoraToken,
  settledToken,
  initMatch,
  legalNext,
  stepMatch,
  stepWithRecovery,
  type MatchState,
  type RecoveryStep,
  type RomajiToken,
} from './romanization'
import type { Lesson, MoraTimingStat, RunResult, TimingStat } from './types'

/** One keystroke, kept in order so backspace can undo and the line can be drawn. */
export type TypedKey = {
  char: string
  /** False when it extended no accepted spelling — drawn red, still advanced. */
  correct: boolean
}

export type SessionState = {
  keys: TypedKey[]
  /** Live matcher configuration over the lesson's tokens. */
  match: MatchState
  /**
   * Cumulative keystroke counters. They never decrease, so backspacing a
   * character doesn't erase the fact that it was typed — raw speed and accuracy
   * are about what you did, not about what survived.
   */
  attempts: number
  mistakes: number
  startedAt: number | null
  finishedAt: number | null
  keyStats: Record<string, TimingStat>
  bigramStats: Record<string, TimingStat>
  /**
   * Per-mora timing and accuracy — the basis for knowing which kana are weak.
   * Distinct from `keyStats` because the two answer different questions: `h`
   * being slow says nothing about whether し or ひ is the problem, and a miss
   * mid-mora often has no single key to blame while always having a kana.
   *
   * One `attempt` is one encounter with the mora, not one keystroke. Counting
   * keystrokes divided the error rate by the length of the spelling, so the same
   * single fumble scored あ at 50% and しゃ at 25% — ranking the harder kana as
   * the easier one.
   */
  kanaStats: Record<string, MoraTimingStat>
  /**
   * The mora being typed and what it has cost so far, held until the cursor
   * moves off it. Keyed by token index because ここ is two encounters with こ.
   *
   * `timed` is what decides whether this encounter's duration is usable at all.
   * It goes false when any keystroke of the mora had no measurable interval, and
   * when the parse was ambiguous while the mora was in progress — see
   * `timingBlocked`. The encounter still counts as an attempt and still records
   * a miss; only its clock is thrown away.
   */
  pendingKana: {
    index: number
    kana: string
    ms: number
    missed: boolean
    keystrokes: number
    timed: boolean
  } | null
  intervals: number[]
  /**
   * Intervals from clean keystrokes only, the sample the run's baseline cadence
   * is taken from. Misses are excluded because the interval after one measures
   * recovery, which would raise the baseline and quietly forgive every mora.
   */
  cleanIntervals: number[]
  /**
   * Set while the matcher cannot say which mora a keystroke belongs to, and read
   * by the *next* mora to open.
   *
   * At an ん boundary the interval is genuinely unattributable in advance: in
   * `nna` the second `n` opens な, but in `nnna` it belongs to ん and the third
   * opens な, and which one is true is not known until a later key kills a
   * branch. Rather than follow the branches, the encounters either side of the
   * ambiguity give up their timing — an omission, not a guess. Attempts and
   * misses survive, so the error signal, which is the primary one, is untouched.
   */
  timingBlocked: boolean
  /**
   * A miss that belongs to a mora which has not opened yet, held until it does.
   *
   * At a mora boundary the cursor has finished one mora and not started the
   * next, so the miss belongs to neither the pending encounter nor any encounter
   * that exists — `expectedToken` names the mora being *started*, and that is
   * what the screen tells the typist. Marking the pending mora instead charged
   * the fumble to the one they had just typed correctly.
   */
  carriedMiss: boolean
  /**
   * Characters typed in passages already finished within this run.
   *
   * A run and a passage used to be the same thing, so `keys` was both the line
   * on screen and the run's whole character count. A timed run outlives its
   * passage: when one is exhausted the matcher and the visible line reset while
   * the run keeps going, and what the finished passage contributed has to
   * survive that reset somewhere. `keys` stays passage-local, so the display and
   * backspace deal only with what is actually on screen.
   */
  completedChars: number
  /** The correct half of `completedChars`, which is what net WPM counts. */
  completedCorrectChars: number
  /** Timestamp of the last committed keystroke, right or wrong. */
  lastKeyAt: number | null
  /**
   * The key that was just refused, in stop-on-error mode. Cleared by the next
   * accepted keystroke. Nothing was consumed, so there is no red character in
   * the line to mark — the character being waited on is marked instead.
   */
  rejected: string | null
}

export type TypeResult = {
  session: SessionState
  completed: boolean
  /**
   * Set on a wrong keystroke. `legal` is the full set of characters that would
   * have been accepted — after `s` on し that's genuinely both `h` and `i`, and
   * blaming one of them would make the stats an artefact of display order.
   */
  missed?: {
    legal: string[]
    typed: string
    /** The mora that was being typed, when exactly one was. */
    kana: string | null
  }
}

export type SessionMetrics = {
  wpm: number
  rawWpm: number
  accuracy: number
  consistency: number
  elapsedMs: number
}

/**
 * Longest gap between keystrokes still counted as typing. Anything above this
 * is a pause (thinking, looking away) and would otherwise swamp the per-key
 * timings and the consistency variance.
 */
const PAUSE_CAP_MS = 3000

export function emptySession(): SessionState {
  return {
    keys: [],
    match: initMatch(),
    attempts: 0,
    mistakes: 0,
    startedAt: null,
    finishedAt: null,
    keyStats: {},
    bigramStats: {},
    kanaStats: {},
    pendingKana: null,
    intervals: [],
    cleanIntervals: [],
    timingBlocked: false,
    carriedMiss: false,
    lastKeyAt: null,
    rejected: null,
    completedChars: 0,
    completedCorrectChars: 0,
  }
}

/**
 * Records one attempt, and its duration only if there was one to record.
 *
 * A null `ms` is an unobserved interval, not an instant keystroke: the first key
 * of a run has no predecessor to measure against, and `applyBackspace` clears
 * `lastKeyAt` deliberately so the key after an edit has none either. Counted as
 * zero they dragged every average down, and a key pressed only in those
 * positions reported itself as infinitely fast.
 */
function updateStat(
  stats: Record<string, TimingStat>,
  key: string,
  ms: number | null,
  miss: boolean,
): Record<string, TimingStat> {
  const stat = stats[key] ?? { attempts: 0, misses: 0, totalMs: 0, timingSamples: 0 }
  const samples = stat.timingSamples ?? stat.attempts
  return {
    ...stats,
    [key]: {
      attempts: stat.attempts + 1,
      misses: stat.misses + (miss ? 1 : 0),
      totalMs: stat.totalMs + (ms ?? 0),
      timingSamples: samples + (ms === null ? 0 : 1),
    },
  }
}

/**
 * Banks one encounter with a mora.
 *
 * Duration is kept only for encounters that were both cleanly timed and
 * mistake-free. After a miss the elapsed time is recovery time, and counting it
 * would charge the same fumble twice — once to the error rate and again to the
 * latency — making an already-weak mora look weak on a second axis it never
 * failed on.
 */
function updateMoraStat(
  stats: Record<string, MoraTimingStat>,
  pending: NonNullable<SessionState['pendingKana']>,
): Record<string, MoraTimingStat> {
  const stat = stats[pending.kana] ?? {
    attempts: 0,
    misses: 0,
    totalMs: 0,
    timingSamples: 0,
    keystrokes: 0,
  }
  const usable = pending.timed && !pending.missed
  return {
    ...stats,
    [pending.kana]: {
      attempts: stat.attempts + 1,
      misses: stat.misses + (pending.missed ? 1 : 0),
      totalMs: stat.totalMs + (usable ? pending.ms : 0),
      timingSamples: (stat.timingSamples ?? stat.attempts) + (usable ? 1 : 0),
      keystrokes: (stat.keystrokes ?? 0) + (usable ? pending.keystrokes : 0),
    },
  }
}

/**
 * A step that refuses a wrong key instead of substituting for it. Shaped like a
 * `RecoveryStep` so the rest of `applyTypeChar` doesn't care which mode it is
 * in; `consumed` is what separates them.
 */
function rejectingStep(
  tokens: RomajiToken[],
  match: MatchState,
  char: string,
): RecoveryStep & { consumed: boolean } {
  const exact = stepMatch(tokens, match, char)
  if (exact.ok) {
    return { state: exact.state, correct: true, legal: [], done: exact.done, consumed: true }
  }
  return {
    state: match,
    correct: false,
    legal: legalNext(tokens, match),
    done: false,
    consumed: false,
  }
}

/**
 * The key a keystroke is scored against. A correct keystroke is scored against
 * itself. A wrong one is scored against what was expected — but only when
 * exactly one character was legal; an ambiguous context (`h` or `i`) has no
 * single key to blame, so it's left out of the per-key table rather than
 * smeared across every candidate.
 */
function scoredKey(char: string, correct: boolean, legal: string[]): string | null {
  if (correct) return char
  return legal.length === 1 ? legal[0] : null
}

/**
 * Commits one keystroke.
 *
 * Two ways to treat a wrong one, and the choice is the typist's:
 *
 * **stop-on-error** (default) refuses the key. Nothing is consumed, the cursor
 * holds, and the character being waited on is marked until a legal key arrives.
 * This is what every Japanese typing site does, and the reason is that romaji
 * input is compositional — you are assembling a kana, not filling a slot. A key
 * that half-assembles nothing leaves the typist mid-mora with no way to see what
 * state they are in.
 *
 * **advance-on-error** treats it as an ordinary keystroke: drawn red, cursor
 * moves on, consuming one edge in every direction that was legal. Familiar from
 * English typing tests, where a wrong letter substitutes cleanly for a right one
 * because the text is a fixed grid of characters.
 */
export function applyTypeChar(
  state: SessionState,
  rawChar: string,
  tokens: RomajiToken[],
  now: number,
  stopOnError = true,
): TypeResult {
  if (state.finishedAt !== null) return { session: state, completed: false }
  if (rawChar.length !== 1 || tokens.length === 0) return { session: state, completed: false }

  const char = rawChar.toLowerCase()
  const step = stopOnError
    ? rejectingStep(tokens, state.match, char)
    : { ...stepWithRecovery(tokens, state.match, char), consumed: true }
  const startedAt = state.startedAt ?? now
  // Null where there is nothing to measure against: the first key of a run, and
  // the first after a backspace, which clears `lastKeyAt` on purpose. Clamped at
  // both ends otherwise. The upper bound is the pause cap; the lower bound
  // matters because `now` comes from a wall clock that can step backwards (an
  // NTP correction, a manual change), and a negative interval poisoned the
  // timing totals and the elapsed time with it.
  const interval =
    state.lastKeyAt === null ? null : Math.max(0, Math.min(PAUSE_CAP_MS, now - state.lastKeyAt))

  const key = scoredKey(char, step.correct, step.legal)
  const previous = state.keys[state.keys.length - 1]
  const keyStats = key === null ? state.keyStats : updateStat(state.keyStats, key, interval, !step.correct)

  /*
   * Charged to the mora being typed, accumulated across its keystrokes and
   * banked when the cursor leaves it — so one attempt is one encounter.
   *
   * Attribution reads the state *after* the keystroke, not before. Before it,
   * ん followed by anything is ambiguous: the next key could extend ん to `nn`
   * or open the following mora. Attributing on that pre-state discarded every
   * keystroke at such a boundary, which meant んあ recorded ん and lost あ
   * entirely — and せんせい, でんしゃ and 日本語 all contain one.
   */
  /*
   * The mora being typed when this key was pressed, captured before the state
   * moves on — so a miss is blamed on what the typist was working on rather than
   * on wherever the keystroke landed them.
   *
   * The pre-keystroke expectation leads, because it knows when the cursor has
   * finished a mora and is sitting at a separator, where there is nothing to
   * blame. Only when *that* is ambiguous — an ん boundary — does the mora in
   * progress answer instead, since the typist was mid-ん either way.
   */
  const expected = expectedToken(tokens, state.match)
  const wasOn =
    expected !== null
      ? (isMoraToken(expected.kana) ? expected.kana : null)
      : (state.pendingKana?.kana ?? null)

  /*
   * The same answer as `wasOn`, by token index rather than by name, so the table
   * can charge the miss to one encounter rather than to every occurrence of a
   * kana. These two must not diverge: `wasOn` is what the screen names as the
   * mora at fault, and anything the table charges instead is the model and the
   * UI disagreeing about what the typist got wrong.
   */
  const blameIndex =
    expected !== null
      ? (isMoraToken(expected.kana) ? expected.index : null)
      : (state.pendingKana?.index ?? null)

  const landed = settledToken(tokens, step.state)
  let kanaStats = state.kanaStats
  let pendingKana = state.pendingKana
  let timingBlocked = state.timingBlocked
  let carriedMiss = state.carriedMiss

  const bank = (pending: NonNullable<SessionState['pendingKana']>) =>
    updateMoraStat(kanaStats, pending)

  if (landed === null) {
    // Still undecided — keep accumulating against the mora we were already on,
    // but the clock is no longer trustworthy: this interval may belong to the
    // mora after it, and which is true depends on a branch not yet resolved.
    if (pendingKana !== null) {
      pendingKana = {
        ...pendingKana,
        ms: pendingKana.ms + (interval ?? 0),
        keystrokes: pendingKana.keystrokes + 1,
        missed: pendingKana.missed || (!step.correct && blameIndex === pendingKana.index),
        timed: false,
      }
    }
    timingBlocked = true
  } else {
    const trackable = isMoraToken(landed.kana)
    if (pendingKana !== null && (!trackable || pendingKana.index !== landed.index)) {
      kanaStats = bank(pendingKana)
      pendingKana = null
    }
    if (trackable) {
      pendingKana = {
        index: landed.index,
        kana: landed.kana,
        ms: (pendingKana?.ms ?? 0) + (interval ?? 0),
        missed:
          (pendingKana?.missed ?? false) ||
          (!step.correct && blameIndex === landed.index) ||
          // A fumble made at this mora's boundary, before it had opened.
          carriedMiss,
        keystrokes: (pendingKana?.keystrokes ?? 0) + 1,
        // A mora opening straight out of an ambiguous boundary has lost its
        // first interval to that ambiguity, so it is not cleanly timed either.
        timed: (pendingKana?.timed ?? true) && interval !== null && !timingBlocked,
      }
      carriedMiss = false
    }
    timingBlocked = false
  }

  // Blamed on a mora no encounter is holding yet — carry it to the one that
  // opens next. Repeated fumbles at the same boundary stay one miss, because one
  // encounter with a mora is one attempt however many keys it took to reach.
  if (!step.correct && blameIndex !== null && blameIndex !== (pendingKana?.index ?? null)) {
    carriedMiss = true
  }

  if (step.done && pendingKana !== null) {
    kanaStats = bank(pendingKana)
    pendingKana = null
  }

  // Clean transitions only. A pair measures how fast you move between two keys;
  // with a typo at either end it measures recovery instead, which is a different
  // quantity averaged into the same bucket. It also keeps the pair's name
  // honest — previously this paired the key actually pressed last with the key
  // that *should* have been pressed now, so a recorded "ab" might be neither.
  const bigramStats =
    step.correct && previous?.correct === true
      ? updateStat(state.bigramStats, previous.char + char, interval, false)
      : state.bigramStats

  const session: SessionState = {
    ...state,
    // A refused key is not part of the line — nothing was consumed, so there is
    // nothing to draw and nothing for backspace to take back.
    keys: step.consumed ? [...state.keys, { char, correct: step.correct }] : state.keys,
    rejected: step.consumed ? null : char,
    match: step.state,
    attempts: state.attempts + 1,
    mistakes: step.correct ? state.mistakes : state.mistakes + 1,
    startedAt,
    finishedAt: step.done ? now : null,
    keyStats,
    bigramStats,
    kanaStats,
    pendingKana,
    intervals: interval !== null && interval > 0 ? [...state.intervals, interval] : state.intervals,
    cleanIntervals:
      step.correct && interval !== null && interval > 0
        ? [...state.cleanIntervals, interval]
        : state.cleanIntervals,
    timingBlocked,
    carriedMiss,
    lastKeyAt: now,
  }

  return {
    session,
    ...(step.correct
      ? {}
      : { missed: { legal: step.legal, typed: char, kana: wasOn } }),
    completed: step.done,
  }
}

/**
 * Rebuilds the matcher by replaying the surviving keystrokes. The matcher has no
 * inverse — a configuration set can be reached from several predecessors — and
 * at lesson lengths (tens of characters) replay costs nothing, so it beats
 * carrying undo state that has to stay correct.
 */
export function matchFor(tokens: RomajiToken[], keys: readonly TypedKey[]): MatchState {
  let match = initMatch()
  for (const key of keys) {
    // Only consumed keys are in the log, and a consumed wrong key is by
    // definition a substitution — so replaying through the recovery step is
    // right in both modes.
    match = stepWithRecovery(tokens, match, key.char).state
  }
  return match
}

export function applyBackspace(state: SessionState, tokens: RomajiToken[]): SessionState {
  if (state.keys.length === 0 || state.finishedAt !== null) return state
  const keys = state.keys.slice(0, -1)
  // `lastKeyAt` is cleared so the next keystroke records no interval. Left set,
  // it timed the next key against one the edit removed: typing a, x, backspace,
  // i recorded an "ai" pair whose label came from the surviving keys and whose
  // duration came from x→i — a measurement of neither sequence.
  return {
    ...state,
    keys,
    match: matchFor(tokens, keys),
    lastKeyAt: null,
    rejected: null,
    pendingKana: null,
    timingBlocked: false,
    carriedMiss: false,
  }
}

/**
 * Ends the run now, wherever the typist happens to be.
 *
 * Passage mode never needed this: the run ended by reaching the last token, at a
 * point where the final mora had just been banked. A deadline lands anywhere —
 * frequently mid-mora — so the encounter in progress has to be resolved
 * deliberately rather than abandoned. Without that, a genuine miss made in the
 * last second simply disappears, which breaks the rule that what the screen
 * blamed is what the table records.
 *
 * The cutoff itself is never evidence: a mora interrupted while clean is not an
 * attempt at all, because stopping the clock says nothing about whether the
 * typist knew it. One that already carries a miss is a real encounter and is
 * banked as such — with no duration, since a truncated mora was never timed.
 */
export function finishRun(state: SessionState, endedAt: number): SessionState {
  if (state.finishedAt !== null) return state
  const pending = state.pendingKana
  const kanaStats =
    pending !== null && pending.missed
      ? updateMoraStat(state.kanaStats, { ...pending, timed: false })
      : state.kanaStats
  return {
    ...state,
    kanaStats,
    pendingKana: null,
    // A miss carried at a boundary belongs to a mora that never opened, and now
    // never will. It cannot be charged to the mora before it — that is the very
    // misattribution `carriedMiss` exists to prevent.
    carriedMiss: false,
    rejected: null,
    finishedAt: state.startedAt === null ? null : endedAt,
  }
}

/**
 * Clears the passage and keeps the run.
 *
 * Everything the matcher and the screen own is reset — the typed line, the match
 * positions, the mora in progress — while everything the run owns is kept:
 * counters, the three stat tables, the interval samples the baseline is drawn
 * from, and `startedAt`, because the clock has not stopped.
 *
 * `lastKeyAt` is cleared deliberately. Left set, the pause between finishing one
 * passage and the first keystroke of the next — dealing, compiling, painting —
 * would be charged to that keystroke and to the mora it opens, making the first
 * mora of every passage look hard. It becomes untimed instead, exactly as the
 * first key of a run and the key after a backspace already are.
 */
export function rollToNextPrompt(state: SessionState): SessionState {
  return {
    ...state,
    completedChars: state.completedChars + state.keys.length,
    completedCorrectChars:
      state.completedCorrectChars + state.keys.filter((key) => key.correct).length,
    keys: [],
    match: initMatch(),
    pendingKana: null,
    timingBlocked: false,
    carriedMiss: false,
    rejected: null,
    lastKeyAt: null,
    finishedAt: null,
  }
}

export function computeMetrics(state: SessionState, now: number): SessionMetrics {
  const elapsedMs = state.startedAt ? Math.max(0, (state.finishedAt ?? now) - state.startedAt) : 0
  const elapsedSec = elapsedMs / 1000

  // Net counts the characters standing correct on screen right now; raw and
  // accuracy count every keystroke ever made, so backspacing over a mistake
  // hides it from the line but not from the score.
  const standing =
    state.completedCorrectChars + state.keys.filter((key) => key.correct).length
  const accuracy =
    state.attempts === 0
      ? 100
      : Math.max(0, Math.round(((state.attempts - state.mistakes) / state.attempts) * 100))

  const wpm = elapsedSec > 0 ? Math.round(((standing / 5) / elapsedSec) * 60) : 0
  const rawWpm = elapsedSec > 0 ? Math.round(((state.attempts / 5) / elapsedSec) * 60) : 0

  const samples = state.intervals.filter((i) => i > 0)
  let consistency = 100
  if (samples.length >= 3) {
    const avg = samples.reduce((sum, i) => sum + i, 0) / samples.length
    const variance = samples.reduce((sum, i) => sum + (i - avg) ** 2, 0) / samples.length
    const deviation = Math.sqrt(variance)
    consistency = Math.max(0, Math.min(100, Math.round(100 - (deviation / avg) * 100)))
  }

  return { wpm, rawWpm, accuracy, consistency, elapsedMs }
}

/**
 * The typist's own cadence for this run: the median interval between clean
 * keystrokes.
 *
 * Median rather than mean because a single long pause — a glance at the screen,
 * a thought about the next word — would drag a mean up and forgive every mora in
 * the run. Null below a few samples, where the number would be an accident of
 * one or two keystrokes rather than a cadence; a run that short simply
 * contributes no excess.
 */
const MIN_BASELINE_SAMPLES = 5

export function baselineInterval(cleanIntervals: readonly number[]): number | null {
  if (cleanIntervals.length < MIN_BASELINE_SAMPLES) return null
  const sorted = [...cleanIntervals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildRunResult(
  state: SessionState,
  lesson: Lesson,
  metrics: SessionMetrics,
  isoNow: () => string = () => new Date().toISOString(),
): RunResult {
  const baseline = baselineInterval(state.cleanIntervals)
  return {
    source: lesson.source,
    // What was actually typed, not the canonical spelling's length — a run
    // typed as `si` is one character shorter than the same run typed `shi`.
    // Spans every passage of the run, not just the one on screen when it ended.
    chars: state.completedChars + state.keys.length,
    mistakes: state.mistakes,
    accuracy: metrics.accuracy,
    wpm: metrics.wpm,
    rawWpm: metrics.rawWpm,
    consistency: metrics.consistency,
    elapsedMs: metrics.elapsedMs,
    date: isoNow(),
    keyStats: state.keyStats,
    bigramStats: state.bigramStats,
    kanaStats: state.kanaStats,
    ...(baseline === null ? {} : { baselineMs: baseline }),
  }
}
