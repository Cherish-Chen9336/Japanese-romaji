import type {
  AggregatedMoraStat,
  AggregatedTimingStat,
  LifetimeStats,
  RunResult,
  SourceName,
  TimingStat,
  Unlock,
} from './types'

export function dayKey(dateString: string): string {
  return new Date(dateString).toISOString().slice(0, 10)
}

export function runWpm(run: RunResult): number {
  return run.wpm ?? Math.round((run.cpm ?? 0) / 5)
}

export function runRawWpm(run: RunResult): number {
  return run.rawWpm ?? Math.round((run.rawCpm ?? run.cpm ?? 0) / 5)
}

export function unlockedMilestones(lifetime: LifetimeStats): Unlock[] {
  const { bestWpm: best, totalSessions: sessions, totalChars: chars } = lifetime
  return [
    { id: 'first', label: 'first run', reached: sessions >= 1 },
    { id: 'wpm30', label: '30 wpm · difficult unlocked', reached: best >= 30 },
    { id: 'wpm50', label: '50 wpm · quotes unlocked', reached: best >= 50 },
    { id: 'wpm70', label: '70 wpm · library source unlocked', reached: best >= 70 },
    { id: 'wpm100', label: '100 wpm · long-run mastery', reached: best >= 100 },
    { id: 'sessions10', label: '10 sessions', reached: sessions >= 10 },
    { id: 'sessions50', label: '50 sessions', reached: sessions >= 50 },
    { id: 'chars1k', label: '1k characters', reached: chars >= 1_000 },
    { id: 'chars10k', label: '10k characters', reached: chars >= 10_000 },
  ]
}

export function newlyReachedMilestones(before: LifetimeStats, after: LifetimeStats): Unlock[] {
  const oldReached = new Set(unlockedMilestones(before).filter((item) => item.reached).map((item) => item.id))
  return unlockedMilestones(after).filter((item) => item.reached && !oldReached.has(item.id))
}

export function emptyLifetimeStats(): LifetimeStats {
  return { bestWpm: 0, totalSessions: 0, totalChars: 0, totalElapsedMs: 0, streakDays: [] }
}

export function recordRunInLifetimeStats(current: LifetimeStats, run: RunResult): LifetimeStats {
  const day = dayKey(run.date)
  const streakDays = current.streakDays.includes(day) ? current.streakDays : [...current.streakDays, day].sort()
  return {
    bestWpm: Math.max(current.bestWpm, runWpm(run)),
    totalSessions: current.totalSessions + 1,
    totalChars: current.totalChars + run.chars,
    totalElapsedMs: current.totalElapsedMs + run.elapsedMs,
    streakDays,
  }
}

/**
 * One-time bootstrap for existing users: derives lifetime aggregates from
 * whatever run history is currently stored. If that history was already
 * truncated by the old cap before this existed, the bootstrap can only
 * reflect what's still there — it can't recover already-lost data, but it
 * stops any further loss going forward.
 */
export function lifetimeStatsFromRuns(runs: RunResult[]): LifetimeStats {
  return runs.reduce(recordRunInLifetimeStats, emptyLifetimeStats())
}

export function sourceBreakdown(runs: RunResult[]): { source: SourceName; count: number; avg: number }[] {
  const grouped = new Map<SourceName, { count: number; total: number }>()
  for (const run of runs) {
    const current = grouped.get(run.source) ?? { count: 0, total: 0 }
    current.count += 1
    current.total += runWpm(run)
    grouped.set(run.source, current)
  }
  return [...grouped.entries()]
    .map(([source, data]) => ({ source, count: data.count, avg: Math.round(data.total / data.count) }))
    .sort((a, b) => b.count - a.count)
}

export function dailyCounts(runs: RunResult[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const run of runs) {
    const key = dayKey(run.date)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function recentDayKeys(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now)
    date.setUTCDate(date.getUTCDate() - (count - 1 - index))
    return date.toISOString().slice(0, 10)
  })
}

export function mergeTimingStats(
  runs: RunResult[],
  field: 'keyStats' | 'bigramStats' | 'kanaStats',
): Map<string, AggregatedTimingStat> {
  const merged = new Map<string, Required<TimingStat>>()
  for (const run of runs) {
    const stats = run[field] ?? {}
    for (const [key, stat] of Object.entries(stats)) {
      const current = merged.get(key) ?? { attempts: 0, misses: 0, totalMs: 0, timingSamples: 0 }
      current.attempts += stat.attempts
      current.misses += stat.misses
      current.totalMs += stat.totalMs
      // Absent on runs recorded before durations were counted separately from
      // attempts. Falling back to `attempts` reproduces exactly what those runs
      // already displayed, rather than rewriting their history to say something
      // they never measured.
      current.timingSamples += stat.timingSamples ?? stat.attempts
      merged.set(key, current)
    }
  }

  const aggregated = new Map<string, AggregatedTimingStat>()
  for (const [key, stat] of merged) {
    aggregated.set(key, {
      ...stat,
      avgMs: stat.timingSamples > 0 ? stat.totalMs / stat.timingSamples : 0,
      errorRate: stat.attempts > 0 ? stat.misses / stat.attempts : 0,
    })
  }
  return aggregated
}

