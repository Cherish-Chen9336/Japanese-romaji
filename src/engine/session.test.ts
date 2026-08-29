import { describe, expect, it } from 'vitest'
import { compileItem } from './prompt'
import { tokenizeKana } from './romanization'
import {
  applyBackspace,
  finishRun,
  rollToNextPrompt,
  applyTypeChar,
  buildRunResult,
  computeMetrics,
  emptySession,
  matchFor,
  type SessionState,
} from './session'

const T0 = 1_000_000

/** あいう — three single-letter tokens, the simplest possible prompt. */
const ABC = tokenizeKana('あいう')

function session(overrides: Partial<SessionState> = {}): SessionState {
  return { ...emptySession(), ...overrides }
}

/**
 * Types a whole string. `stopOnError` defaults to false here so the existing
 * cases read as written; the production default is the opposite, and the
 * stop-on-error block below covers it explicitly.
 */
function type(
  tokens: ReturnType<typeof tokenizeKana>,
  text: string,
  start = emptySession(),
  stopOnError = false,
) {
  let state = start
  let at = T0
  for (const char of text) {
    at += 100
    state = applyTypeChar(state, char, tokens, at, stopOnError).session
  }
  return state
}

/** Same, refusing wrong keys — the production default. */
function typeStrict(tokens: ReturnType<typeof tokenizeKana>, text: string, start = emptySession()) {
  return type(tokens, text, start, true)
}

/** The characters on screen, `!` marking the ones typed wrong. */
function line(state: SessionState): string {
  return state.keys.map((key) => (key.correct ? key.char : `${key.char}!`)).join('')
}

describe('emptySession', () => {
  it('starts with nothing typed and the matcher at the top', () => {
    const s = emptySession()
    expect(s.keys).toEqual([])
    expect(s.attempts).toBe(0)
    expect(s.mistakes).toBe(0)
    expect(s.startedAt).toBeNull()
    expect(s.finishedAt).toBeNull()
    expect(s.match.positions).toEqual([{ tokenIndex: 0, typedInToken: '' }])
  })
})

describe('applyTypeChar — accepted spellings', () => {
  it('accepts the canonical spelling', () => {
    const state = type(tokenizeKana('しゃしん'), 'shashin')
    expect(state.finishedAt).not.toBeNull()
    expect(state.mistakes).toBe(0)
  })

  // The whole point of the matcher: one kana, several legitimate spellings.
  it.each([
    ['し', 'shi'],
    ['し', 'si'],
    ['し', 'ci'],
    ['つ', 'tsu'],
    ['つ', 'tu'],
    ['ちゃ', 'cha'],
    ['ちゃ', 'tya'],
    ['じ', 'ji'],
    ['じ', 'zi'],
    ['ん', 'n'],
  ])('accepts %s typed as "%s"', (kana, romaji) => {
    const state = type(tokenizeKana(kana), romaji)
    expect(state.mistakes).toBe(0)
    expect(state.finishedAt).not.toBeNull()
    // Every keystroke was consumed — without this the assertion passes for a
    // spelling that finished early and ignored the rest of what was typed.
    expect(state.keys).toHaveLength(romaji.length)
  })

  /*
   * ん's longer spellings only exist mid-text. A run ends the moment the last
   * token has any complete spelling, and `n` is one, so a trailing ん finishes
   * on the first keypress and the second `n` of `nn` lands after the run is
   * over. Mid-text there's no such cut-off and `nn` works normally, which is
   * the case that actually matters (さんねん as `sannen`).
   *
   * The previous version of this test fed `nn` and only checked that the
   * finished state had no mistakes — true of a state that stopped after one
   * keystroke, so it asserted nothing.
   */
  it('finishes a trailing ん on the first n, leaving nn unreachable there', () => {
    const state = type(tokenizeKana('ん'), 'nn')
    expect(state.finishedAt).not.toBeNull()
    expect(state.keys).toHaveLength(1)
    expect(state.attempts).toBe(1)
  })

  it('still accepts nn for ん anywhere but the very end', () => {
    const state = type(tokenizeKana('さんねん'), 'sannen')
    expect(state.finishedAt).not.toBeNull()
    expect(state.mistakes).toBe(0)
    expect(state.keys).toHaveLength(6)
  })

  it('accepts a sokuon typed as a doubled consonant', () => {
    const state = type(tokenizeKana('がっこう'), 'gakkou')
    expect(state.mistakes).toBe(0)
    expect(state.finishedAt).not.toBeNull()
  })

  // Needs the matcher to hold both parses open: after `n`,`n` it can't yet tell
  // whether ん was spelled `nn` or spelled `n` with な already started.
  it('accepts んな across the ambiguous token boundary', () => {
    expect(type(tokenizeKana('んな'), 'nna').finishedAt).not.toBeNull()
    expect(type(tokenizeKana('んな'), 'nnna').finishedAt).not.toBeNull()
    expect(type(tokenizeKana('んな'), 'nna').mistakes).toBe(0)
    expect(type(tokenizeKana('んな'), 'nnna').mistakes).toBe(0)
  })
})

