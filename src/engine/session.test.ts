import { describe, expect, it } from 'vitest'
import { compileItem } from './prompt'
import { tokenizeKana } from './romanization'
import {
  applyBackspace,
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
    expect(result.missed).toEqual({ legal: ['h', 'i'], typed: 'x' })
  })

  it('reports a single expected character when only one was legal', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0, false)
    expect(result.missed).toEqual({ legal: ['a'], typed: 'x' })
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
    expect(s.keyStats['i']).toEqual({ attempts: 1, misses: 0, totalMs: 100 })
  })

  it('scores a wrong keystroke against the key that was expected', () => {
    const result = applyTypeChar(emptySession(), 'x', ABC, T0)
    expect(result.session.keyStats['a']).toEqual({ attempts: 1, misses: 1, totalMs: 0 })
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
    expect(result.missed).toEqual({ legal: ['a'], typed: 'x' })
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