/**
 * Per-mora stats with the cost of each spelling taken back out.
 *
 * `totalMs` for a mora is the time to type all of its letters, so it rises with
 * the length of the spelling whether or not the typist hesitated: a flawless
 * 100 ms cadence records あ at 100 and しゃ at 300. Subtracting the run's own
 * baseline once per keystroke leaves the hesitation and nothing else, so the two
 * become comparable — both score zero above, and an identical 400 ms stall
 * scores 400 on either.
 *
 * The subtraction is done per run, before summing, because the baseline belongs
 * to the sitting. Pooling raw totals across runs and subtracting one overall
 * cadence at the end would report the difference between a quick day and a tired
 * one as difficulty with a kana.
 *
 * Excess is summed signed, never clamped per encounter. Clamping negatives away
 * would let a long spelling collect positive noise from more keystrokes than a
 * short one can — reintroducing the length bias this exists to remove. Clamp at
 * the point of display instead.
 */
export function mergeMoraStats(runs: RunResult[]): Map<string, AggregatedMoraStat> {
  const merged = new Map<string, { attempts: number; misses: number; samples: number; excess: number }>()
  for (const run of runs) {
    const baseline = run.baselineMs
    for (const [kana, stat] of Object.entries(run.kanaStats ?? {})) {
      const current = merged.get(kana) ?? { attempts: 0, misses: 0, samples: 0, excess: 0 }
      current.attempts += stat.attempts
      current.misses += stat.misses
      // A run with no baseline — too short to establish one, or recorded before
      // baselines existed — still contributes what it saw of accuracy. Its
      // durations are simply not convertible into excess, and inventing one from
      // a different run's cadence would be worse than having none.
      if (typeof baseline === 'number' && typeof stat.timingSamples === 'number') {
        current.samples += stat.timingSamples
        current.excess += stat.totalMs - (stat.keystrokes ?? 0) * baseline
      }
      merged.set(kana, current)
    }
  }

  const aggregated = new Map<string, AggregatedMoraStat>()
  for (const [kana, stat] of merged) {
    aggregated.set(kana, {
      attempts: stat.attempts,
      misses: stat.misses,
      totalMs: stat.excess,
      timingSamples: stat.samples,
      avgMs: stat.samples > 0 ? stat.excess / stat.samples : 0,
      errorRate: stat.attempts > 0 ? stat.misses / stat.attempts : 0,
      excessMs: stat.excess,
      avgExcessMs: stat.samples > 0 ? stat.excess / stat.samples : 0,
    })
  }
  return aggregated
}

/**
 * The slowest keys or pairs, ranked on time alone.
 *
 * This used to sort on `avgMs + errorRate * 500`, which is not a unit error —
 * a rate times milliseconds is milliseconds — but a worse thing: an arbitrary,
 * undocumented exchange rate between speed and accuracy, feeding a list whose
 * heading promises "slowest" and whose only column is milliseconds. An
 * error-prone 50 ms key outranked a clean 200 ms one, and the display gave the
 * reader nothing to explain why.
 *
 * Gated on timing samples rather than attempts, so a key seen only in positions
 * that could not be timed doesn't rank on a duration nobody measured.
 */
export function topTimingStats(
  stats: Map<string, AggregatedTimingStat>,
  limit: number,
): [string, AggregatedTimingStat][] {
  return [...stats.entries()]
    .filter(([, stat]) => (stat.timingSamples ?? stat.attempts) >= 2)
    .sort((a, b) => b[1].avgMs - a[1].avgMs)
    .slice(0, limit)
}