describe('applyTypeChar — wrong keystrokes, advance-on-error', () => {
  it('advances past a wrong key instead of blocking on it', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0, false)
    expect(result.session.keys).toEqual([{ char: 'x', correct: false }])
    expect(result.session.mistakes).toBe(1)
    expect(result.completed).toBe(false)
  })

  // The substitution property. A wrong key costs one keystroke, exactly as a
  // right one does — it does not leave the typist still owing that character.
  it('lets a wrong key stand in for the character it replaced', () => {
    const state = type(ABC, 'xiu')
    expect(line(state)).toBe('x!iu')
    expect(state.finishedAt).not.toBeNull()
    expect(state.mistakes).toBe(1)
  })

  it('costs a mistyped mora no more keystrokes than a clean one', () => {
    const clean = type(tokenizeKana('し'), 'shi')
    const fumbled = type(tokenizeKana('し'), 'xhi')
    expect(fumbled.keys).toHaveLength(clean.keys.length)
    expect(fumbled.finishedAt).not.toBeNull()
    expect(fumbled.mistakes).toBe(1)
  })

  it('reports every character that would have been accepted', () => {
    const afterS = applyTypeChar(emptySession(), 's', tokenizeKana('し'), T0, false).session
    const result = applyTypeChar(afterS, 'x', tokenizeKana('し'), T0 + 100, false)
    expect(result.missed).toEqual({ legal: ['h', 'i'], typed: 'x', kana: 'し' })
  })

  it('reports a single expected character when only one was legal', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0, false)
    expect(result.missed).toEqual({ legal: ['a'], typed: 'x', kana: 'あ' })
  })

  it('completes the run even when the last keystroke is wrong', () => {
    const state = type(ABC, 'aix')
    expect(state.finishedAt).not.toBeNull()
    expect(state.mistakes).toBe(1)
  })

  it('ignores further input once finished', () => {
    const done = type(ABC, 'aiu')
    expect(applyTypeChar(done, 'a', ABC, T0 + 9999, false).session).toBe(done)
  })

  it('is case-insensitive', () => {
    expect(type(ABC, 'AIU').mistakes).toBe(0)
  })
})

describe('applyBackspace', () => {
  it('removes the last keystroke, right or wrong', () => {
    const state = type(ABC, 'ax')
    expect(line(state)).toBe('ax!')
    const undone = applyBackspace(state, ABC)
    expect(line(undone)).toBe('a')
  })

  it('rewinds the matcher so the character can be retyped', () => {
    const fumbled = type(tokenizeKana('し'), 'sx')
    const undone = applyBackspace(fumbled, tokenizeKana('し'))
    const fixed = type(tokenizeKana('し'), 'hi', undone)
    expect(fixed.finishedAt).not.toBeNull()
  })

  it('is a no-op with nothing typed', () => {
    const s = emptySession()
    expect(applyBackspace(s, ABC)).toBe(s)
  })

  it('is a no-op once the run is finished', () => {
    const done = type(ABC, 'aiu')
    expect(applyBackspace(done, ABC)).toBe(done)
  })

  // Backspace edits the line, not the record. Otherwise a run could be typed
  // badly, tidied up, and scored as though it had been typed cleanly.
  it('does not un-count a mistake', () => {
    const state = applyBackspace(type(ABC, 'x'), ABC)
    expect(state.mistakes).toBe(1)
    expect(state.attempts).toBe(1)
    expect(state.keys).toEqual([])
  })
})

