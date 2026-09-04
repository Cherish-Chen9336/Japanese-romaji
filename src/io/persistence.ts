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
  MoraTimingStat,
  RunMode,
} from '../engine/types'
import type { RecordName, RecordStore } from './records'
import { readJson, writeJson } from './storage'

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

/**
 * A run's mode as stored. Absence means passage: every run recorded before time
 * mode existed was one, so the missing field has a known meaning rather than an
 * unknown one. Anything unrecognised also reads as passage rather than being
 * rejected — a mode we cannot interpret should not cost the typist the run.
 */
function readRunMode(raw: unknown): RunMode {
  if (!isRecord(raw)) return { kind: 'passage' }
  const r = raw as Record<string, unknown>
  if (r.kind === 'timed' && isNum(r.durationMs) && r.durationMs > 0) {
    return { kind: 'timed', durationMs: r.durationMs }
  }
  return { kind: 'passage' }
}

function isValidRun(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const r = item as Record<string, unknown>
  return (
    isStr(r.source) &&
    VALID_SOURCES.has(r.source) &&
    isNum(r.chars) &&
    // A timed run can legitimately have typed nothing: the clock runs out while
    // the typist idles, or every key they pressed was refused and so never
    // entered the line. A passage run cannot — reaching the end of a passage
    // means characters were typed — so zero there is still corruption.
    (r.chars > 0 || readRunMode(r.mode).kind === 'timed') &&
    r.chars >= 0 &&
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
    mode: readRunMode(r.mode),
    elapsedMs: r.elapsedMs as number,
    date: r.date as string,
    keyStats: readTimingStats(r.keyStats),
    bigramStats: readTimingStats(r.bigramStats),
    kanaStats: readTimingStats(r.kanaStats),
    ...(isNum(r.baselineMs) && r.baselineMs > 0 ? { baselineMs: r.baselineMs } : {}),
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
function readTimingStats(raw: unknown): Record<string, MoraTimingStat> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, MoraTimingStat> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRecord(value)) continue
    const stat = value as Record<string, unknown>
    if (!isNum(stat.attempts) || !isNum(stat.misses) || !isNum(stat.totalMs)) continue
    if (stat.attempts < 0 || stat.misses < 0 || stat.totalMs < 0) continue
    // Both optional, and both are dropped rather than defaulted when missing or
    // invalid. Absent, the reader falls back to `attempts` as the denominator,
    // which is what a run written before these existed already reported;
    // defaulting them to zero here would instead erase that run's timings.
    const timingSamples = isNum(stat.timingSamples) && stat.timingSamples >= 0 ? stat.timingSamples : undefined
    const keystrokes = isNum(stat.keystrokes) && stat.keystrokes >= 0 ? stat.keystrokes : undefined
    out[key] = {
      attempts: stat.attempts,
      misses: stat.misses,
      totalMs: stat.totalMs,
      ...(timingSamples === undefined ? {} : { timingSamples }),
      ...(keystrokes === undefined ? {} : { keystrokes }),
    }
  }
  return out
}

/** A day key as `dayKey` writes them. Anything else makes `new Date` throw. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function isDayKey(value: unknown): value is string {
  return isStr(value) && DAY_KEY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function parseRuns(raw: unknown): RunResult[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isValidRun).map(normalizeRun)
}

export function readRuns(): RunResult[] {
  return parseRuns(readJson<unknown>(RUNS_KEY, []))
}

const DEFAULT_PARAGRAPH_ITEMS = 8

/* Defaults in one place, so `readSettings` and `parsePreferences` cannot drift
   into disagreeing about what a missing field means. */
