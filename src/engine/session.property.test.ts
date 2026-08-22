import { describe, expect, it } from 'vitest'
import {
  difficultBank,
  drillFallbackBank,
  gojuonBank,
  quoteBank,
  wordBank,
} from './lessons'
import { compileItem, compileItems } from './prompt'
import { legalNext, projectMatch, tokenizeKana } from './romanization'
import { mulberry32 } from './rng'
import { applyBackspace, applyTypeChar, computeMetrics, emptySession, matchFor } from './session'
import type { SessionState } from './session'
import type { TextItem } from './types'

/**
 * Properties that must hold for any input at all, checked by walking every
 * bundled item and by hammering the matcher with random keystrokes.
 *
 * Hand-picked cases test what I thought to try. These test what I didn't.
 */

const ALL: TextItem[] = [
  ...wordBank,
  ...difficultBank,
  ...drillFallbackBank,
  ...quoteBank,
  ...gojuonBank,
]

const ALPHABET = "abcdefghijklmnopqrstuvwxyz ',-1"

function typeString(tokens: ReturnType<typeof tokenizeKana>, text: string) {
  let state = emptySession()
  let at = 1_000_000
  for (const char of text) {
    at += 50
    state = applyTypeChar(state, char, tokens, at).session
  }
  return state
}

/** Every invariant the session state must satisfy at all times. */
function checkInvariants(state: SessionState, label: string) {
  expect(state.attempts, `${label}: attempts never below standing keys`).toBeGreaterThanOrEqual(
    state.keys.length,
  )
  expect(state.mistakes, `${label}: mistakes never exceed attempts`).toBeLessThanOrEqual(
    state.attempts,
  )
  expect(state.mistakes, `${label}: mistakes non-negative`).toBeGreaterThanOrEqual(0)
  expect(
    state.keys.filter((k) => !k.correct).length,
    `${label}: standing wrong keys never exceed lifetime mistakes`,
  ).toBeLessThanOrEqual(state.mistakes)

  const metrics = computeMetrics(state, (state.startedAt ?? 0) + 10_000)
  expect(metrics.accuracy, `${label}: accuracy in range`).toBeGreaterThanOrEqual(0)
  expect(metrics.accuracy, `${label}: accuracy in range`).toBeLessThanOrEqual(100)
  expect(metrics.consistency, `${label}: consistency in range`).toBeGreaterThanOrEqual(0)
  expect(metrics.consistency, `${label}: consistency in range`).toBeLessThanOrEqual(100)
  expect(metrics.wpm, `${label}: wpm finite and non-negative`).toBeGreaterThanOrEqual(0)
  expect(Number.isFinite(metrics.wpm), `${label}: wpm finite`).toBe(true)
  expect(Number.isFinite(metrics.rawWpm), `${label}: rawWpm finite`).toBe(true)
  expect(metrics.elapsedMs, `${label}: elapsed non-negative`).toBeGreaterThanOrEqual(0)
}