describe('matchFor', () => {
  it('replays to the same state the incremental steps reached', () => {
    const tokens = tokenizeKana('んな')
    const typed = type(tokens, 'nn')
    expect(matchFor(tokens, typed.keys)).toEqual(typed.match)
  })
})

describe('computeMetrics', () => {
  it('returns zero wpm and 100 accuracy before any typing', () => {
    const m = computeMetrics(emptySession(), T0)
    expect(m.wpm).toBe(0)
    expect(m.accuracy).toBe(100)
    expect(m.elapsedMs).toBe(0)
  })

  it('computes wpm from the characters standing correct', () => {
    // 10 correct in 10 s → (10/5/10)*60 = 12 wpm
    const s = session({
      keys: Array.from({ length: 10 }, () => ({ char: 'a', correct: true })),
      attempts: 10,
      startedAt: T0,
    })
    expect(computeMetrics(s, T0 + 10_000).wpm).toBe(12)
  })

  it('excludes characters standing incorrect from wpm but not from raw', () => {
    const keys = [
      ...Array.from({ length: 8 }, () => ({ char: 'a', correct: true })),
      { char: 'x', correct: false },
      { char: 'x', correct: false },
    ]
    const s = session({ keys, attempts: 10, mistakes: 2, startedAt: T0 })
    const m = computeMetrics(s, T0 + 10_000)
    expect(m.wpm).toBe(10) // 8 correct → 9.6, rounded
    expect(m.rawWpm).toBe(12) // all 10 keystrokes
    expect(m.accuracy).toBe(80)
  })

  // Regression: raw speed used to be derived from what survived on screen, so
  // typing a character, deleting it and retyping it counted once instead of
  // three times.
  it('keeps counting keystrokes that were backspaced away', () => {
    let s = type(ABC, 'a')
    s = applyBackspace(s, ABC)
    s = type(ABC, 'a', s)
    expect(s.attempts).toBe(2)
    expect(s.keys).toHaveLength(1)
  })

  it('uses finishedAt instead of now when the session is done', () => {
    const s = session({
      keys: Array.from({ length: 10 }, () => ({ char: 'a', correct: true })),
      attempts: 10,
      startedAt: T0,
      finishedAt: T0 + 10_000,
    })
    const m = computeMetrics(s, T0 + 99_999)
    expect(m.elapsedMs).toBe(10_000)
    expect(m.wpm).toBe(12)
  })

  it('returns 100 consistency when fewer than 3 intervals exist', () => {
    expect(computeMetrics(session({ intervals: [100, 200], startedAt: T0 }), T0 + 1000).consistency).toBe(100)
  })

  it('returns lower consistency for highly variable intervals', () => {
    const s = session({ intervals: [100, 100, 2000], startedAt: T0 })
    expect(computeMetrics(s, T0 + 10_000).consistency).toBeLessThan(100)
  })
})

