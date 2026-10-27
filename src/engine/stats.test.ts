import { describe, expect, it } from 'vitest'
import { applyTypeChar, buildRunResult, computeMetrics, emptySession } from './session'
import { tokenizeKana } from './romanization'
import {
  dailyCounts,
  dayKey,
  emptyLifetimeStats,
  lifetimeStatsFromRuns,
  mergeMoraStats,
  weakAfterRun,
  isProgressionEligible,
  runMode,
  recentAccuracy,
  slowestMoras,
  weakMoraCount,
  accuracyFloor,
  cohortOf,
  defaultCohort,
  progressPoints,
  runCohorts,
  mergeTimingStats,
  newlyReachedMilestones,
  nextMilestone,
  recentDayKeys,
  recordRunInLifetimeStats,
  runRawWpm,
  runWpm,
  streakStats,
  topTimingStats,
  leastPractisedKana,
  unlockedMilestones,
  weakestKana,
} from './stats'
import type { LifetimeStats, RunResult, SourceName, StoredRunResult, TimingStat } from './types'

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

  /* Thresholds read from the source table, not restated — restating them here
     is the same duplication the milestones themselves were guilty of. */
  it('gates wpm milestones on the best-ever wpm', () => {
    const milestones = unlockedMilestones(lifetime({ bestWpm: 35 }))
    expect(milestones.find((m) => m.id === 'wpm30')?.reached).toBe(true)
    expect(milestones.find((m) => m.id === 'wpm50')?.reached).toBe(false)
  })

  /* Milestones mark speed reached. Nothing is unlocked by them any more, so
     none of them may claim to be. */
  it('does not promise that anything unlocks', () => {
    const labels = unlockedMilestones(lifetime({ bestWpm: 999 })).map((m) => m.label)
    expect(labels.some((label) => label.includes('unlocked'))).toBe(false)
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
    // Neither run carries `timingSamples` — the shape written before durations
    // were counted apart from attempts. The denominator falls back to attempts,
    // so these runs still report exactly the average they always did.
    expect(merged.get('a')).toEqual({
      attempts: 5,
      misses: 1,
      totalMs: 500,
      timingSamples: 5,
      avgMs: 100,
      errorRate: 0.2,
    })
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

  /*
   * Time alone. The old comparator added `errorRate * 500` to the average, an
   * undocumented exchange rate between speed and accuracy, and it put a clean
   * 200 ms key below an error-prone 50 ms one in a list headed "slowest" whose
   * only column is milliseconds — the reader had no way to see why.
   */
  it('sorts by time alone, descending, and respects the limit', () => {
    const stats = new Map([
      ['slow', { attempts: 2, misses: 0, totalMs: 400, timingSamples: 2, avgMs: 200, errorRate: 0 }],
      ['error-prone', { attempts: 2, misses: 2, totalMs: 100, timingSamples: 2, avgMs: 50, errorRate: 1 }],
      ['fast', { attempts: 2, misses: 0, totalMs: 20, timingSamples: 2, avgMs: 10, errorRate: 0 }],
    ])
    const top = topTimingStats(stats, 2)
    expect(top.map(([key]) => key)).toEqual(['slow', 'error-prone'])
  })

  /*
   * Gated on measured durations, not attempts. A key seen twice but never in a
   * timeable position has no average to rank on, and ranking it on the zero it
   * was never observed to take put it at the bottom of a "slowest" list as if
   * that had been measured.
   */
  it('excludes a key with attempts but no timed samples', () => {
    const stats = new Map([
      ['untimed', { attempts: 5, misses: 0, totalMs: 0, timingSamples: 0, avgMs: 0, errorRate: 0 }],
      ['timed', { attempts: 2, misses: 0, totalMs: 200, timingSamples: 2, avgMs: 100, errorRate: 0 }],
    ])
    expect(topTimingStats(stats, 10).map(([key]) => key)).toEqual(['timed'])
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

describe('weakestKana', () => {
  /* `avgMs` here is excess time — what the mora cost beyond its spelling. */
  const stat = (attempts: number, misses: number, avgMs: number) => ({
    attempts,
    misses,
    totalMs: avgMs * attempts,
    timingSamples: attempts,
    avgMs,
    errorRate: misses / attempts,
    excessMs: avgMs * attempts,
    avgExcessMs: avgMs,
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

describe('leastPractisedKana', () => {
  const stat = (attempts: number) => ({
    attempts, misses: 0, totalMs: attempts * 100, avgMs: 100, errorRate: 0,
  })

  it('puts moras never met at all first', () => {
    const stats = new Map([['か', stat(10)], ['き', stat(3)]])
    expect(leastPractisedKana(stats, ['か', 'き', 'く'], 2)).toEqual(['く', 'き'])
  })

  it('orders by how often each has been met', () => {
    const stats = new Map([['か', stat(10)], ['き', stat(1)], ['く', stat(5)]])
    expect(leastPractisedKana(stats, ['か', 'き', 'く'], 3)).toEqual(['き', 'く', 'か'])
  })

  it('caps the list at the requested size', () => {
    expect(leastPractisedKana(new Map(), ['あ', 'い', 'う', 'え'], 2)).toHaveLength(2)
  })

  /*
   * Why this exists. A mora is only found weak once you have met it and failed
   * it, so a drill pool built only from known weaknesses stops showing you
   * anything else and new weaknesses never surface. Simulated over 150 runs the
   * pool collapsed to four items and two genuinely hard moras were never shown
   * once. Weakness exploits; this explores.
   */
  it('keeps naming unmet moras no matter how much has been practised', () => {
    const corpus = ['あ', 'い', 'う', 'え', 'お']
    const heavilyPractised = new Map(corpus.slice(0, 4).map((k) => [k, stat(500)]))
    expect(leastPractisedKana(heavilyPractised, corpus, 1)).toEqual(['お'])
  })
})

describe('mergeMoraStats', () => {
  /**
   * Drives the real session so these assertions run against the engine that
   * records the numbers, not against a hand-built fixture that could agree with
   * a broken implementation. `gapsMs` is the pause before each keystroke.
   */
  function runOf(kana: string, romaji: string, gapsMs: number[]) {
    const tokens = tokenizeKana(kana)
    let state = emptySession()
    let at = 1_000
    romaji.split('').forEach((char, index) => {
      at += gapsMs[index]
      state = applyTypeChar(state, char, tokens, at, true).session
    })
    const lesson = { kana, romaji, source: 'words' as const, items: [{ kana, romaji }] }
    return buildRunResult(state, lesson, computeMetrics(state, at), () => '2026-08-01T00:00:00.000Z')
  }

  const steady = (romaji: string) => new Array(romaji.length).fill(100)

  /*
   * The bug this whole statistic exists to fix. A flawless typist at a constant
   * 100 ms, no mistakes and no hesitation anywhere, used to record あ at 0 ms,
   * か at 200 and しゃ at 300 — and `weakestKana` broke ties on that, handing the
   * tie to whichever mora was spelled with more letters. Subtracting the run's
   * own cadence once per keystroke leaves nothing, which is the truth: this
   * typist found none of them hard.
   */
  it('charges no excess to a mora typed at the run\'s own cadence, whatever its length', () => {
    const kana = 'あかしゃちゅ'
    const romaji = 'akashachu'
    const merged = mergeMoraStats([runOf(kana, romaji, steady(romaji))])
    for (const mora of ['か', 'しゃ', 'ちゅ']) {
      expect(merged.get(mora)?.avgExcessMs, mora).toBe(0)
    }
    // All three genuinely measured — a zero from having no samples would pass
    // the assertion above while measuring nothing at all.
    for (const mora of ['か', 'しゃ', 'ちゅ']) {
      expect(merged.get(mora)?.timingSamples, mora).toBe(1)
    }
  })

  /*
   * The other half of comparability: an identical stall has to score identically
   * whatever the spelling costs. Dividing by keystrokes instead — the obvious
   * alternative — scored this 400 on あ and 133 on ちゅ, making the longer mora
   * look easier for exactly the same hesitation.
   */
  it('charges an identical hesitation identically, whatever the spelling length', () => {
    const kana = 'あかしゃちゅ'
    const romaji = 'akashachu'
    const stall = steady(romaji)
    stall[6] = 500 // the pause before ちゅ's first key
    const merged = mergeMoraStats([runOf(kana, romaji, stall)])
    expect(merged.get('ちゅ')?.avgExcessMs).toBe(400)
    expect(merged.get('か')?.avgExcessMs).toBe(0)
  })

  /*
   * The baseline belongs to the sitting. Pooling raw totals across runs and
   * subtracting one overall cadence would report the gap between a quick day and
   * a slow one as difficulty with a kana: here the second run is uniformly twice
   * as slow, and neither run contains a moment of hesitation.
   */
  it('measures each run against its own cadence, not a pooled one', () => {
    const kana = 'あかしゃちゅ'
    const romaji = 'akashachu'
    const slow = new Array(romaji.length).fill(200)
    const merged = mergeMoraStats([runOf(kana, romaji, steady(romaji)), runOf(kana, romaji, slow)])
    expect(merged.get('しゃ')?.excessMs).toBe(0)
    expect(merged.get('しゃ')?.timingSamples).toBe(2)
  })

  /*
   * A run written before baselines existed still knows what it got wrong. Its
   * durations are whole-mora totals that cannot be converted into excess, and
   * borrowing another run's cadence to convert them would invent a number.
   */
  it('reads a run with no baseline for accuracy and not for time', () => {
    const legacy = run({ kanaStats: { し: { attempts: 4, misses: 1, totalMs: 1_200 } } })
    const merged = mergeMoraStats([legacy])
    expect(merged.get('し')?.attempts).toBe(4)
    expect(merged.get('し')?.errorRate).toBe(0.25)
    expect(merged.get('し')?.timingSamples).toBe(0)
    expect(merged.get('し')?.excessMs).toBe(0)
  })

  it('treats a missing kanaStats field as empty', () => {
    expect(mergeMoraStats([run()]).size).toBe(0)
  })
})

describe('weakAfterRun', () => {
  /* A run's own per-mora record, in the shape `buildRunResult` writes. */
  const rec = (attempts: number, misses: number) => ({ attempts, misses, totalMs: 0, timingSamples: 0 })
  const life = (attempts: number, misses: number) => ({
    attempts, misses, totalMs: 0, timingSamples: attempts,
    avgMs: 0, errorRate: misses / attempts, excessMs: 0, avgExcessMs: 0,
  })

  it('reports only the moras this run actually got wrong', () => {
    const r = run({ kanaStats: { か: rec(3, 1), き: rec(4, 0) } })
    expect(weakAfterRun(r, new Map()).map((w) => w.kana)).toEqual(['か'])
  })

  /*
   * Ordered by lifetime weakness, not by misses in this run: drills pull in that
   * order, so the list predicts what the next run targets instead of merely
   * restating what this one did. か was fumbled three times but is fine overall;
   * き has been missed nearly every time it has ever appeared.
   */
  it('orders by how weak a mora is overall, not by this run alone', () => {
    const r = run({ kanaStats: { か: rec(40, 3), き: rec(2, 1) } })
    const lifetime = new Map([['か', life(200, 3)], ['き', life(3, 2)]])
    expect(weakAfterRun(r, lifetime).map((w) => w.kana)).toEqual(['き', 'か'])
  })

  /*
   * Lifetime totals already include the run being reported, so more misses
   * overall than in this run is precisely "you have missed this before".
   */
  it('separates a mora missed before from one fumbled only now', () => {
    const r = run({ kanaStats: { か: rec(2, 1), き: rec(2, 1) } })
    const lifetime = new Map([['か', life(20, 5)], ['き', life(2, 1)]])
    const byKana = Object.fromEntries(weakAfterRun(r, lifetime).map((w) => [w.kana, w.recurring]))
    expect(byKana).toEqual({ か: true, き: false })
  })

  it('respects the limit and survives a run with no kana stats', () => {
    const r = run({ kanaStats: { か: rec(2, 1), き: rec(2, 2) } })
    expect(weakAfterRun(r, new Map(), 1)).toHaveLength(1)
    expect(weakAfterRun(run(), new Map())).toEqual([])
  })
})

describe('run mode and progression eligibility', () => {
  const timed = (durationMs: number) => ({ kind: 'timed' as const, durationMs })

  /* Every run predating time mode was a passage run, so absence is not unknown. */
  it('reads a run with no mode as a passage run', () => {
    expect(runMode(run())).toEqual({ kind: 'passage' })
  })

  /*
   * Passage runs always count, however long the passage. They already vary from
   * three items to thirty across different sources and error settings, so length
   * was never what made them comparable.
   */
  it('counts every passage run toward progression', () => {
    expect(isProgressionEligible(run({ chars: 20 }))).toBe(true)
    expect(isProgressionEligible(run({ chars: 400 }))).toBe(true)
  })

  /*
   * A fifteen-second sprint is a different test from a sixty-second run. Pooled,
   * the shorter one takes the record for reasons that have nothing to do with
   * typing — you can hold a sprint pace you could not hold for a minute.
   */
  it('counts a standard timed run but not a shorter sprint', () => {
    expect(isProgressionEligible(run({ mode: timed(60_000) }))).toBe(true)
    expect(isProgressionEligible(run({ mode: timed(15_000) }))).toBe(false)
  })

  it('does not let an ineligible run take the personal best', () => {
    const before = { ...emptyLifetimeStats(), bestWpm: 40 }
    const after = recordRunInLifetimeStats(before, run({ wpm: 120, mode: timed(15_000) }))
    expect(after.bestWpm).toBe(40)
  })

  /* Ineligible for the *ranking*, but it still happened: totals and streaks take it. */
  it('still counts an ineligible run toward totals and streaks', () => {
    const after = recordRunInLifetimeStats(emptyLifetimeStats(), run({ chars: 50, mode: timed(15_000) }))
    expect(after.totalSessions).toBe(1)
    expect(after.totalChars).toBe(50)
    expect(after.streakDays).toHaveLength(1)
  })

  /* The chart's own cohort filter already separates timed from passage, so what
     eligibility gates here is the record surfaces, not the plot. */
  it('keeps an ineligible run out of recent accuracy', () => {
    expect(recentAccuracy([run({ accuracy: 100, mode: timed(15_000) }), run({ accuracy: 60 })], 5)).toBe(60)
  })
})

describe('recentAccuracy', () => {
  /*
   * The page used to show the live typing session's accuracy here. On the
   * statistics route that session is empty, so it read 100% whatever the history
   * said — a number that could not be wrong, and therefore measured nothing.
   */
  it('averages the most recent runs, newest first', () => {
    const runs = [run({ accuracy: 90 }), run({ accuracy: 80 }), run({ accuracy: 40 })]
    expect(recentAccuracy(runs, 2)).toBe(85)
  })

  it('is zero with no history rather than a flattering 100', () => {
    expect(recentAccuracy([])).toBe(0)
  })

  it('ignores runs that cannot set a record', () => {
    const runs = [run({ accuracy: 100, mode: { kind: 'timed', durationMs: 15_000 } }), run({ accuracy: 60 })]
    expect(recentAccuracy(runs, 5)).toBe(60)
  })
})

describe('weakMoraCount', () => {
  it('counts only moras actually missed', () => {
    const stat = (attempts: number, misses: number) => ({
      attempts, misses, totalMs: 0, timingSamples: 0,
      avgMs: 0, errorRate: misses / attempts, excessMs: 0, avgExcessMs: 0,
    })
    const stats = new Map([['か', stat(9, 0)], ['き', stat(4, 1)], ['く', stat(2, 2)]])
    expect(weakMoraCount(stats)).toBe(2)
    expect(weakMoraCount(new Map())).toBe(0)
  })
})

describe('cohorts', () => {
  const timed = (durationMs: number) => ({ kind: 'timed' as const, durationMs })

  /*
   * Runs are not interchangeable. The banks differ in difficulty by
   * construction and `drills` deliberately serves the moras you are worst at, so
   * a line from a drills run to a quotes run asserts a comparison that does not
   * exist. Smoothing does not repair that — it reduces noise, it does not make
   * unlike tasks alike.
   */
  it('separates sources, and passage from timed', () => {
    expect(cohortOf(run({ source: 'words' }))).toBe('words:passage')
    expect(cohortOf(run({ source: 'quotes' }))).not.toBe(cohortOf(run({ source: 'words' })))
    expect(cohortOf(run({ source: 'words', mode: timed(60_000) }))).not.toBe('words:passage')
  })

  /* Two durations are two different tests, not one test at two lengths. */
  it('separates timed runs of different durations', () => {
    expect(cohortOf(run({ source: 'words', mode: timed(60_000) }))).not.toBe(
      cohortOf(run({ source: 'words', mode: timed(15_000) })),
    )
  })

  it('lists the cohorts present, most practised first', () => {
    const runs = [run({ source: 'words' }), run({ source: 'quotes' }), run({ source: 'words' })]
    const cohorts = runCohorts(runs)
    expect(cohorts.map((c) => c.key)).toEqual(['words:passage', 'quotes:passage'])
    expect(cohorts[0].count).toBe(2)
  })

  it('labels a timed cohort with its duration', () => {
    expect(runCohorts([run({ source: 'words', mode: timed(60_000) })])[0].label).toBe('words · 60s')
  })

  /*
   * The cohort reads the source's *label*, not its stored name. These two
   * differ for `quotes`, whose bank is proverbs — and this is the surface that
   * made a label-only rename insufficient, because it spelled the wording out
   * for itself and so went on saying "quotes" beside a picker that no longer
   * did. The key stays the stored name, so old runs still group with new ones.
   */
  it('labels a cohort with the source label while keying on the stored name', () => {
    const [cohort] = runCohorts([run({ source: 'quotes' })])
    expect(cohort.label).toBe('proverbs')
    expect(cohort.key).toBe('quotes:passage')
    expect(cohort.source).toBe('quotes')
  })

  it('carries the label into a timed cohort too', () => {
    expect(runCohorts([run({ source: 'quotes', mode: timed(60_000) })])[0].label).toBe('proverbs · 60s')
  })

  /* A run stored by a build that knew a source this one does not still has to
     render as something a person can read, not as "undefined". */
  it('falls back to the stored name when no label is known', () => {
    const [cohort] = runCohorts([run({ source: 'retired-source' as SourceName })])
    expect(cohort.label).toBe('retired-source')
  })

  /*
   * The most recent run's cohort, not the largest. Defaulting to whichever has
   * the most history would answer a question about a kind of practice the typist
   * may have stopped doing.
   */
  it('defaults to the cohort of the latest run, not the biggest', () => {
    const runs = [run({ source: 'quotes' }), run({ source: 'words' }), run({ source: 'words' })]
    expect(defaultCohort(runs)).toBe('quotes:passage')
    expect(defaultCohort([])).toBeNull()
  })
})

describe('progressPoints', () => {
  const at = (wpm: number, accuracy: number, source: SourceName = 'words') => run({ wpm, accuracy, source })

  it('returns only the chosen cohort, oldest first', () => {
    const runs = [at(50, 95), at(40, 90, 'quotes'), at(30, 99)]
    expect(progressPoints(runs, 'words:passage').map((p) => p.wpm)).toEqual([30, 50])
  })

  it('carries both measures without mixing them', () => {
    const [point] = progressPoints([at(44, 91)], 'words:passage')
    expect(point.wpm).toBe(44)
    expect(point.accuracy).toBe(91)
  })

  /* One unlucky run should bend the raw dot, not the trend. */
  it('smooths each measure over its own window', () => {
    const runs = [at(40, 96), at(41, 95), at(10, 60), at(39, 95), at(40, 96)]
    const points = progressPoints(runs.reverse(), 'words:passage')
    expect(points[2].wpm).toBe(10)
    expect(points[2].wpmMedian).toBeGreaterThan(30)
    expect(points[2].accuracyMedian).toBeGreaterThan(90)
  })

  it('respects the limit', () => {
    expect(progressPoints([at(1, 90), at(2, 90), at(3, 90)], 'words:passage', 2)).toHaveLength(2)
  })
})

describe('accuracyFloor', () => {
  /*
   * A competent typist lives between 88% and 100%. On a 0-100 axis that is a
   * flat line saying nothing, so the axis is truncated — and always drawn with
   * ticks, because a truncated scale is honest when it is labelled and
   * misleading when it is not.
   */
  it('rounds down in fives with headroom below the worst run', () => {
    expect(accuracyFloor([{ accuracy: 96 }, { accuracy: 92 }])).toBe(90)
    expect(accuracyFloor([{ accuracy: 96 }, { accuracy: 81 }])).toBe(75)
  })

  it('never rises above 90, however good the typist', () => {
    expect(accuracyFloor([{ accuracy: 100 }, { accuracy: 100 }])).toBe(90)
  })

  it('never goes below zero, however bad', () => {
    expect(accuracyFloor([{ accuracy: 1 }])).toBe(0)
  })

  it('has a sensible floor with nothing to plot', () => {
    expect(accuracyFloor([])).toBe(90)
  })
})

describe('slowestMoras', () => {
  const mora = (samples: number, excess: number) => ({
    attempts: samples,
    misses: 0,
    totalMs: 0,
    timingSamples: samples,
    avgMs: excess,
    errorRate: 0,
    excessMs: excess * samples,
    avgExcessMs: excess,
  })

  it('ranks by how much time a mora costs beyond its spelling', () => {
    const stats = new Map([['か', mora(4, 20)], ['しゃ', mora(4, 300)], ['き', mora(4, 120)]])
    expect(slowestMoras(stats).map(([kana]) => kana)).toEqual(['しゃ', 'き', 'か'])
  })

  /*
   * A mora typed at or faster than your own cadence is not slow, and listing it
   * under "slowest" because the list was short would be inventing a problem.
   */
  it('leaves out moras that cost no extra time', () => {
    expect(slowestMoras(new Map([['か', mora(4, 0)], ['き', mora(4, -50)]]))).toEqual([])
  })

  /*
   * A mora whose every encounter was missed or untimed has no measured duration.
   * Ranked on the zero it was never observed to take, it would sit at the bottom
   * of the list as though it had been measured and found fast.
   */
  it('leaves out a mora with no timed samples', () => {
    const stats = new Map([['か', { ...mora(0, 0), attempts: 5, timingSamples: 0, avgExcessMs: 0 }]])
    expect(slowestMoras(stats)).toEqual([])
  })

  it('respects the limit', () => {
    const stats = new Map([['か', mora(4, 10)], ['き', mora(4, 20)], ['く', mora(4, 30)]])
    expect(slowestMoras(stats, 2).map(([kana]) => kana)).toEqual(['く', 'き'])
  })
})

describe('nextMilestone', () => {
  /*
   * `newlyReachedMilestones` fires only on the run that crosses a threshold, so
   * an established profile saw nothing. A section that appears once and never
   * again is a flash, not a surface — this is what the result screen aims at.
   */
  it('names the nearest one still ahead', () => {
    const fresh = nextMilestone(emptyLifetimeStats())
    expect(fresh?.reached).toBe(false)
    expect(fresh?.id).toBe('first')
  })

  it('moves on as milestones are reached', () => {
    const after = nextMilestone({ ...emptyLifetimeStats(), totalSessions: 1 })
    expect(after?.id).not.toBe('first')
    expect(after?.reached).toBe(false)
  })

  it('is null once every milestone is behind you', () => {
    const done = { bestWpm: 999, totalSessions: 999, totalChars: 999_999, totalElapsedMs: 0, streakDays: [] }
    expect(nextMilestone(done)).toBeNull()
  })
})
