import { lifetimeStatsFromRuns } from '../engine/stats'
import { isKanaGroup, isKeyboardLayoutName } from '../engine/types'
import type {
  KanaGroup,
  KeyboardLayoutName,
  LifetimeStats,
  RunResult,
  Settings,
  SourceName,
  TextItem,
  TimingStat,
} from '../engine/types'
import { readJson } from './storage'

export const RUNS_KEY = 'japanese-romaji:runs'
export const SETTINGS_KEY = 'japanese-romaji:settings'
export const LIBRARY_KEY = 'japanese-romaji:library'
export const MISSES_KEY = 'japanese-romaji:misses'
export const CONFUSIONS_KEY = 'japanese-romaji:confusions'
export const SHOW_KEYBOARD_KEY = 'japanese-romaji:show-keyboard'
export const LIFETIME_KEY = 'japanese-romaji:lifetime'
export const KEYBOARD_LAYOUT_KEY = 'japanese-romaji:keyboard-layout'
export const KANA_GROUP_KEY = 'japanese-romaji:kana-group'
export const SOURCE_KEY = 'japanese-romaji:source'

// Additive: runs stored before `kana` existed still carry one of the older
// names, so nothing needs migrating.
const VALID_SOURCES = new Set<string>([
  'auto',
  'kana',
  'drills',
  'difficult',
  'quotes',
  'words',
  'library',
])

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
    keyStats: readTimingStats(r.keyStats),
    bigramStats: readTimingStats(r.bigramStats),
  }
}

function isRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Stored timing tables, entry by entry. Checking only that the container is an
 * object let `{ a: null }` through, and the null then threw the first time the
 * stats page tried to add up `stat.attempts` — a corrupt key taking down the
 * whole page rather than being dropped.
 */
function readTimingStats(raw: unknown): Record<string, TimingStat> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, TimingStat> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRecord(value)) continue
    const stat = value as Record<string, unknown>
    if (!isNum(stat.attempts) || !isNum(stat.misses) || !isNum(stat.totalMs)) continue
    if (stat.attempts < 0 || stat.misses < 0 || stat.totalMs < 0) continue
    out[key] = { attempts: stat.attempts, misses: stat.misses, totalMs: stat.totalMs }
  }
  return out
}

/** A day key as `dayKey` writes them. Anything else makes `new Date` throw. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function isDayKey(value: unknown): value is string {
  return isStr(value) && DAY_KEY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
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

/**
 * Longest stored item accepted. Compilation walks one token per character, so an
 * unbounded item is unbounded recursion; this is far longer than any real
 * practice line and short enough to stay on the stack.
 */
const MAX_ITEM_CHARS = 400

/**
 * Rebuilds each stored item field by field rather than passing the object
 * through. Filtering only checked `kana` and `romaji` and returned whatever else
 * was on the object, so a stored `reading: 7` reached `reading.split(' ')` and
 * threw before the first lesson could render.
 */
export function readLibrary(): TextItem[] {
  const raw = readJson<unknown>(LIBRARY_KEY, [])
  if (!Array.isArray(raw)) return []

  const items: TextItem[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const r = entry as Record<string, unknown>
    if (!isStr(r.kana) || !isStr(r.romaji)) continue
    if (r.kana.length === 0 || r.romaji.length === 0) continue
    if (r.kana.length > MAX_ITEM_CHARS || r.romaji.length > MAX_ITEM_CHARS) continue
    // Same rules the upload parser applies, since stored data can predate them
    // or be hand-edited: word breaks must agree, and every romaji character must
    // be reachable by one keypress (an astral character compiles to a token
    // `applyTypeChar` can never accept, stranding the lesson).
    if (r.kana.split(' ').length !== r.romaji.split(' ').length) continue
    if (r.romaji.length !== [...r.romaji].length) continue
    if (isStr(r.reading) && r.reading.split(' ').length !== r.kana.split(' ').length) continue
    items.push({
      kana: r.kana,
      romaji: r.romaji,
      ...(isStr(r.reading) && r.reading.length <= MAX_ITEM_CHARS ? { reading: r.reading } : {}),
    })
  }
  return items
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
    Array.isArray(r.streakDays)
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
      // Filtered rather than trusted: a stray string here reached `new Date`
      // and threw `RangeError: Invalid time value` before the app could render.
      streakDays: (r.streakDays as unknown[]).filter(isDayKey),
    }
  }
  return lifetimeStatsFromRuns(readRuns())
}

/**
 * Which on-screen keyboard to draw. Defaults to `windows` — the ANSI bottom row
 * (ctrl / super / alt / space) matches Linux and Windows machines, which is what
 * most visitors are on; mac users can switch in settings.
 */
export function readKeyboardLayout(): KeyboardLayoutName {
  const raw = readJson<unknown>(KEYBOARD_LAYOUT_KEY, null)
  return isKeyboardLayoutName(raw) ? raw : 'windows'
}

/**
 * The last-picked source. Persisted so someone working through the syllabary
 * comes back to it, rather than being dropped on `auto` every reload — which
 * also hid the chart-group row that only shows while `kana` is selected.
 */
export function readSource(): SourceName {
  const raw = readJson<unknown>(SOURCE_KEY, null)
  return typeof raw === 'string' && VALID_SOURCES.has(raw) ? (raw as SourceName) : 'auto'
}

/** Which part of the 五十音図 the kana source drills. Defaults to the whole chart. */
export function readKanaGroup(): KanaGroup {
  const raw = readJson<unknown>(KANA_GROUP_KEY, null)
  return isKanaGroup(raw) ? raw : 'all'
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
