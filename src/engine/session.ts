import {
  initMatch,
  stepWithRecovery,
  type MatchState,
  type RomajiToken,
} from './romanization'
import type { Lesson, RunResult, TimingStat } from './types'

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
  intervals: number[]
  /** Timestamp of the last committed keystroke, right or wrong. */
  lastKeyAt: number | null
}

export type TypeResult = {
  session: SessionState
  completed: boolean
  /**
   * Set on a wrong keystroke. `legal` is the full set of characters that would
   * have been accepted — after `s` on し that's genuinely both `h` and `i`, and
   * blaming one of them would make the stats an artefact of display order.
   */
  missed?: { legal: string[]; typed: string }
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
    intervals: [],
    lastKeyAt: null,
  }
}

function updateStat(
  stats: Record<string, TimingStat>,
  key: string,
  ms: number,
  miss: boolean,
): Record<string, TimingStat> {
  const stat = stats[key] ?? { attempts: 0, misses: 0, totalMs: 0 }
  return {
    ...stats,
    [key]: { attempts: stat.attempts + 1, misses: stat.misses + (miss ? 1 : 0), totalMs: stat.totalMs + ms },
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
 * A wrong keystroke is an ordinary keystroke: it's drawn red and the cursor
 * moves on, consuming one edge in every direction that was legal (see
 * `stepWithRecovery`). It is not a wall to clear before typing can continue.
 */
export function applyTypeChar(
  state: SessionState,
  rawChar: string,
  tokens: RomajiToken[],
  now: number,
): TypeResult {
  if (state.finishedAt !== null) return { session: state, completed: false }
  if (rawChar.length !== 1 || tokens.length === 0) return { session: state, completed: false }

  const char = rawChar.toLowerCase()
  const step = stepWithRecovery(tokens, state.match, char)
  const startedAt = state.startedAt ?? now
  // Clamped at both ends. The upper bound is the pause cap; the lower bound
  // matters because `now` comes from a wall clock that can step backwards (an
  // NTP correction, a manual change), and a negative interval poisoned the
  // timing totals and the elapsed time with it.
  const interval =
    state.lastKeyAt === null ? 0 : Math.max(0, Math.min(PAUSE_CAP_MS, now - state.lastKeyAt))

  const key = scoredKey(char, step.correct, step.legal)
  const previous = state.keys[state.keys.length - 1]
  const keyStats = key === null ? state.keyStats : updateStat(state.keyStats, key, interval, !step.correct)

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
    keys: [...state.keys, { char, correct: step.correct }],
    match: step.state,
    attempts: state.attempts + 1,
    mistakes: step.correct ? state.mistakes : state.mistakes + 1,
    startedAt,
    finishedAt: step.done ? now : null,
    keyStats,
    bigramStats,
    intervals: interval > 0 ? [...state.intervals, interval] : state.intervals,
    lastKeyAt: now,
  }

  return {
    session,
    ...(step.correct ? {} : { missed: { legal: step.legal, typed: char } }),
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
  return { ...state, keys, match: matchFor(tokens, keys), lastKeyAt: null }
}

export function computeMetrics(state: SessionState, now: number): SessionMetrics {
  const elapsedMs = state.startedAt ? Math.max(0, (state.finishedAt ?? now) - state.startedAt) : 0
  const elapsedSec = elapsedMs / 1000

  // Net counts the characters standing correct on screen right now; raw and
  // accuracy count every keystroke ever made, so backspacing over a mistake
  // hides it from the line but not from the score.
  const standing = state.keys.filter((key) => key.correct).length
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

export function buildRunResult(
  state: SessionState,
  lesson: Lesson,
  metrics: SessionMetrics,
  isoNow: () => string = () => new Date().toISOString(),
): RunResult {
  return {
    source: lesson.source,
    // What was actually typed, not the canonical spelling's length — a run
    // typed as `si` is one character shorter than the same run typed `shi`.
    chars: state.keys.length,
    mistakes: state.mistakes,
    accuracy: metrics.accuracy,
    wpm: metrics.wpm,
    rawWpm: metrics.rawWpm,
    consistency: metrics.consistency,
    elapsedMs: metrics.elapsedMs,
    date: isoNow(),
    keyStats: state.keyStats,
    bigramStats: state.bigramStats,
  }
}