describe('timing stats', () => {
  it('scores a correct keystroke against the key that was pressed', () => {
    const s = type(ABC, 'ai')
    expect(s.keyStats['i']).toEqual({ attempts: 1, misses: 0, totalMs: 100, timingSamples: 1 })
  })

  /*
   * The first key of a run has nothing before it to measure against. It is an
   * unobserved interval, not a zero-millisecond one, so it counts as an attempt
   * and contributes no timing sample — otherwise the key drags its own average
   * toward zero, and a key only ever pressed first reports itself as instant.
   */
  it('scores a wrong keystroke against the key that was expected', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0)
    expect(result.session.keyStats['a']).toEqual({
      attempts: 1,
      misses: 1,
      totalMs: 0,
      timingSamples: 0,
    })
  })

  // With two legal continuations there is no single key at fault, and charging
  // both would invent misses that never happened.
  it('scores no key when the expected character was ambiguous', () => {
    const tokens = tokenizeKana('し')
    const afterS = applyTypeChar(emptySession(), 's', tokens, T0).session
    const result = applyTypeChar(afterS, 'x', tokens, T0 + 100)
    expect(result.session.keyStats).toEqual(afterS.keyStats)
  })

  it('records bigrams from the second keystroke onward', () => {
    const s = type(ABC, 'ai')
    expect(Object.keys(s.bigramStats)).toEqual(['ai'])
  })

  // A pair is how fast you move between two keys. With a typo at either end it
  // is measuring recovery instead — a different quantity in the same bucket.
  it('records no bigram across a wrong keystroke', () => {
    expect(Object.keys(type(ABC, 'ax').bigramStats)).toEqual([])
    expect(Object.keys(type(ABC, 'xi').bigramStats)).toEqual([])
  })

  it('resumes recording once two correct keystrokes are adjacent again', () => {
    // a(ok) x(bad) u(ok) — only the x-u and a-x pairs are dropped.
    expect(Object.keys(type(ABC, 'axu').bigramStats)).toEqual([])
    // a(ok) i(ok) — clean pair recorded.
    expect(Object.keys(type(ABC, 'aiu').bigramStats)).toEqual(['ai', 'iu'])
  })

  it('measures intervals between adjacent keystrokes, right or wrong', () => {
    const s = type(ABC, 'axu')
    expect(s.intervals).toEqual([100, 100])
  })

  it('caps a long pause at 3000 ms', () => {
    const s1 = applyTypeChar(emptySession(), 'a', ABC, T0).session
    const s2 = applyTypeChar(s1, 'i', ABC, T0 + 9000).session
    expect(s2.intervals).toEqual([3000])
  })
})

describe('buildRunResult', () => {
  it('records the characters actually typed, not the canonical spelling', () => {
    const item = { kana: 'し', romaji: 'shi' }
    const lesson = { kana: 'し', romaji: 'shi', source: 'words' as const, items: [item] }
    const short = type(compileItem(item), 'si')
    const run = buildRunResult(short, lesson, computeMetrics(short, T0), () => '2026-01-01T00:00:00.000Z')
    expect(run.chars).toBe(2)
    expect(run.source).toBe('words')
  })
})

describe('applyTypeChar input guards', () => {
  it('ignores anything that is not a single character', () => {
    const s = emptySession()
    expect(applyTypeChar(s, 'ab', ABC, T0).session).toBe(s)
    expect(applyTypeChar(s, '', ABC, T0).session).toBe(s)
  })

  it('ignores a keystroke against an empty prompt', () => {
    const s = emptySession()
    expect(applyTypeChar(s, 'a', [], T0).session).toBe(s)
  })
})

describe('buildRunResult timestamps', () => {
  it('stamps the current time when no clock is injected', () => {
    const lesson = { kana: 'あ', romaji: 'a', source: 'words' as const, items: [{ kana: 'あ', romaji: 'a' }] }
    const state = type(ABC, 'a')
    const before = Date.now()
    const run = buildRunResult(state, lesson, computeMetrics(state, T0))
    expect(Date.parse(run.date)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(run.date)).toBeLessThanOrEqual(Date.now())
  })
})

/*
 * The default. Every Japanese typing site refuses a wrong key rather than
 * substituting for it, and the reason is that romaji input is compositional —
 * you are assembling a kana, not filling a slot in a fixed grid. A key that
 * half-assembles nothing would leave the typist mid-mora with no way to see
 * what state they were in.
 */
