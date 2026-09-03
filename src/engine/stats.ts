import type {
  AggregatedMoraStat,
  AggregatedTimingStat,
  LifetimeStats,
  RunMode,
  RunResult,
  TimingStat,
  Unlock,
} from './types'
import { STANDARD_TIMED_MS } from './types'
import type { SourceName } from './types'

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

/** A run's mode, reading the absence on older records as what it meant. */
export function runMode(run: RunResult): RunMode {
  return run.mode ?? { kind: 'passage' }
}

/**
 * Whether a run may set a personal best, unlock a source, or join the speed
 * distribution.
 *
 * One place, rather than a `run.mode` check at each of the four sites that care.
 * A passage run always counts, however long its passage: those already vary from
 * three items to thirty across different sources and error settings, so length
 * has never been what made them comparable. A timed run counts only at the
 * standard duration — a fifteen-second sprint measured against a sixty-second
 * run is a different test, and pooling the two would let the shorter one own the
 * record for reasons that have nothing to do with typing.
 *
 * Every run, eligible or not, still contributes to mastery, totals and streaks.
 * This governs the *ranking* surfaces alone.
 */
export function isProgressionEligible(run: RunResult): boolean {
  const mode = runMode(run)
  return mode.kind === 'passage' || mode.durationMs === STANDARD_TIMED_MS
}

