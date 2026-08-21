import { describe, expect, it } from 'vitest'
import {
  applyBackspace,
  applyTypeChar,
  buildRunResult,
  computeMetrics,
  emptySession,
} from './session'
import type { CharStatus, SessionState } from './session'

function session(overrides: Partial<SessionState> = {}): SessionState {
  return { ...emptySession(), ...overrides }
}

const EXPECTED = 'abc'
const T0 = 1_000_000

describe('emptySession', () => {
  it('starts at position 0 with no state', () => {
    const s = emptySession()
    expect(s.pos).toBe(0)
    expect(s.statuses).toEqual([])
    expect(s.mistakes).toBe(0)
    expect(s.startedAt).toBeNull()
    expect(s.finishedAt).toBeNull()
    expect(s.keyStats).toEqual({})
    expect(s.bigramStats).toEqual({})
    expect(s.intervals).toEqual([])
    expect(s.lastCorrectAt).toBeNull()
  })
})

describe('applyTypeChar', () => {
  it('sets startedAt on the first character', () => {
    const result = applyTypeChar(emptySession(), 'a', EXPECTED, T0)
    expect(result.session.startedAt).toBe(T0)
  })

  it('preserves existing startedAt on subsequent characters', () => {
    const started = session({ startedAt: T0, pos: 1, lastCorrectAt: T0, statuses: ['correct'] })
    const result = applyTypeChar(started, 'b', EXPECTED, T0 + 100)
    expect(result.session.startedAt).toBe(T0)
  })

  it('advances pos and marks correct on a matching character', () => {
    const result = applyTypeChar(emptySession(), 'a', EXPECTED, T0)
    expect(result.session.pos).toBe(1)
    expect(result.session.statuses[0]).toBe('correct')
    expect(result.completed).toBe(false)
    expect(result.missed).toBeUndefined()
  })

  it('is case-insensitive — lowercases the input before comparing', () => {
    const result = applyTypeChar(emptySession(), 'A', EXPECTED, T0)
    expect(result.session.pos).toBe(1)
    expect(result.session.statuses[0]).toBe('correct')
  })

  it('does not advance pos on a wrong character', () => {
    const result = applyTypeChar(emptySession(), 'x', EXPECTED, T0)
    expect(result.session.pos).toBe(0)
    expect(result.session.statuses[0]).toBe('incorrect')
    expect(result.completed).toBe(false)
  })

  it('records missed target and typed char on an incorrect hit', () => {
    const result = applyTypeChar(emptySession(), 'x', EXPECTED, T0)
    expect(result.missed).toEqual({ target: 'a', typed: 'x' })
  })

  it('increments mistakes on an incorrect hit', () => {
    const result = applyTypeChar(emptySession(), 'x', EXPECTED, T0)
    expect(result.session.mistakes).toBe(1)
  })

  it('does not add an interval for the first correct character (no previous correct time)', () => {
    const result = applyTypeChar(emptySession(), 'a', EXPECTED, T0)
    expect(result.session.intervals).toEqual([])
  })

  it('records an interval between consecutive correct characters', () => {
    const s1 = applyTypeChar(emptySession(), 'a', EXPECTED, T0).session
    const s2 = applyTypeChar(s1, 'b', EXPECTED, T0 + 200).session
    expect(s2.intervals).toEqual([200])
  })

  it('caps the interval at 3000 ms', () => {
    const s1 = applyTypeChar(emptySession(), 'a', EXPECTED, T0).session
    const s2 = applyTypeChar(s1, 'b', EXPECTED, T0 + 5000).session
    expect(s2.intervals).toEqual([3000])
  })

  it('does not count an incorrect hit as resetting lastCorrectAt', () => {
    const s1 = applyTypeChar(emptySession(), 'a', EXPECTED, T0).session
    // wrong hit
    const s2 = applyTypeChar(s1, 'x', EXPECTED, T0 + 500).session
    // correct hit — interval should still be measured from T0, not T0+500
    const s3 = applyTypeChar(s2, 'b', EXPECTED, T0 + 700).session
    expect(s3.intervals).toEqual([700])
  })

  it('records key stats for a correct char with the elapsed interval', () => {
    const s1 = applyTypeChar(emptySession(), 'a', EXPECTED, T0).session
    const s2 = applyTypeChar(s1, 'b', EXPECTED, T0 + 200).session
    expect(s2.keyStats['b']).toEqual({ attempts: 1, misses: 0, totalMs: 200 })
  })

  it('records key stats for an incorrect char (attempts+1, misses+1, totalMs=0)', () => {
    const result = applyTypeChar(emptySession(), 'x', EXPECTED, T0)
    expect(result.session.keyStats['a']).toEqual({ attempts: 1, misses: 1, totalMs: 0 })
  })

  it('accumulates key stats across hits on the same key', () => {
    const s1 = applyTypeChar(emptySession(), 'a', 'aa', T0).session
    const s2 = applyTypeChar(s1, 'a', 'aa', T0 + 150).session
    expect(s2.keyStats['a']).toEqual({ attempts: 2, misses: 0, totalMs: 150 })
  })

  it('does not record bigram stats for the first character', () => {
    const result = applyTypeChar(emptySession(), 'a', EXPECTED, T0)
    expect(Object.keys(result.session.bigramStats)).toHaveLength(0)
  })

  it('records bigram stats starting from the second character', () => {
    const s1 = applyTypeChar(emptySession(), 'a', EXPECTED, T0).session
    const s2 = applyTypeChar(s1, 'b', EXPECTED, T0 + 100).session
    expect(s2.bigramStats['ab']).toEqual({ attempts: 1, misses: 0, totalMs: 100 })
  })

  it('records a bigram miss when the character at that position is wrong', () => {
    const s1 = applyTypeChar(emptySession(), 'a', EXPECTED, T0).session
    const result = applyTypeChar(s1, 'x', EXPECTED, T0 + 100)
    expect(result.session.bigramStats['ab']).toEqual({ attempts: 1, misses: 1, totalMs: 0 })
  })

  it('signals completion when the last character is typed correctly', () => {
    const s1 = applyTypeChar(emptySession(), 'a', 'ab', T0).session
    const result = applyTypeChar(s1, 'b', 'ab', T0 + 100)
    expect(result.completed).toBe(true)
    expect(result.session.finishedAt).toBe(T0 + 100)
  })

  it('is a no-op when the session is already finished', () => {
    const finished = session({ pos: 3, finishedAt: T0 })
    const result = applyTypeChar(finished, 'x', EXPECTED, T0 + 1)
    expect(result.session).toBe(finished)
    expect(result.completed).toBe(false)
  })

  it('is a no-op when the position is beyond the expected text', () => {
    const exhausted = session({ pos: EXPECTED.length })
    const result = applyTypeChar(exhausted, 'a', EXPECTED, T0)
    expect(result.session).toBe(exhausted)
    expect(result.completed).toBe(false)
  })

  it('does not mutate the input state', () => {
    const s = emptySession()
    const snapshot = JSON.stringify(s)
    applyTypeChar(s, 'a', EXPECTED, T0)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})

describe('applyBackspace', () => {
  it('decrements pos and clears the status at that position', () => {
    const typed = session({ pos: 2, statuses: ['correct', 'correct', 'pending'] })
    const next = applyBackspace(typed)
    expect(next.pos).toBe(1)
    expect(next.statuses[1]).toBe('pending')
  })

  it('is a reference-identical no-op at pos 0', () => {
    const s = emptySession()
    expect(applyBackspace(s)).toBe(s)
  })

  it('is a reference-identical no-op when the session is finished', () => {
    const finished = session({ pos: 3, finishedAt: T0 })
    expect(applyBackspace(finished)).toBe(finished)
  })

  it('does not mutate the input state', () => {
    const typed = session({ pos: 1, statuses: ['correct'] })
    const snapshot = JSON.stringify(typed)
    applyBackspace(typed)
    expect(JSON.stringify(typed)).toBe(snapshot)
  })
})

describe('computeMetrics', () => {
  it('returns zero wpm and 100 accuracy before any typing', () => {
    const m = computeMetrics(emptySession(), T0)
    expect(m.wpm).toBe(0)
    expect(m.accuracy).toBe(100)
    expect(m.elapsedMs).toBe(0)
  })

  it('computes wpm as (pos / 5 / elapsedSec) * 60', () => {
    // 10 chars in 10 s → (10/5/10)*60 = 12 wpm
    const s = session({ pos: 10, startedAt: T0 })
    expect(computeMetrics(s, T0 + 10_000).wpm).toBe(12)
  })

  it('computes rawWpm including mistake characters', () => {
    // 5 correct + 5 mistakes in 10 s → (10/5/10)*60 = 12 raw wpm
    const s = session({ pos: 5, mistakes: 5, startedAt: T0 })
    expect(computeMetrics(s, T0 + 10_000).rawWpm).toBe(12)
  })

  it('computes accuracy from correct hits vs total attempts', () => {
    const statuses: CharStatus[] = Array.from({ length: 8 }, () => 'correct' as const)
    const s = session({ pos: 8, mistakes: 2, statuses, startedAt: T0 })
    // 8 correct / 10 attempts = 80%
    expect(computeMetrics(s, T0 + 10_000).accuracy).toBe(80)
  })

  it('uses finishedAt instead of now when the session is done', () => {
    const s = session({ pos: 10, startedAt: T0, finishedAt: T0 + 10_000 })
    const m = computeMetrics(s, T0 + 99_999)
    expect(m.elapsedMs).toBe(10_000)
    expect(m.wpm).toBe(12)
  })

  it('returns 100 consistency when fewer than 3 intervals exist', () => {
    const s = session({ intervals: [100, 200], startedAt: T0 })
    expect(computeMetrics(s, T0 + 1000).consistency).toBe(100)
  })

  it('returns lower consistency for highly variable intervals', () => {
    const s = session({ intervals: [100, 100, 2000], startedAt: T0 })
    expect(computeMetrics(s, T0 + 10_000).consistency).toBeLessThan(100)
  })
})

describe('buildRunResult', () => {
  it('combines session state, lesson, and metrics into a RunResult', () => {
    const lesson = { kana: 'あ い', romaji: 'a i', source: 'words' as const }
    const s = session({
      pos: 3,
      mistakes: 1,
      startedAt: T0,
      finishedAt: T0 + 5000,
      keyStats: { a: { attempts: 1, misses: 0, totalMs: 100 } },
    })
    const metrics = computeMetrics(s, T0)
    const run = buildRunResult(s, lesson, metrics, () => '2026-08-20T00:00:00.000Z')
    expect(run.source).toBe('words')
    expect(run.chars).toBe(3) // 'a i'.length
    expect(run.mistakes).toBe(1)
    expect(run.wpm).toBe(metrics.wpm)
    expect(run.accuracy).toBe(metrics.accuracy)
    expect(run.elapsedMs).toBe(metrics.elapsedMs)
    expect(run.date).toBe('2026-08-20T00:00:00.000Z')
    expect(run.keyStats).toEqual(s.keyStats)
    expect(run.bigramStats).toEqual(s.bigramStats)
  })

  it('uses the current wall-clock time when no isoNow is provided', () => {
    const lesson = { kana: 'あ', romaji: 'a', source: 'words' as const }
    const s = session({ pos: 1, startedAt: T0, finishedAt: T0 + 1000 })
    const before = new Date().toISOString()
    const run = buildRunResult(s, lesson, computeMetrics(s, T0))
    const after = new Date().toISOString()
    expect(run.date >= before && run.date <= after).toBe(true)
  })
})
