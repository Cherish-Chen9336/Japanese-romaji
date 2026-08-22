export type SourceName = 'auto' | 'drills' | 'difficult' | 'quotes' | 'words' | 'library'

export type Unlock = {
  id: string
  label: string
  reached: boolean
}

export type TextItem = {
  kana: string
  romaji: string
}

export type Lesson = TextItem & {
  source: SourceName
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