describe('applyTypeChar — wrong keystrokes, stop-on-error', () => {
  it('refuses the key and holds the cursor', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0, true)
    expect(result.session.keys).toEqual([])
    expect(result.session.match).toEqual(emptySession().match)
    expect(result.completed).toBe(false)
  })

  it('still counts the attempt and the mistake', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0, true)
    expect(result.session.attempts).toBe(1)
    expect(result.session.mistakes).toBe(1)
    expect(result.missed).toEqual({ legal: ['a'], typed: 'x', kana: 'あ' })
  })

  // Nothing was consumed, so there is no red character in the line to mark.
  // The character being waited on carries the signal instead.
  it('marks the refused key so the display can show it', () => {
    expect(applyTypeChar(emptySession(), 'x', ABC, T0, true).session.rejected).toBe('x')
  })

  it('clears the mark as soon as a legal key arrives', () => {
    const refused = applyTypeChar(emptySession(), 'x', ABC, T0, true).session
    expect(applyTypeChar(refused, 'a', ABC, T0 + 100, true).session.rejected).toBeNull()
  })

  // The practical point: recovering costs one keypress, not a backspace.
  it('carries on from the right key with no correction needed', () => {
    const state = typeStrict(ABC, 'axiu')
    expect(state.finishedAt).not.toBeNull()
    expect(state.mistakes).toBe(1)
    expect(state.keys.map((k) => k.char).join('')).toBe('aiu')
  })

  it('never leaves a wrong character standing in the line', () => {
    const state = typeStrict(ABC, 'xxxaiu')
    expect(state.keys.every((k) => k.correct)).toBe(true)
    expect(state.mistakes).toBe(3)
  })

  it('cannot finish a run on a wrong key', () => {
    const state = typeStrict(ABC, 'aix')
    expect(state.finishedAt).toBeNull()
    expect(typeStrict(ABC, 'u', state).finishedAt).not.toBeNull()
  })

  it('accepts every alternate spelling exactly as before', () => {
    expect(typeStrict(tokenizeKana('しゃしん'), 'syasin').mistakes).toBe(0)
    expect(typeStrict(tokenizeKana('しゃしん'), 'syasin').finishedAt).not.toBeNull()
  })

  it('clears the mark on backspace', () => {
    const refused = applyTypeChar(typeStrict(ABC, 'a'), 'x', ABC, T0 + 200, true).session
    expect(refused.rejected).toBe('x')
    expect(applyBackspace(refused, ABC).rejected).toBeNull()
  })
})

/*
 * Per-mora stats. The reason these exist alongside keyStats: `h` being slow
 * says nothing about whether し or ひ is the problem, and a miss mid-mora often
 * has no single key to blame while always having a kana.
 */
