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
  /** Per-mora timing. Absent on runs recorded before kana were tracked. */
  kanaStats?: Record<string, MoraTimingStat>
  /**
   * This run's median clean inter-keystroke interval — the typist's own cadence
   * on the day, and the unit `kanaStats` excess is measured against.
   *
   * Stored per run rather than computed across all of them because it is a
   * property of the sitting: tired and quick are different baselines, and
   * subtracting one run's cadence from another's timings would report the
   * difference between the two days as difficulty with a kana.
   *
   * Absent when the run was too short to establish one, and on every run
   * recorded before this existed. Those runs contribute attempts and misses but
   * no excess, which is the honest reading — the number cannot be reconstructed.
   */
  baselineMs?: number
}

/** Shape that may arrive from localStorage — wpm is optional for legacy records. */
export type StoredRunResult = Omit<RunResult, 'wpm'> & { wpm?: number }

export type Settings = {
  paragraphItems: number
  /**
   * Refuse a wrong keystroke rather than letting it stand in for the right one.
   * On by default: it is what every Japanese typing site does, because romaji
   * input assembles a kana rather than filling a slot.
   */
  stopOnError: boolean
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
  /**
   * Encounters actually behind `totalMs`, which is not every attempt.
   *
   * The first keystroke of a run has no preceding key to measure against, and
   * `applyBackspace` clears `lastKeyAt` on purpose, so the key after an edit has
   * none either. Those are unobserved, not zero-millisecond observations, and
   * dividing `totalMs` by every attempt counted them as instant.
   *
   * Optional because runs recorded before this existed have none. Absent, the
   * denominator falls back to `attempts`, which reproduces exactly what those
   * runs already displayed rather than restating their history.
   */
  timingSamples?: number
}

/**
 * Per-mora timing, which needs one field a key does not.
 *
 * `totalMs` for a mora is the time to type its whole spelling, so it scales with
 * how many letters that spelling takes: a flawless typist at a constant 100 ms
 * records あ at 100 and しゃ at 300 without once hesitating. `keystrokes` is what
 * makes the two comparable — the expected cost of the spelling can be subtracted
 * from the observed cost, leaving only the part the typist actually owns.
 */
export type MoraTimingStat = TimingStat & {
  /** Timed keystrokes behind `totalMs`, the width to charge the baseline over. */
  keystrokes?: number
}

export type AggregatedTimingStat = TimingStat & {
  avgMs: number
  errorRate: number
}

/**
 * A mora's timing after the spelling's own cost has been taken out.
 *
 * `avgExcessMs` is the hesitation this mora costs beyond what its length
 * explains, in milliseconds, and it is comparable across moras of any spelling
 * length. Zero means "typed at your own ordinary cadence"; negative means faster
 * than that, which is a real thing a well-known mora does.
 */
export type AggregatedMoraStat = AggregatedTimingStat & {
  /* Required here, unlike on a key: `mergeMoraStats` always counts it, so a
     mora stat never falls back to `attempts` as its denominator. */
  timingSamples: number
  excessMs: number
  avgExcessMs: number
}
