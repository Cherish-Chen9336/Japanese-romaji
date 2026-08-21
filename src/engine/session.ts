import type { Lesson, RunResult, TimingStat } from './types'

export type CharStatus = 'pending' | 'correct' | 'incorrect'

export type SessionState = {
  pos: number
  statuses: CharStatus[]
  mistakes: number
  startedAt: number | null
  finishedAt: number | null
  keyStats: Record<string, TimingStat>
  bigramStats: Record<string, TimingStat>
  intervals: number[]
  lastCorrectAt: number | null
}

export type TypeResult = {
  session: SessionState
  completed: boolean
  missed?: { target: string; typed: string }
}

export type SessionMetrics = {
  wpm: number
  rawWpm: number
  accuracy: number
  consistency: number
  elapsedMs: number
}

export function emptySession(): SessionState {
  return {
    pos: 0,
    statuses: [],
    mistakes: 0,
    startedAt: null,
    finishedAt: null,
    keyStats: {},
    bigramStats: {},
    intervals: [],
    lastCorrectAt: null,
  }
}

function updateStat(
  stats: Record<string, TimingStat>,
  key: string,
  ms: number,
  miss: boolean,
): Record<string, TimingStat> {
  const stat = stats[key] ?? { attempts: 0, misses: 0, totalMs: 0 }
  return {
    ...stats,
    [key]: { attempts: stat.attempts + 1, misses: stat.misses + (miss ? 1 : 0), totalMs: stat.totalMs + ms },
  }
}

export function applyTypeChar(
  state: SessionState,
  rawChar: string,
  expected: string,
  now: number,
): TypeResult {
  if (state.finishedAt !== null) return { session: state, completed: false }

  const char = rawChar.toLowerCase()
  const { pos } = state
  const target = expected[pos]
  if (target === undefined) return { session: state, completed: false }

  const startedAt = state.startedAt ?? now

  if (char === target) {
    const interval = state.lastCorrectAt === null ? 0 : Math.min(3000, now - state.lastCorrectAt)
    const intervals = interval > 0 ? [...state.intervals, interval] : state.intervals
    const keyStats = updateStat(state.keyStats, target, interval, false)
    const bigramStats =
      pos > 0
        ? updateStat(state.bigramStats, expected.slice(pos - 1, pos + 1), interval, false)
        : state.bigramStats
    const statuses = [...state.statuses]
    statuses[pos] = 'correct'
    const nextPos = pos + 1
    const completed = nextPos === expected.length
    return {
      session: {
        ...state,
        pos: nextPos,
        statuses,
        startedAt,
        finishedAt: completed ? now : null,
        keyStats,
        bigramStats,
        intervals,
        lastCorrectAt: now,
      },
      completed,
    }
  }

  const keyStats = updateStat(state.keyStats, target, 0, true)
  const bigramStats =
    pos > 0
      ? updateStat(state.bigramStats, expected.slice(pos - 1, pos + 1), 0, true)
      : state.bigramStats
  const statuses = [...state.statuses]
  statuses[pos] = 'incorrect'
  return {
    session: { ...state, startedAt, statuses, mistakes: state.mistakes + 1, keyStats, bigramStats },
    missed: { target, typed: char },
    completed: false,
  }
}

export function applyBackspace(state: SessionState): SessionState {
  if (state.pos === 0 || state.finishedAt !== null) return state
  const nextPos = state.pos - 1
  const statuses = [...state.statuses]
  statuses[nextPos] = 'pending'
  return { ...state, pos: nextPos, statuses }
}

export function computeMetrics(state: SessionState, now: number): SessionMetrics {
  const elapsedMs = state.startedAt ? (state.finishedAt ?? now) - state.startedAt : 0
  const elapsedSec = elapsedMs / 1000

  const hits = state.statuses.filter((s) => s === 'correct').length
  const attempts = hits + state.mistakes
  const accuracy = attempts === 0 ? 100 : Math.max(0, Math.round((hits / attempts) * 100))

  const wpm = elapsedSec > 0 ? Math.round(((state.pos / 5) / elapsedSec) * 60) : 0
  const rawWpm = elapsedSec > 0 ? Math.round((((state.pos + state.mistakes) / 5) / elapsedSec) * 60) : 0

  const samples = state.intervals.filter((i) => i > 0)
  let consistency = 100
  if (samples.length >= 3) {
    const avg = samples.reduce((sum, i) => sum + i, 0) / samples.length
    const variance = samples.reduce((sum, i) => sum + (i - avg) ** 2, 0) / samples.length
    const deviation = Math.sqrt(variance)
    consistency = Math.max(0, Math.min(100, Math.round(100 - (deviation / avg) * 100)))
  }

  return { wpm, rawWpm, accuracy, consistency, elapsedMs }
}

export function buildRunResult(
  state: SessionState,
  lesson: Lesson,
  metrics: SessionMetrics,
  isoNow: () => string = () => new Date().toISOString(),
): RunResult {
  return {
    source: lesson.source,
    chars: lesson.romaji.length,
    mistakes: state.mistakes,
    accuracy: metrics.accuracy,
    wpm: metrics.wpm,
    rawWpm: metrics.rawWpm,
    consistency: metrics.consistency,
    elapsedMs: metrics.elapsedMs,
    date: isoNow(),
    keyStats: state.keyStats,
    bigramStats: state.bigramStats,
  }
}
