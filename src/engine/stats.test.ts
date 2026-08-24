import { describe, expect, it } from 'vitest'
import {
  dailyCounts,
  dayKey,
  emptyLifetimeStats,
  lifetimeStatsFromRuns,
  mergeTimingStats,
  newlyReachedMilestones,
  recentDayKeys,
  recordRunInLifetimeStats,
  runRawWpm,
  runWpm,
  sourceBreakdown,
  streakStats,
  topTimingStats,
  unlockedMilestones,
  weakestKana,
  wpmDistribution,
} from './stats'
import type { LifetimeStats, RunResult, StoredRunResult, TimingStat } from './types'

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

function lifetime(overrides: Partial<LifetimeStats> = {}): LifetimeStats {
  return { ...emptyLifetimeStats(), ...overrides }
}

describe('unlockedMilestones / newlyReachedMilestones', () => {
  it('reaches "first" only once there is at least one session', () => {
    expect(unlockedMilestones(lifetime()).find((m) => m.id === 'first')?.reached).toBe(false)
    expect(unlockedMilestones(lifetime({ totalSessions: 1 })).find((m) => m.id === 'first')?.reached).toBe(true)
  })

  it('gates wpm milestones on the best-ever wpm', () => {
    const milestones = unlockedMilestones(lifetime({ bestWpm: 35 }))
    expect(milestones.find((m) => m.id === 'wpm30')?.reached).toBe(true)
    expect(milestones.find((m) => m.id === 'wpm50')?.reached).toBe(false)
  })

  it('gates chars1k on total-ever characters', () => {
    expect(unlockedMilestones(lifetime({ totalChars: 1_100 })).find((m) => m.id === 'chars1k')?.reached).toBe(true)
  })

  it('newlyReachedMilestones only reports milestones that flipped from unreached to reached', () => {
    const before = lifetime({ totalSessions: 1, bestWpm: 20 })
    const after = lifetime({ totalSessions: 2, bestWpm: 35 })
    const newly = newlyReachedMilestones(before, after)
    expect(newly.map((m) => m.id)).toContain('wpm30')
    expect(newly.map((m) => m.id)).not.toContain('first') // already reached in `before`
  })

  it('returns nothing new when before and after are equivalent', () => {
    const state = lifetime({ totalSessions: 1 })
    expect(newlyReachedMilestones(state, state)).toEqual([])
  })
})

describe('recordRunInLifetimeStats / lifetimeStatsFromRuns', () => {
  it('accumulates bestWpm, totalSessions, totalChars, and totalElapsedMs across runs', () => {
    const runs = [run({ wpm: 20, chars: 10, elapsedMs: 5_000 }), run({ wpm: 45, chars: 15, elapsedMs: 8_000 })]
    const result = runs.reduce(recordRunInLifetimeStats, emptyLifetimeStats())
    expect(result).toEqual({
      bestWpm: 45,
      totalSessions: 2,
      totalChars: 25,
      totalElapsedMs: 13_000,
      streakDays: ['2026-08-01'],
    })
  })

  it('does not let bestWpm regress when a later run is slower', () => {
    const runs = [run({ wpm: 50 }), run({ wpm: 20 })]
    const result = runs.reduce(recordRunInLifetimeStats, emptyLifetimeStats())
    expect(result.bestWpm).toBe(50)
  })

  it('adds each distinct calendar day once, sorted', () => {
    const runs = [
      run({ date: '2026-08-03T01:00:00.000Z' }),
      run({ date: '2026-08-01T01:00:00.000Z' }),
      run({ date: '2026-08-01T20:00:00.000Z' }), // same day as the previous run
    ]
    const result = lifetimeStatsFromRuns(runs)
    expect(result.streakDays).toEqual(['2026-08-01', '2026-08-03'])
  })

  it('lifetimeStatsFromRuns of an empty list is the empty state', () => {
    expect(lifetimeStatsFromRuns([])).toEqual(emptyLifetimeStats())
  })

  it('bootstraps the same totals regardless of run order (migration is order-independent)', () => {
    const runs = [run({ wpm: 20, chars: 10 }), run({ wpm: 45, chars: 15 })]
    const forward = lifetimeStatsFromRuns(runs)
    const reversed = lifetimeStatsFromRuns([...runs].reverse())
    expect(reversed).toEqual(forward)
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
    const days = ['2026-08-16', '2026-08-17', '2026-08-18']
    expect(streakStats(days, now)).toEqual({ current: 3, longest: 3 })
  })

  it('breaks the current streak on a gap before today, but keeps the longest', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const days = ['2026-08-15', '2026-08-16', /* 08-17 missing */ '2026-08-18']
    expect(streakStats(days, now)).toEqual({ current: 1, longest: 2 })
  })

  it('current streak is 0 when there was no activity today or yesterday', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    expect(streakStats(['2026-08-10'], now).current).toBe(0)
  })

  it('returns zeros for no days', () => {
    expect(streakStats([], new Date())).toEqual({ current: 0, longest: 0 })
  })

  it('accepts the day-key list produced by lifetimeStatsFromRuns end to end', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const runs = [
      run({ date: '2026-08-16T01:00:00.000Z' }),
      run({ date: '2026-08-17T01:00:00.000Z' }),
      run({ date: '2026-08-18T01:00:00.000Z' }),
    ]
    const lifetime = lifetimeStatsFromRuns(runs)
    expect(streakStats(lifetime.streakDays, now)).toEqual({ current: 3, longest: 3 })
  })
})