describe('kana stats', () => {
  /*
   * One attempt is one *encounter with the mora*, not one keystroke. Counting
   * keystrokes divided the error rate by the length of the spelling: the same
   * single fumble scored あ at 50% and しゃ at 25%, ranking the harder kana as
   * the easier one, and a three-letter kana cleared a "seen three times" floor
   * on its very first appearance.
   */
  it('counts one attempt per encounter, whatever the spelling costs', () => {
    for (const [kana, romaji] of [['あ', 'a'], ['か', 'ka'], ['しゃ', 'sha'], ['ちゅ', 'chu']]) {
      expect(type(tokenizeKana(kana), romaji).kanaStats[kana].attempts, kana).toBe(1)
    }
  })

  it('scores the same fumble the same however long the spelling is', () => {
    const rates = [['あ', 'a'], ['か', 'ka'], ['しゃ', 'sha'], ['ちゅ', 'chu']].map(([kana, romaji]) => {
      const tokens = tokenizeKana(kana)
      const fumbled = applyTypeChar(emptySession(), 'q', tokens, T0, true).session
      const stat = type(tokens, romaji, fumbled).kanaStats[kana]
      return stat.misses / stat.attempts
    })
    expect(new Set(rates).size).toBe(1)
    expect(rates[0]).toBe(1)
  })

  // Identified by token, not by name — otherwise these merge into one encounter.
  it('counts a mora twice when it appears twice', () => {
    expect(type(tokenizeKana('ここ'), 'koko').kanaStats['こ'].attempts).toBe(2)
  })

  it('records every mora of a word, including a repeated ん', () => {
    const s = type(tokenizeKana('さんねん'), 'sannen')
    expect(s.kanaStats['さ'].attempts).toBe(1)
    expect(s.kanaStats['ね'].attempts).toBe(1)
    // Both ん — the second used to vanish at the ambiguous boundary.
    expect(s.kanaStats['ん'].attempts).toBe(2)
  })

  it('charges a miss to the mora even when no single key was expected', () => {
    const tokens = tokenizeKana('し')
    const afterS = applyTypeChar(emptySession(), 's', tokens, T0, true).session
    const result = applyTypeChar(afterS, 'x', tokens, T0 + 100, true)
    // `h` and `i` were both legal, so no key is at fault…
    expect(result.missed?.legal).toEqual(['h', 'i'])
    // …but the mora is, and it used to be dropped entirely.
    expect(result.missed?.kana).toBe('し')
    const done = type(tokens, 'hi', result.session)
    expect(done.kanaStats['し'].misses).toBe(1)
    expect(done.kanaStats['し'].attempts).toBe(1)
  })

  /*
   * Blamed on the mora being worked on, not on where the keystroke landed. At an
   * ん boundary the next key could extend ん or open the following mora, but the
   * typist was in the middle of ん either way — and reporting null there simply
   * threw the miss away.
   */
  it('blames a miss on the mora being typed, even at an ambiguous boundary', () => {
    const tokens = tokenizeKana('んな')
    const afterN = applyTypeChar(emptySession(), 'n', tokens, T0, true).session
    expect(applyTypeChar(afterN, 'q', tokens, T0 + 100, true).missed?.kana).toBe('ん')
  })

  it('reports no mora when the position is not one', () => {
    // A separator: nothing to charge a miss to.
    const tokens = tokenizeKana('あ い')
    const afterA = applyTypeChar(emptySession(), 'a', tokens, T0, true).session
    expect(applyTypeChar(afterA, 'q', tokens, T0 + 100, true).missed?.kana).toBeNull()
  })

  it('separates two moras that share their letters', () => {
    const s = type(tokenizeKana('しゅくだい'), 'shukudai')
    expect(Object.keys(s.kanaStats).sort()).toEqual(['い', 'く', 'しゅ', 'だ'].sort())
  })

  it('abandons a half-typed mora on backspace rather than banking it', () => {
    const half = type(tokenizeKana('しゃ'), 'sh')
    expect(half.pendingKana?.kana).toBe('しゃ')
    expect(applyBackspace(half, tokenizeKana('しゃ')).pendingKana).toBeNull()
  })

  /*
   * The duration of a mora and the width to charge the baseline over. Without
   * the width, `totalMs` is time-to-type-the-whole-spelling and rises with the
   * number of letters: a flawless typist at a constant 100 ms recorded あ at 100
   * and しゃ at 300 and looked three times worse at しゃ for no reason at all.
   */
  it('records how many timed keystrokes a duration covers', () => {
    for (const [kana, romaji] of [['か', 'ka'], ['しゃ', 'sha'], ['ちゅ', 'chu']]) {
      // Led in with あ so the mora under test has no untimed first keystroke.
      const s = type(tokenizeKana(`あ${kana}`), `a${romaji}`)
      const stat = s.kanaStats[kana]
      expect(stat.keystrokes, kana).toBe(romaji.length)
      expect(stat.totalMs, kana).toBe(100 * romaji.length)
      expect(stat.timingSamples, kana).toBe(1)
    }
  })

  /*
   * At an ん boundary the interval genuinely cannot be attributed yet: in `nna`
   * the second `n` opens な, but in `nnna` it belongs to ん and the third opens
   * な, and no key so far says which. Both encounters give up their clock rather
   * than claim an interval that may be the other's — but the attempt survives,
   * so the error signal, which is the one that ranks a mora, is untouched.
   */
  it('gives up timing at an ambiguous boundary but keeps the encounter', () => {
    const s = type(tokenizeKana('さんな'), 'sanna')
    expect(s.kanaStats['ん'].attempts).toBe(1)
    expect(s.kanaStats['な'].attempts).toBe(1)
    expect(s.kanaStats['ん'].timingSamples).toBe(0)
    expect(s.kanaStats['な'].timingSamples).toBe(0)
    // Not merely absent from the table — present, and counted.
    expect(s.kanaStats['ん'].totalMs).toBe(0)
  })

  /*
   * After a miss the elapsed time is recovery time. Counted as latency it would
   * charge one fumble twice — once to the error rate, again to the clock —
   * making a mora look weak on an axis it never actually failed on.
   */
  it('keeps no duration for an encounter that was missed', () => {
    const tokens = tokenizeKana('あしゃ')
    // Fumbled mid-mora, after `s`, where the miss is unambiguously しゃ's.
    const afterS = type(tokens, 'as')
    const fumbled = applyTypeChar(afterS, 'q', tokens, T0 + 300, true).session
    const done = type(tokens, 'ha', fumbled)
    expect(done.kanaStats['しゃ'].attempts).toBe(1)
    expect(done.kanaStats['しゃ'].misses).toBe(1)
    expect(done.kanaStats['しゃ'].timingSamples).toBe(0)
    expect(done.kanaStats['しゃ'].totalMs).toBe(0)
  })

  /*
   * The mora being *started*, not the one just finished. After あ is complete
   * the cursor sits between two moras: `expectedToken` knows it is waiting on か
   * and the UI says so, but `pendingKana` still held あ, so the table charged the
   * miss to the mora that was typed correctly and left the fumbled one clean.
   * The first key of a mora is where recall happens, which makes this the most
   * common miss there is — it inflated moras you know and hid the ones you don't,
   * and `weakestKana` and drill selection both read the result.
   */
  it('charges a boundary fumble to the mora being started, not the one just finished', () => {
    const tokens = tokenizeKana('あか')
    const fumbled = applyTypeChar(type(tokens, 'a'), 'q', tokens, T0 + 200, true)
    expect(fumbled.missed?.kana).toBe('か')
    const done = type(tokens, 'ka', fumbled.session)
    expect(done.kanaStats['あ'].misses).toBe(0)
    expect(done.kanaStats['か'].misses).toBe(1)
  })

  /*
   * The invariant behind that fix: whatever the UI names as the mora at fault is
   * the mora the table charges. Anything else means the screen and the mastery
   * model disagree about what you got wrong. Swept over every position of words
   * chosen to cover a clean boundary, a yōon, a geminate and an ん boundary.
   */
  it('records a miss against the same mora it reports, at every position', () => {
    for (const [kana, romaji] of [
      ['あか', 'aka'],
      ['でんしゃ', 'densha'],
      ['がっこう', 'gakkou'],
      ['さんねん', 'sannen'],
    ]) {
      for (let stop = 0; stop < romaji.length; stop += 1) {
        const tokens = tokenizeKana(kana)
        const before = type(tokens, romaji.slice(0, stop))
        const fumbled = applyTypeChar(before, 'q', tokens, T0 + 1_000, true)
        const reported = fumbled.missed?.kana
        if (reported === undefined || reported === null) continue
        const done = type(tokens, romaji.slice(stop), fumbled.session)
        const blamed = Object.entries(done.kanaStats)
          .filter(([, stat]) => stat.misses > 0)
          .map(([mora]) => mora)
        expect(blamed, `${kana} @ ${stop} reported ${reported}`).toEqual([reported])
      }
    }
  })

  it('carries into the recorded run', () => {
    const item = { kana: 'し', romaji: 'shi' }
    const lesson = { kana: 'し', romaji: 'shi', source: 'words' as const, items: [item] }
    const s = type(compileItem(item), 'shi')
    const run = buildRunResult(s, lesson, computeMetrics(s, T0), () => '2026-01-01T00:00:00.000Z')
    expect(run.kanaStats?.['し'].attempts).toBe(1)
  })
})

