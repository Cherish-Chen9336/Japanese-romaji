import { describe, expect, it } from 'vitest'
import {
  dailyCounts,
  dayKey,
  mergeTimingStats,
  newlyReachedMilestones,
  recentDayKeys,
  runRawWpm,
  runWpm,
  sourceBreakdown,
  streakStats,
  topTimingStats,
  unlockedMilestones,
  wpmDistribution,
} from './stats'
import type { RunResult, StoredRunResult, TimingStat } from './types'

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    source: 'words',
    chars: 10,
    mistakes: 0,
    accuracy: 100,
    wpm: 30,
    elapsedMs: 10_000,
    date: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('dayKey', () => {
  it('extracts the UTC date portion of an ISO timestamp', () => {
    expect(dayKey('2026-08-20T23:59:00.000Z')).toBe('2026-08-20')
  })
})

describe('runWpm / runRawWpm', () => {
  it('prefers the explicit wpm/rawWpm field when present', () => {
    expect(runWpm(run({ wpm: 42 }))).toBe(42)
    expect(runRawWpm(run({ rawWpm: 50 }))).toBe(50)
  })

  it('falls back to cpm/5 when wpm is absent (legacy stored record)', () => {
    const legacy: StoredRunResult = { ...run(), wpm: undefined, cpm: 250 }
    expect(runWpm(legacy as RunResult)).toBe(50)
  })

  it('falls back to rawCpm, then cpm, then 0 for rawWpm', () => {
    expect(runRawWpm(run({ rawWpm: undefined, rawCpm: 100 }))).toBe(20)
    expect(runRawWpm(run({ rawWpm: undefined, rawCpm: undefined, cpm: 150 }))).toBe(30)
    expect(runRawWpm(run({ rawWpm: undefined, rawCpm: undefined, cpm: undefined }))).toBe(0)
  })
})

describe('unlockedMilestones / newlyReachedMilestones', () => {
  it('reaches "first" only once there is at least one run', () => {
    expect(unlockedMilestones([]).find((m) => m.id === 'first')?.reached).toBe(false)
    expect(unlockedMilestones([run()]).find((m) => m.id === 'first')?.reached).toBe(true)
  })

  it('gates wpm milestones on the best run, not the latest', () => {
    const runs = [run({ wpm: 10 }), run({ wpm: 35 })]
    const milestones = unlockedMilestones(runs)
    expect(milestones.find((m) => m.id === 'wpm30')?.reached).toBe(true)
    expect(milestones.find((m) => m.id === 'wpm50')?.reached).toBe(false)
  })

  it('gates chars1k on the summed characters across all runs', () => {
    const runs = [run({ chars: 600 }), run({ chars: 500 })]
    expect(unlockedMilestones(runs).find((m) => m.id === 'chars1k')?.reached).toBe(true)
  })

  it('newlyReachedMilestones only reports milestones that flipped from unreached to reached', () => {
    const before = [run({ wpm: 20 })]
    const after = [...before, run({ wpm: 35 })]
    const newly = newlyReachedMilestones(before, after)
    expect(newly.map((m) => m.id)).toContain('wpm30')
    expect(newly.map((m) => m.id)).not.toContain('first') // already reached in `before`
  })

  it('returns nothing new when before and after are equivalent', () => {
    const runs = [run()]
    expect(newlyReachedMilestones(runs, runs)).toEqual([])
  })
})

describe('sourceBreakdown', () => {
  it('groups by source, averages wpm, and sorts by count desc', () => {
    const runs = [
      run({ source: 'words', wpm: 20 }),
      run({ source: 'words', wpm: 40 }),
      run({ source: 'quotes', wpm: 10 }),
    ]
    const breakdown = sourceBreakdown(runs)
    expect(breakdown[0]).toEqual({ source: 'words', count: 2, avg: 30 })
    expect(breakdown[1]).toEqual({ source: 'quotes', count: 1, avg: 10 })
  })

  it('returns an empty array for no runs', () => {
    expect(sourceBreakdown([])).toEqual([])
  })
})

describe('dailyCounts', () => {
  it('counts runs per UTC day', () => {
    const runs = [
      run({ date: '2026-08-01T01:00:00.000Z' }),
      run({ date: '2026-08-01T20:00:00.000Z' }),
      run({ date: '2026-08-02T01:00:00.000Z' }),
    ]
    const counts = dailyCounts(runs)
    expect(counts.get('2026-08-01')).toBe(2)
    expect(counts.get('2026-08-02')).toBe(1)
  })
})

