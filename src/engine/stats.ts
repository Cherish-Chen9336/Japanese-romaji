import type { AggregatedTimingStat, LifetimeStats, RunResult, SourceName, TimingStat, Unlock } from './types'

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
  field: 'keyStats' | 'bigramStats',
): Map<string, AggregatedTimingStat> {
  const merged = new Map<string, TimingStat>()
  for (const run of runs) {
    const stats = run[field] ?? {}
    for (const [key, stat] of Object.entries(stats)) {
      const current = merged.get(key) ?? { attempts: 0, misses: 0, totalMs: 0 }
      current.attempts += stat.attempts
      current.misses += stat.misses
      current.totalMs += stat.totalMs
      merged.set(key, current)
    }
  }

  const aggregated = new Map<string, AggregatedTimingStat>()
  for (const [key, stat] of merged) {
    aggregated.set(key, {
      ...stat,
      avgMs: stat.attempts > 0 ? stat.totalMs / stat.attempts : 0,
      errorRate: stat.attempts > 0 ? stat.misses / stat.attempts : 0,
    })
  }
  return aggregated
}

export function topTimingStats(
  stats: Map<string, AggregatedTimingStat>,
  limit: number,
): [string, AggregatedTimingStat][] {
  return [...stats.entries()]
    .filter(([, stat]) => stat.attempts >= 2)
    .sort((a, b) => b[1].avgMs + b[1].errorRate * 500 - (a[1].avgMs + a[1].errorRate * 500))
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
