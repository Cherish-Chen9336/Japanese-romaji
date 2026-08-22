export type SourceName = 'auto' | 'kana' | 'drills' | 'difficult' | 'quotes' | 'words' | 'library'

/** Which part of the 五十音図 to drill. */
export type KanaGroup = 'all' | 'seion' | 'dakuten' | 'yoon'

export const KANA_GROUPS: readonly KanaGroup[] = ['all', 'seion', 'dakuten', 'yoon']

export function isKanaGroup(value: unknown): value is KanaGroup {
  return KANA_GROUPS.includes(value as KanaGroup)
}

/** A row of the chart, tagged with the group it belongs to. */
export type KanaRow = TextItem & { group: Exclude<KanaGroup, 'all'> }

export type Unlock = {
  id: string
  label: string
  reached: boolean
}

export type TextItem = {
  /** What's shown on screen — orthographic kana. */
  kana: string
  /** Canonical romaji. Must be typeable; see engine/prompt.ts. */
  romaji: string
  /**
   * Phonetic spelling to type, when it differs from `kana`. Needed for the
   * grammatical particles — こんにちは is displayed with は but typed `wa`,
   * and no rule over the kana alone can tell that は from the one in はな.
   */
  reading?: string
}

export type Lesson = {
  kana: string
  romaji: string
  source: SourceName
  /** The items this lesson was built from, kept so it can be recompiled. */
  items: readonly TextItem[]
}

export type RunResult = {
  source: SourceName
  chars: number
  mistakes: number
  accuracy: number
  wpm: number
  rawWpm?: number
  cpm?: number
  rawCpm?: number
  consistency?: number
  elapsedMs: number
  date: string
  keyStats?: Record<string, TimingStat>
  bigramStats?: Record<string, TimingStat>
}

/** Shape that may arrive from localStorage — wpm is optional for legacy records. */
export type StoredRunResult = Omit<RunResult, 'wpm'> & { wpm?: number }

export type Settings = {
  paragraphItems: number
}

/**
 * Which physical keyboard the on-screen keyboard draws. A persisted user
 * setting, so the name and its guard live here in `engine/` rather than beside
 * the keycap data in `ui/` — `io/` needs to validate it on read and is not
 * allowed to import from `ui/`.
 */
export type KeyboardLayoutName = 'mac' | 'windows'

export const KEYBOARD_LAYOUT_NAMES: readonly KeyboardLayoutName[] = ['windows', 'mac']

export function isKeyboardLayoutName(value: unknown): value is KeyboardLayoutName {
  return value === 'mac' || value === 'windows'
}

/**
 * All-time aggregates, maintained incrementally on every completed run —
 * deliberately separate from the (capped, most-recent-N) stored run list so
 * personal bests, milestones, and streaks can't regress once the run log
 * gets truncated. `streakDays` holds distinct calendar day-keys only (one
 * entry per active day, not per run), so it stays compact even over years
 * of daily use.
 */
export type LifetimeStats = {
  bestWpm: number
  totalSessions: number
  totalChars: number
  totalElapsedMs: number
  streakDays: string[]
}

export type TimingStat = {
  attempts: number
  misses: number
  totalMs: number
}

export type AggregatedTimingStat = TimingStat & {
  avgMs: number
  errorRate: number
}