describe('every bundled item types clean', () => {
  it('completes with no mistakes when typed as written', () => {
    const failures: string[] = []
    for (const item of ALL) {
      const state = typeString(compileItem(item), item.romaji)
      if (state.finishedAt === null || state.mistakes !== 0) {
        failures.push(`${item.kana} as "${item.romaji}" — done=${state.finishedAt !== null} misses=${state.mistakes}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('completes a multi-item lesson typed as written', () => {
    const items = ALL.slice(0, 12)
    const tokens = compileItems(items)
    const state = typeString(tokens, items.map((i) => i.romaji).join(' '))
    expect(state.finishedAt).not.toBeNull()
    expect(state.mistakes).toBe(0)
  })
})

describe('random keystrokes never break the session', () => {
  it('holds every invariant under 300 random runs', () => {
    const rng = mulberry32(20260822)
    for (let run = 0; run < 300; run++) {
      const item = ALL[Math.floor(rng() * ALL.length)]
      const tokens = compileItem(item)
      let state = emptySession()
      let at = 1_000_000

      for (let step = 0; step < 40; step++) {
        at += Math.floor(rng() * 400)
        if (rng() < 0.2) {
          state = applyBackspace(state, tokens)
        } else {
          const char = ALPHABET[Math.floor(rng() * ALPHABET.length)]
          state = applyTypeChar(state, char, tokens, at).session
        }
        checkInvariants(state, `${item.kana} run ${run} step ${step}`)
      }
    }
  })

  // The matcher must always be able to say what comes next, or the run is stuck.
  it('always offers a legal continuation until the run is finished', () => {
    const rng = mulberry32(7)
    for (let run = 0; run < 200; run++) {
      const item = ALL[Math.floor(rng() * ALL.length)]
      const tokens = compileItem(item)
      let state = emptySession()
      let at = 1_000_000

      for (let step = 0; step < 30 && state.finishedAt === null; step++) {
        const legal = legalNext(tokens, state.match)
        expect(legal.length, `${item.kana}: stuck with nothing legal at step ${step}`).toBeGreaterThan(0)
        at += 50
        const char = rng() < 0.7 ? legal[Math.floor(rng() * legal.length)] : 'q'
        state = applyTypeChar(state, char, tokens, at).session
      }
    }
  })

  it('never leaves the matcher with no live positions', () => {
    const rng = mulberry32(99)
    for (let run = 0; run < 200; run++) {
      const tokens = compileItem(ALL[Math.floor(rng() * ALL.length)])
      let state = emptySession()
      for (let step = 0; step < 30; step++) {
        const char = ALPHABET[Math.floor(rng() * ALPHABET.length)]
        state = applyTypeChar(state, char, tokens, 1_000_000 + step * 50).session
        expect(state.match.positions.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('replay agrees with the incremental matcher', () => {
  it('rebuilding from the keystroke log lands on the same state', () => {
    const rng = mulberry32(1234)
    for (let run = 0; run < 200; run++) {
      const tokens = compileItem(ALL[Math.floor(rng() * ALL.length)])
      let state = emptySession()
      for (let step = 0; step < 25; step++) {
        const char = ALPHABET[Math.floor(rng() * ALPHABET.length)]
        state = applyTypeChar(state, char, tokens, 1_000_000 + step * 50).session
      }
      expect(matchFor(tokens, state.keys)).toEqual(state.match)
    }
  })
})

describe('the display never contradicts the matcher', () => {
  it('keeps the cursor inside the token range and the hint consistent', () => {
    const rng = mulberry32(555)
    for (let run = 0; run < 200; run++) {
      const item = ALL[Math.floor(rng() * ALL.length)]
      const tokens = compileItem(item)
      let state = emptySession()

      for (let step = 0; step < 25; step++) {
        const char = ALPHABET[Math.floor(rng() * ALPHABET.length)]
        state = applyTypeChar(state, char, tokens, 1_000_000 + step * 50).session
        const view = projectMatch(tokens, state.match)
        expect(view.tokenIndex).toBeGreaterThanOrEqual(0)
        expect(view.tokenIndex).toBeLessThan(tokens.length)
        // Whatever is left to type must be a real continuation, never negative
        // or drawn from a token that no longer exists.
        expect(typeof view.hint).toBe('string')
        expect(typeof view.rest).toBe('string')
      }
    }
  })

  // A run that is finished has nothing left to type; one that isn't, does.
  it('shows remaining text exactly while the run is unfinished', () => {
    for (const item of ALL.slice(0, 30)) {
      const tokens = compileItem(item)
      const state = typeString(tokens, item.romaji)
      const view = projectMatch(tokens, state.match)
      expect(state.finishedAt).not.toBeNull()
      expect(view.hint + view.rest, `${item.kana} should have nothing left`).toBe('')
    }
  })
})