export function recordRunInLifetimeStats(current: LifetimeStats, run: RunResult): LifetimeStats {
  const day = dayKey(run.date)
  const streakDays = current.streakDays.includes(day) ? current.streakDays : [...current.streakDays, day].sort()
  return {
    // Totals, sessions and streaks take every run; only the best is gated.
    bestWpm: isProgressionEligible(run) ? Math.max(current.bestWpm, runWpm(run)) : current.bestWpm,
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

/**
 * Accuracy over the last few runs, which is what "how accurate am I" means.
 *
 * The statistics page used to show the *live typing session's* accuracy here —
 * an empty session on that route, so it read 100% however the history actually
 * looked. A number that cannot be wrong is not a measurement.
 */
export function recentAccuracy(runs: RunResult[], count = 10): number {
  const recent = runs.filter(isProgressionEligible).slice(0, count)
  if (recent.length === 0) return 0
  return Math.round(recent.reduce((sum, run) => sum + run.accuracy, 0) / recent.length)
}

/** Moras met and got wrong at least once — the size of the practice backlog. */
export function weakMoraCount(stats: Map<string, AggregatedMoraStat>): number {
  return [...stats.values()].filter((stat) => stat.misses > 0).length
}

/**
 * Which comparable group a run belongs to.
 *
 * Runs are not interchangeable. The banks differ in difficulty by construction
 * and `drills` deliberately serves the moras you are worst at, so a line drawn
 * from a drills run to a quotes run asserts a comparison that does not exist.
 * Smoothing does not fix this — it reduces noise, it does not make unlike tasks
 * alike. A timed run is a different task again, and two durations are two tasks.
 */
export function cohortOf(run: RunResult): string {
  const mode = runMode(run)
  return mode.kind === 'timed' ? `${run.source}:timed:${mode.durationMs}` : `${run.source}:passage`
}

export type Cohort = { key: string; source: SourceName; label: string; count: number }

const SECONDS = 1000

/** Every cohort present in the history, most-practised first. */
export function runCohorts(runs: RunResult[]): Cohort[] {
  const seen = new Map<string, Cohort>()
  for (const run of runs) {
    const key = cohortOf(run)
    const existing = seen.get(key)
    if (existing !== undefined) {
      existing.count += 1
      continue
    }
    const mode = runMode(run)
    seen.set(key, {
      key,
      source: run.source,
      label:
        mode.kind === 'timed' ? `${run.source} · ${Math.round(mode.durationMs / SECONDS)}s` : `${run.source}`,
      count: 1,
    })
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * The cohort to show by default: the one the most recent run belongs to.
 *
 * Not the largest. Falling back to whichever cohort has the most history would
 * silently answer a question about a kind of practice the typist has stopped
 * doing.
 */
export function defaultCohort(runs: RunResult[]): string | null {
  return runs.length === 0 ? null : cohortOf(runs[0])
}

export type ProgressPoint = {
  wpm: number
  accuracy: number
  /** Five-run rolling medians — the trend, with the raw values kept beside it. */
  wpmMedian: number
  accuracyMedian: number
  date: string
}

const WINDOW = 5

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * One cohort's recent runs, oldest first, with both measures and their trends.
 *
 * Speed and accuracy are returned together but are meant to be drawn as two
 * stacked plots sharing an x-axis, never as one plot with two y-scales: 0–120
 * wpm and 88–100% have no honest common axis, and overlaying them invents a
 * relationship out of where the two scales happen to be pinned.
 */
export function progressPoints(runs: RunResult[], cohort: string, limit = 24): ProgressPoint[] {
  const recent = runs
    .filter((run) => cohortOf(run) === cohort)
    .slice(0, limit)
    .reverse()
  return recent.map((run, index) => {
    const from = Math.max(0, index - (WINDOW - 1))
    const window = recent.slice(from, index + 1)
    return {
      wpm: runWpm(run),
      accuracy: run.accuracy,
      wpmMedian: median(window.map(runWpm)),
      accuracyMedian: median(window.map((r) => r.accuracy)),
      date: run.date,
    }
  })
}

/**
 * The accuracy axis, which cannot start at zero and stay useful.
 *
 * A competent typist lives between 88% and 100%, and on a 0–100 axis that is a
 * flat line saying nothing. The floor is rounded down in fives with headroom
 * below the worst run, and the axis is always drawn with its ticks — a truncated
 * scale is honest when it is labelled and misleading when it is not.
 */
export function accuracyFloor(points: { accuracy: number }[]): number {
  if (points.length === 0) return 90
  const min = Math.min(...points.map((p) => p.accuracy))
  return Math.max(0, Math.min(90, Math.floor((min - 2) / 5) * 5))
}

/**
 * Speed over the last runs, oldest first, for a trend line.
 *
 * Replaces a histogram of five twenty-wpm bins. That could describe a lifetime
 * spread but not a direction: moving from 20 wpm to 40 and moving from 40 back
 * to 20 produced exactly the same picture, and "am I improving" is the question
 * the surface exists to answer.
 *
 * The median is over a five-run window, because a single unlucky run swings a
 * raw line enough to read as a trend that is not there. Gated the same way the
 * histogram was, so a short sprint cannot bend the line it is not comparable to.
 */
export function wpmTrend(
  runs: RunResult[],
  count = 24,
): { wpm: number; accuracy: number; median: number }[] {
  const recent = runs.filter(isProgressionEligible).slice(0, count).reverse()
  return recent.map((run, index) => {
    const from = Math.max(0, index - 4)
    const window = recent.slice(from, index + 1).map(runWpm).sort((a, b) => a - b)
    const mid = Math.floor(window.length / 2)
    return {
      wpm: runWpm(run),
      accuracy: run.accuracy,
      median:
        window.length % 2 === 1 ? window[mid] : Math.round((window[mid - 1] + window[mid]) / 2),
    }
  })
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

export type RunWeakness = {
  kana: string
  /** Misses in the run just finished. */
  missed: number
  attempts: number
  /** Missed in earlier runs too, not only this one. */
  recurring: boolean
}

/**
 * What the run just finished got wrong, for the card the typist actually looks
 * at when they stop.
 *
 * The mastery model is otherwise only visible on the Statistics page, somewhere
 * you have to go looking, so the loop between typing and knowing what to fix was
 * never closed where it mattered. Ordered by *lifetime* weakness rather than by
 * misses in this run, because that is the order drills will pull in — the list
 * predicts what the next run targets rather than merely restating this one.
 *
 * `recurring` separates a mora you keep failing from one you fumbled once.
 * Lifetime totals include the run being reported, so having more misses overall
 * than in this run is exactly what "you have missed this before" means.
 */
export function weakAfterRun(
  run: RunResult,
  lifetime: Map<string, AggregatedMoraStat>,
  limit = 5,
): RunWeakness[] {
  return Object.entries(run.kanaStats ?? {})
    .filter(([, stat]) => stat.misses > 0)
    .map(([kana, stat]) => ({
      kana,
      missed: stat.misses,
      attempts: stat.attempts,
      recurring: (lifetime.get(kana)?.misses ?? stat.misses) > stat.misses,
    }))
    .sort((a, b) => {
      const weakness = (item: RunWeakness) => {
        const stat = lifetime.get(item.kana)
        return stat === undefined ? 0 : smoothedErrorRate(stat)
      }
      return weakness(b) - weakness(a) || b.missed - a.missed || a.kana.localeCompare(b.kana)
    })
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