/*
 * A run and a passage used to be the same thing. A timed run outlives its
 * passage, so the two had to be separated: what the matcher and the screen own
 * resets at a passage boundary, what the run owns does not.
 */
describe('rollToNextPrompt', () => {
  it('clears the line and the matcher', () => {
    const rolled = rollToNextPrompt(type(tokenizeKana('かき'), 'kaki'))
    expect(rolled.keys).toEqual([])
    expect(rolled.pendingKana).toBeNull()
    expect(rolled.finishedAt).toBeNull()
  })

  it('keeps everything the run is counted from', () => {
    const done = type(tokenizeKana('かき'), 'kaki')
    const rolled = rollToNextPrompt(done)
    expect(rolled.attempts).toBe(done.attempts)
    expect(rolled.startedAt).toBe(done.startedAt)
    expect(rolled.kanaStats).toEqual(done.kanaStats)
    expect(rolled.cleanIntervals).toEqual(done.cleanIntervals)
  })

  /*
   * `keys` is the line on screen, so it has to reset — but it was also the run's
   * whole character count, and that half has to survive somewhere.
   */
  it('banks the finished passage rather than losing its characters', () => {
    const first = type(tokenizeKana('かき'), 'kaki')
    const rolled = rollToNextPrompt(first)
    expect(rolled.completedChars).toBe(4)
    expect(rolled.completedCorrectChars).toBe(4)
    const second = type(tokenizeKana('くけ'), 'kuke', rolled)
    const lesson = { kana: 'くけ', romaji: 'kuke', source: 'words' as const, items: [{ kana: 'くけ', romaji: 'kuke' }] }
    const run = buildRunResult(second, lesson, computeMetrics(second, T0), () => '2026-01-01T00:00:00.000Z')
    expect(run.chars).toBe(8)
  })

  it('counts only the correct characters toward net speed', () => {
    const fumbled = type(tokenizeKana('かき'), 'kqaki')
    const rolled = rollToNextPrompt(fumbled)
    expect(rolled.completedChars).toBe(fumbled.keys.length)
    expect(rolled.completedCorrectChars).toBe(fumbled.keys.filter((key) => key.correct).length)
    // A wrong key stands in the line and so in `chars`, but never in net speed.
    expect(rolled.completedCorrectChars).toBeLessThan(rolled.completedChars)
  })

  /*
   * Dealing and painting the next passage is not typing. Charged to the first
   * keystroke of the new passage it would land on that mora, making whatever
   * happens to come first look hard in every timed run.
   */
  it('leaves the first keystroke of the next passage untimed', () => {
    const rolled = rollToNextPrompt(type(tokenizeKana('かき'), 'kaki'))
    expect(rolled.lastKeyAt).toBeNull()
    const next = type(tokenizeKana('あ'), 'a', rolled)
    expect(next.kanaStats['あ'].timingSamples).toBe(0)
  })
})