describe('recentDayKeys', () => {
  it('returns `count` day keys ending at `now`, oldest first', () => {
    const now = new Date('2026-08-20T12:00:00.000Z')
    expect(recentDayKeys(3, now)).toEqual(['2026-08-18', '2026-08-19', '2026-08-20'])
  })

  it('does not mutate the `now` argument', () => {
    const now = new Date('2026-08-20T12:00:00.000Z')
    const copy = new Date(now)
    recentDayKeys(5, now)
    expect(now).toEqual(copy)
  })
})

describe('mergeTimingStats', () => {
  it('sums attempts/misses/totalMs per key across runs and derives avg/errorRate', () => {
    const statA: TimingStat = { attempts: 2, misses: 1, totalMs: 200 }
    const statB: TimingStat = { attempts: 3, misses: 0, totalMs: 300 }
    const runs = [run({ keyStats: { a: statA } }), run({ keyStats: { a: statB } })]
    const merged = mergeTimingStats(runs, 'keyStats')
    expect(merged.get('a')).toEqual({ attempts: 5, misses: 1, totalMs: 500, avgMs: 100, errorRate: 0.2 })
  })

  it('treats a missing keyStats/bigramStats field as empty', () => {
    const merged = mergeTimingStats([run()], 'bigramStats')
    expect(merged.size).toBe(0)
  })
})

describe('topTimingStats', () => {
  it('excludes keys with fewer than 2 attempts', () => {
    const stats = new Map([
      ['rare', { attempts: 1, misses: 0, totalMs: 1000, avgMs: 1000, errorRate: 0 }],
      ['common', { attempts: 5, misses: 1, totalMs: 500, avgMs: 100, errorRate: 0.2 }],
    ])
    const top = topTimingStats(stats, 10)
    expect(top.map(([key]) => key)).toEqual(['common'])
  })

  it('sorts by avgMs + errorRate * 500, descending, and respects the limit', () => {
    const stats = new Map([
      ['slow', { attempts: 2, misses: 0, totalMs: 400, avgMs: 200, errorRate: 0 }],
      ['error-prone', { attempts: 2, misses: 2, totalMs: 100, avgMs: 50, errorRate: 1 }],
      ['fast', { attempts: 2, misses: 0, totalMs: 20, avgMs: 10, errorRate: 0 }],
    ])
    const top = topTimingStats(stats, 2)
    expect(top.map(([key]) => key)).toEqual(['error-prone', 'slow'])
  })
})

describe('streakStats', () => {
  it('counts a run of consecutive days ending today as the current streak', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const runs = [
      run({ date: '2026-08-16T01:00:00.000Z' }),
      run({ date: '2026-08-17T01:00:00.000Z' }),
      run({ date: '2026-08-18T01:00:00.000Z' }),
    ]
    expect(streakStats(runs, now)).toEqual({ current: 3, longest: 3 })
  })

  it('breaks the current streak on a gap before today, but keeps the longest', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const runs = [
      run({ date: '2026-08-15T01:00:00.000Z' }),
      run({ date: '2026-08-16T01:00:00.000Z' }),
      // 08-17 missing
      run({ date: '2026-08-18T01:00:00.000Z' }),
    ]
    expect(streakStats(runs, now)).toEqual({ current: 1, longest: 2 })
  })

  it('current streak is 0 when there was no run today or yesterday', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const runs = [run({ date: '2026-08-10T01:00:00.000Z' })]
    expect(streakStats(runs, now).current).toBe(0)
  })

  it('returns zeros for no runs', () => {
    expect(streakStats([], new Date())).toEqual({ current: 0, longest: 0 })
  })
})

describe('wpmDistribution', () => {
  it('bins runs by wpm into half-open ranges, with 80+ open-ended', () => {
    const runs = [run({ wpm: 0 }), run({ wpm: 19 }), run({ wpm: 20 }), run({ wpm: 79 }), run({ wpm: 80 }), run({ wpm: 200 })]
    const bins = Object.fromEntries(wpmDistribution(runs).map((b) => [b.label, b.count]))
    expect(bins).toEqual({ '0-20': 2, '20-40': 1, '40-60': 0, '60-80': 1, '80+': 2 })
  })
})