export function streakStats(dayKeys: string[], now: Date = new Date()): { current: number; longest: number } {
  const days = [...new Set(dayKeys)].sort()
  if (days.length === 0) return { current: 0, longest: 0 }

  let longest = 1
  let runLength = 1
  for (let index = 1; index < days.length; index += 1) {
    const prev = new Date(`${days[index - 1]}T00:00:00Z`)
    prev.setUTCDate(prev.getUTCDate() + 1)
    if (prev.toISOString().slice(0, 10) === days[index]) {
      runLength += 1
      longest = Math.max(longest, runLength)
    } else {
      runLength = 1
    }
  }

  const daySet = new Set(days)
  const cursor = new Date(now)
  if (!daySet.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  let current = 0
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    current += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return { current, longest }
}

export function wpmDistribution(runs: RunResult[]): { label: string; count: number }[] {
  const bins = [
    { label: '0-20', min: 0, max: 20, count: 0 },
    { label: '20-40', min: 20, max: 40, count: 0 },
    { label: '40-60', min: 40, max: 60, count: 0 },
    { label: '60-80', min: 60, max: 80, count: 0 },
    { label: '80+', min: 80, max: Number.POSITIVE_INFINITY, count: 0 },
  ]
  for (const run of runs) {
    const wpm = runWpm(run)
    const bin = bins.find((candidate) => wpm >= candidate.min && wpm < candidate.max)
    if (bin) bin.count += 1
  }
  return bins
}

/**
 * Weight of the "probably fine" prior. Small enough that real evidence
 * overwhelms it quickly, large enough that one bad encounter isn't damning.
 */
const PRIOR_MISSES = 0.5
const PRIOR_ATTEMPTS = 2

/**
 * Error rate pulled toward the prior in proportion to how little evidence there
 * is behind it. Used for keys as well as moras — a rarely-pressed key deserves
 * the same scepticism a rarely-met kana gets.
 *
 * A mora missed on both of the two times it has been seen is more
 * clearly weak than one missed twice in eight — 0.63 against 0.25 — but the two
 * are indistinguishable on raw rate, and a hard minimum-attempts floor solved
 * that by discarding the first outright.
 */
export function smoothedErrorRate(stat: AggregatedTimingStat): number {
  return (stat.misses + PRIOR_MISSES) / (stat.attempts + PRIOR_ATTEMPTS)
}

/**
 * The moras you actually get wrong, worst first.
 *
 * Comparable across kana only because an attempt is one encounter with the mora
 * rather than one keystroke. Per-keystroke counting divided the rate by the
 * length of the spelling, so the same single fumble scored あ at 50% and しゃ at
 * 25%, ranking the harder kana as the easier one.
 *
 * Speed breaks ties but never gets a kana in on its own: a mora you have never
 * once mistyped does not belong on a list headed "weakest", however slow it is.
 *
 * The tiebreak is excess time, not raw time. Raw time rises with the length of
 * the spelling, so it handed the tie to whichever mora was spelled with more
 * letters — しゃ over あ for being three keystrokes rather than for being harder.
 */
export function weakestKana(
  stats: Map<string, AggregatedMoraStat>,
  limit = 8,
): [string, AggregatedMoraStat][] {
  return [...stats.entries()]
    .filter(([, stat]) => stat.errorRate > 0)
    .sort((a, b) => smoothedErrorRate(b[1]) - smoothedErrorRate(a[1]) || b[1].avgExcessMs - a[1].avgExcessMs)
    .slice(0, limit)
}

/**
 * The moras that cost you the most time beyond what their spelling explains.
 *
 * A visible companion to the map rather than a second colour on it. Excess is
 * already baseline-adjusted, so this ranks hesitation and not spelling length,
 * and it answers the question the chart's colour deliberately does not: the map
 * says what you get *wrong*, this says what you have to *think about*.
 *
 * Gated on timing samples, because a mora whose every encounter was missed or
 * untimed has no measured duration to rank — only zero, which would otherwise
 * park it at the bottom as though it had been measured and found fast.
 */
export function slowestMoras(
  stats: Map<string, AggregatedMoraStat>,
  limit = 6,
): [string, AggregatedMoraStat][] {
  return [...stats.entries()]
    .filter(([, stat]) => stat.timingSamples >= 2 && stat.avgExcessMs > 0)
    .sort((a, b) => b[1].avgExcessMs - a[1].avgExcessMs)
    .slice(0, limit)
}

/**
 * The moras met least often, including those never met at all.
 *
 * Weakness alone cannot drive practice, because a mora can only be found weak
 * once you have met it and failed it — and if drills serve only what is already
 * known to be weak, you stop meeting anything else. Simulated over 150 runs the
 * pool collapsed to four items and two genuinely difficult moras were never
 * shown once, so their difficulty was never discovered.
 *
 * Mixing the least-practised in alongside the weakest is the exploration half of
 * that: it keeps the corpus circulating so new weaknesses can surface.
 */
export function leastPractisedKana(
  stats: Map<string, AggregatedTimingStat>,
  corpus: readonly string[],
  limit = 4,
): string[] {
  return [...corpus]
    .map((kana) => [kana, stats.get(kana)?.attempts ?? 0] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([kana]) => kana)
}