describe('finishRun', () => {
  /*
   * A deadline lands anywhere, often mid-mora. Passage completion never had to
   * deal with that — it ended where a mora had just been banked.
   */
  it('does not invent an attempt from a mora that was merely interrupted', () => {
    const half = type(tokenizeKana('しゃ'), 'sh')
    expect(half.pendingKana?.kana).toBe('しゃ')
    expect(finishRun(half, T0 + 9_000).kanaStats['しゃ']).toBeUndefined()
  })

  /*
   * The other half: a miss made in the last second is a real encounter, and
   * abandoning the pending mora silently dropped it — the screen blamed a mora
   * the table then never recorded.
   */
  it('keeps a miss the typist actually made before the clock stopped', () => {
    const tokens = tokenizeKana('しゃ')
    const afterS = type(tokens, 's')
    const fumbled = applyTypeChar(afterS, 'q', tokens, T0 + 200, true).session
    const stat = finishRun(fumbled, T0 + 9_000).kanaStats['しゃ']
    expect(stat.attempts).toBe(1)
    expect(stat.misses).toBe(1)
    // Truncated, so it was never a measured duration.
    expect(stat.timingSamples).toBe(0)
  })

  it('stops the clock at the moment it is given', () => {
    expect(finishRun(type(tokenizeKana('か'), 'k'), T0 + 60_000).finishedAt).toBe(T0 + 60_000)
  })

  /* Nothing typed, nothing to record — and no run to end. */
  it('leaves a run that never started unfinished', () => {
    expect(finishRun(emptySession(), T0 + 60_000).finishedAt).toBeNull()
  })

  it('refuses to move a run that has already ended', () => {
    const done = type(tokenizeKana('か'), 'ka')
    expect(finishRun(done, T0 + 60_000)).toBe(done)
  })
})