const DEFAULT_SETTINGS: Settings = {
  paragraphItems: DEFAULT_PARAGRAPH_ITEMS,
  stopOnError: true,
  confidenceMode: false,
  whitespaceMarkers: true,
  timedMode: false,
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampParagraphItems(value: unknown): number {
  return isNum(value)
    ? Math.max(3, Math.min(30, Math.round(value)))
    : DEFAULT_PARAGRAPH_ITEMS
}

export function readSettings(): Settings {
  const raw = readJson<unknown>(SETTINGS_KEY, null)
  if (!isRecord(raw)) return DEFAULT_SETTINGS
  const r = raw as Record<string, unknown>
  return {
    paragraphItems: clampParagraphItems(r.paragraphItems),
    stopOnError: bool(r.stopOnError, true),
    confidenceMode: bool(r.confidenceMode, false),
    whitespaceMarkers: bool(r.whitespaceMarkers, true),
    timedMode: bool(r.timedMode, false),
  }
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
export function parseLibrary(raw: unknown): TextItem[] {
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

export function readLibrary(): TextItem[] {
  return parseLibrary(readJson<unknown>(LIBRARY_KEY, []))
}

/** A `key -> count` table, dropping anything that isn't a finite number. */
export function parseCountMap(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isNum(value)) result[key] = value
  }
  return result
}

export function readMissMap(): Record<string, number> {
  return parseCountMap(readJson<unknown>(MISSES_KEY, {}))
}

export function readConfusionMap(): Record<string, number> {
  return parseCountMap(readJson<unknown>(CONFUSIONS_KEY, {}))
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
export function parseLifetimeStats(raw: unknown, runs: RunResult[]): LifetimeStats {
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
  return lifetimeStatsFromRuns(runs)
}

export function readLifetimeStats(): LifetimeStats {
  return parseLifetimeStats(readJson<unknown>(LIFETIME_KEY, null), readRuns())
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

/* ---- the durable records --------------------------------------------------
 *
 * Run history, the library and the derived counters live in IndexedDB; the UI
 * preferences above stay in localStorage. The split is about the first paint:
 * preferences are read synchronously so the page can draw, and the records are
 * awaited because they can grow past what localStorage will hold. That growth
 * is the point — run history used to be capped at 100 to fit.
 */

export type StoredProfile = {
  runs: RunResult[]
  library: TextItem[]
  lifetime: LifetimeStats
  misses: Record<string, number>
  confusions: Record<string, number>
}

export function emptyProfile(): StoredProfile {
  return {
    runs: [],
    library: [],
    lifetime: lifetimeStatsFromRuns([]),
    misses: {},
    confusions: {},
  }
}

/**
 * Copies an existing localStorage profile into the store, once.
 *
 * Only runs when the store holds nothing at all — otherwise a user who cleared
 * their history would have it resurrected from the stale localStorage copy on
 * the next load. The localStorage keys are deliberately left in place: they cost
 * nothing, and they are the only copy of the data until the first write lands.
 *
 * Returns whether anything was carried over.
 */
export async function migrateLocalStorage(store: RecordStore): Promise<boolean> {
  const existing = await store.readAll()
  if (Object.keys(existing).length > 0) return false
  // Run history lives in its own store now, so an empty `records` no longer
  // means an empty profile — check both before deciding this is a fresh install.
  if ((await store.readRuns()).length > 0) return false

  const runs = readJson<unknown>(RUNS_KEY, null)
  const library = readJson<unknown>(LIBRARY_KEY, null)
  const lifetime = readJson<unknown>(LIFETIME_KEY, null)
  const misses = readJson<unknown>(MISSES_KEY, null)
  const confusions = readJson<unknown>(CONFUSIONS_KEY, null)
  if (runs === null && library === null && lifetime === null) return false

  if (Array.isArray(runs)) await store.replaceRuns(runs)

  const carry: [RecordName, unknown][] = [
    ['library', library],
    ['lifetime', lifetime],
    ['misses', misses],
    ['confusions', confusions],
  ]
  for (const [name, value] of carry) {
    if (value !== null) await store.write(name, value)
  }
  return true
}

/**
 * Reads and validates the whole profile. Every value goes through the same
 * parsers the localStorage path used, so a record corrupted in the database is
 * dropped exactly as one corrupted in localStorage was.
 */
export async function loadProfile(store: RecordStore): Promise<StoredProfile> {
  const [raw, storedRuns] = await Promise.all([store.readAll(), store.readRuns()])
  const runs = parseRuns(storedRuns)
  return {
    runs,
    library: parseLibrary(raw.library),
    lifetime: parseLifetimeStats(raw.lifetime, runs),
    misses: parseCountMap(raw.misses),
    confusions: parseCountMap(raw.confusions),
  }
}

/* ---- preferences as a group ------------------------------------------------
 *
 * Individually these are read at startup; as a set they are what a backup has
 * to carry, so that restoring on a new machine brings the keyboard layout and
 * the chosen source across too, not just the history.
 */

export type Preferences = {
  settings: Settings
  showKeyboard: boolean
  keyboardLayout: KeyboardLayoutName
  kanaGroup: KanaGroup
  source: SourceName
}

export function readPreferences(): Preferences {
  return {
    settings: readSettings(),
    showKeyboard: readShowKeyboard(),
    keyboardLayout: readKeyboardLayout(),
    kanaGroup: readKanaGroup(),
    source: readSource(),
  }
}

/** Returns false if any write was refused, so the caller can say so. */
export function writePreferences(preferences: Preferences): boolean {
  const writes = [
    writeJson(SETTINGS_KEY, preferences.settings),
    writeJson(SHOW_KEYBOARD_KEY, preferences.showKeyboard),
    writeJson(KEYBOARD_LAYOUT_KEY, preferences.keyboardLayout),
    writeJson(KANA_GROUP_KEY, preferences.kanaGroup),
    writeJson(SOURCE_KEY, preferences.source),
  ]
  return writes.every(Boolean)
}

/**
 * Validates preferences arriving from a file. Each field falls back to its own
 * default rather than rejecting the whole set — a backup with one unrecognised
 * value should still restore the other four.
 */
export function parsePreferences(raw: unknown): Preferences {
  const r = isRecord(raw) ? (raw as Record<string, unknown>) : {}
  const stored = isRecord(r.settings) ? (r.settings as Record<string, unknown>) : {}
  const settings: Settings = {
    paragraphItems: clampParagraphItems(stored.paragraphItems),
    stopOnError: bool(stored.stopOnError, DEFAULT_SETTINGS.stopOnError),
    confidenceMode: bool(stored.confidenceMode, DEFAULT_SETTINGS.confidenceMode),
    whitespaceMarkers: bool(stored.whitespaceMarkers, DEFAULT_SETTINGS.whitespaceMarkers),
    timedMode: bool(stored.timedMode, DEFAULT_SETTINGS.timedMode),
  }
  return {
    settings,
    showKeyboard: typeof r.showKeyboard === 'boolean' ? r.showKeyboard : true,
    keyboardLayout: isKeyboardLayoutName(r.keyboardLayout) ? r.keyboardLayout : 'windows',
    kanaGroup: isKanaGroup(r.kanaGroup) ? r.kanaGroup : 'all',
    source: isStr(r.source) && VALID_SOURCES.has(r.source) ? (r.source as SourceName) : 'auto',
  }
}

/** Every localStorage key this app owns. Reset removes exactly these. */
export const ALL_PREFERENCE_KEYS: readonly string[] = [
  SETTINGS_KEY,
  SHOW_KEYBOARD_KEY,
  KEYBOARD_LAYOUT_KEY,
  KANA_GROUP_KEY,
  SOURCE_KEY,
  // The pre-IndexedDB record keys. Still present after migration, since they
  // were the only copy until the first write landed — a reset has to take them
  // too, or the next load migrates the old profile straight back in.
  RUNS_KEY,
  LIBRARY_KEY,
  LIFETIME_KEY,
  MISSES_KEY,
  CONFUSIONS_KEY,
]

export function clearPreferences(): void {
  for (const key of ALL_PREFERENCE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // A storage that refuses removal is one we never wrote to either.
    }
  }
}
