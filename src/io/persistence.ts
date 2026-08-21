import { lifetimeStatsFromRuns } from '../engine/stats'
import type { LifetimeStats, RunResult, Settings, SourceName, TextItem } from '../engine/types'
import { readJson } from './storage'

export const RUNS_KEY = 'japanese-romaji:runs'
export const SETTINGS_KEY = 'japanese-romaji:settings'
export const LIBRARY_KEY = 'japanese-romaji:library'
export const MISSES_KEY = 'japanese-romaji:misses'
export const CONFUSIONS_KEY = 'japanese-romaji:confusions'
export const SHOW_KEYBOARD_KEY = 'japanese-romaji:show-keyboard'
export const LIFETIME_KEY = 'japanese-romaji:lifetime'

const VALID_SOURCES = new Set<string>(['auto', 'drills', 'difficult', 'quotes', 'words', 'library'])

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v)
}

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

function isValidRun(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const r = item as Record<string, unknown>
  return (
    isStr(r.source) &&
    VALID_SOURCES.has(r.source) &&
    isNum(r.chars) &&
    r.chars > 0 &&
    isNum(r.mistakes) &&
    r.mistakes >= 0 &&
    isNum(r.accuracy) &&
    r.accuracy >= 0 &&
    r.accuracy <= 100 &&
    isNum(r.elapsedMs) &&
    r.elapsedMs > 0 &&
    isStr(r.date) &&
    !isNaN(Date.parse(r.date)) &&
    (isNum(r.wpm) || isNum(r.cpm))
  )
}

function normalizeRun(item: unknown): RunResult {
  const r = item as Record<string, unknown>
  const wpm = isNum(r.wpm) ? r.wpm : Math.round(((r.cpm as number) ?? 0) / 5)
  return {
    source: r.source as SourceName,
    chars: r.chars as number,
    mistakes: r.mistakes as number,
    accuracy: r.accuracy as number,
    wpm,
    rawWpm: isNum(r.rawWpm) ? r.rawWpm : undefined,
    cpm: isNum(r.cpm) ? r.cpm : undefined,
    rawCpm: isNum(r.rawCpm) ? r.rawCpm : undefined,
    consistency: isNum(r.consistency) ? r.consistency : undefined,
    elapsedMs: r.elapsedMs as number,
    date: r.date as string,
    keyStats: isRecord(r.keyStats) ? (r.keyStats as RunResult['keyStats']) : undefined,
    bigramStats: isRecord(r.bigramStats) ? (r.bigramStats as RunResult['bigramStats']) : undefined,
  }
}

function isRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function readRuns(): RunResult[] {
  const raw = readJson<unknown>(RUNS_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.filter(isValidRun).map(normalizeRun)
}

export function readSettings(): Settings {
  const DEFAULT: Settings = { paragraphItems: 8 }
  const raw = readJson<unknown>(SETTINGS_KEY, null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT
  const r = raw as Record<string, unknown>
  const items = isNum(r.paragraphItems)
    ? Math.max(3, Math.min(30, Math.round(r.paragraphItems)))
    : DEFAULT.paragraphItems
  return { paragraphItems: items }
}

export function readLibrary(): TextItem[] {
  const raw = readJson<unknown>(LIBRARY_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is TextItem =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      isStr((item as Record<string, unknown>).kana) &&
      isStr((item as Record<string, unknown>).romaji),
  )
}

export function readMissMap(): Record<string, number> {
  const raw = readJson<unknown>(MISSES_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isNum(value)) result[key] = value
  }
  return result
}

export function readConfusionMap(): Record<string, number> {
  const raw = readJson<unknown>(CONFUSIONS_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isNum(value)) result[key] = value
  }
  return result
}

function isValidLifetimeStats(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const r = item as Record<string, unknown>
  return (
    isNum(r.bestWpm) &&
    r.bestWpm >= 0 &&
    isNum(r.totalSessions) &&
    r.totalSessions >= 0 &&
    isNum(r.totalChars) &&
    r.totalChars >= 0 &&
    isNum(r.totalElapsedMs) &&
    r.totalElapsedMs >= 0 &&
    Array.isArray(r.streakDays) &&
    r.streakDays.every(isStr)
  )
}

/**
 * Reads persisted lifetime stats, bootstrapping them from stored run
 * history on first read for existing users who don't have this key yet —
 * a one-time migration, not a live recomputation (see
 * lifetimeStatsFromRuns's doc comment on why it can't recover history the
 * old run-list cap already dropped).
 */
export function readLifetimeStats(): LifetimeStats {
  const raw = readJson<unknown>(LIFETIME_KEY, null)
  if (isValidLifetimeStats(raw)) {
    const r = raw as Record<string, unknown>
    return {
      bestWpm: r.bestWpm as number,
      totalSessions: r.totalSessions as number,
      totalChars: r.totalChars as number,
      totalElapsedMs: r.totalElapsedMs as number,
      streakDays: [...(r.streakDays as string[])],
    }
  }
  return lifetimeStatsFromRuns(readRuns())
}

export function readShowKeyboard(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_KEYBOARD_KEY)
    if (raw === null) return true
    // Legacy format: '0' = hide, anything else = show
    if (raw === '0' || raw === 'false') return false
    if (raw === '1' || raw === 'true') return true
    // JSON boolean fallback
    const parsed = JSON.parse(raw)
    return parsed !== false && parsed !== 0
  } catch {
    return true
  }
}