describe('wpmDistribution', () => {
  it('bins runs by wpm into half-open ranges, with 80+ open-ended', () => {
    const runs = [run({ wpm: 0 }), run({ wpm: 19 }), run({ wpm: 20 }), run({ wpm: 79 }), run({ wpm: 80 }), run({ wpm: 200 })]
    const bins = Object.fromEntries(wpmDistribution(runs).map((b) => [b.label, b.count]))
    expect(bins).toEqual({ '0-20': 2, '20-40': 1, '40-60': 0, '60-80': 1, '80+': 2 })
  })
})

describe('weakestKana', () => {
  const stat = (attempts: number, misses: number, avgMs: number) => ({
    attempts,
    misses,
    totalMs: avgMs * attempts,
    avgMs,
    errorRate: misses / attempts,
  })

  it('ranks the highest error rate first', () => {
    const stats = new Map([
      ['か', stat(10, 1, 200)],
      ['しゃ', stat(10, 5, 200)],
      ['き', stat(10, 3, 200)],
    ])
    expect(weakestKana(stats).map(([kana]) => kana)).toEqual(['しゃ', 'き', 'か'])
  })

  it('breaks a tie on error rate with speed', () => {
    const stats = new Map([
      ['か', stat(10, 2, 100)],
      ['き', stat(10, 2, 400)],
    ])
    expect(weakestKana(stats).map(([kana]) => kana)).toEqual(['き', 'か'])
  })

  /*
   * Normalising by exposure is the whole point. On raw miss counts か would win
   * with 5 misses, but it has been seen a hundred times and is fine; しゃ has
   * been seen four times and failed three, which is what needs practice.
   */
  it('ranks by rate, not by how often a kana has been seen', () => {
    const stats = new Map([
      ['か', stat(100, 5, 200)],
      ['しゃ', stat(4, 3, 200)],
    ])
    expect(weakestKana(stats)[0][0]).toBe('しゃ')
  })

  /*
   * The case a hard minimum-attempts floor got wrong. Missing a mora on both of
   * the two times you have seen it is stronger evidence of weakness than
   * missing one twice in eight, but the floor hid the first entirely while
   * ranking the second. Smoothing keeps both, ordered by how much the evidence
   * supports them.
   */
  it('ranks strong evidence above weak evidence rather than discarding it', () => {
    const stats = new Map([['ちゅ', stat(8, 2, 200)], ['しゃ', stat(2, 2, 200)]])
    expect(weakestKana(stats).map(([kana]) => kana)).toEqual(['しゃ', 'ちゅ'])
  })

  it('does not let one unlucky encounter outrank a well-evidenced problem', () => {
    // 1 in 1 is 100% raw, but on almost no evidence; 6 in 10 is 60% on plenty.
    const stats = new Map([['か', stat(1, 1, 200)], ['き', stat(10, 6, 200)]])
    expect(weakestKana(stats).map(([kana]) => kana)).toEqual(['き', 'か'])
  })

  it('still surfaces a kana seen only once, ranked low', () => {
    const stats = new Map([['か', stat(1, 1, 200)]])
    expect(weakestKana(stats).map(([kana]) => kana)).toEqual(['か'])
  })

  /*
   * A mora you have never once mistyped does not belong on a list headed
   * "weakest", however slow it is. The previous guard was `errorRate > 0 ||
   * avgMs > 0`, and since avgMs is above zero for anything ever typed, it
   * excluded nothing at all.
   */
  it('leaves out kana that have never been mistyped, however slow', () => {
    expect(weakestKana(new Map([['か', stat(10, 0, 5000)]]))).toEqual([])
  })

  it('keeps speed as a tiebreak between kana that are both being missed', () => {
    const stats = new Map([['か', stat(10, 2, 100)], ['き', stat(10, 2, 400)]])
    expect(weakestKana(stats).map(([kana]) => kana)).toEqual(['き', 'か'])
  })

  it('caps the list at the requested size', () => {
    const stats = new Map(
      Array.from({ length: 20 }, (_, i) => [`k${i}`, stat(10, i + 1, 100)] as const),
    )
    expect(weakestKana(stats, 3)).toHaveLength(3)
  })
})
