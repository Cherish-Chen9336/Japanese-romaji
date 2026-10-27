export type SourceName =
  | 'auto'
  | 'kana'
  | 'drills'
  | 'difficult'
  | 'quotes'
  | 'words'
  | 'sentences'
  | 'library'

/**
 * What each source is called on screen.
 *
 * Kept apart from the `SourceName` it keys, because the name is **stored** and
 * the label is only read. `quotes` sits in the source preference and in
 * `RunResult.source` on every run ever recorded, so renaming the value would
 * orphan that history; renaming the label costs nothing.
 *
 * `quotes` reads **proverbs** because that is what the bank holds — fourteen
 * ことわざ, 七転び八起き and 石の上にも三年 among them. Not one of them is a
 * quotation, and not one carries a quotation mark.
 *
 * Every surface that shows a source to a person reads this: the practice
 * picker through `sourceOptions`, the result screen, and the statistics
 * cohorts through `runCohorts`. Each used to spell the source out for itself,
 * which is three places for the same word to drift apart in.
 */
export const SOURCE_LABELS: Record<SourceName, string> = {
  auto: 'auto',
  kana: 'kana',
  drills: 'drills',
  words: 'words',
  difficult: 'difficult',
  quotes: 'proverbs',
  sentences: 'sentences',
  library: 'library',
}

/** Which part of the 五十音図 to drill. */
export type KanaGroup = 'all' | 'seion' | 'dakuten' | 'yoon'

export const KANA_GROUPS: readonly KanaGroup[] = ['all', 'seion', 'dakuten', 'yoon']

export function isKanaGroup(value: unknown): value is KanaGroup {
  return KANA_GROUPS.includes(value as KanaGroup)
}

/** One syllabary. The mastery chart draws one of these at a time. */
export type KanaScript = 'hiragana' | 'katakana'

/**
 * Which syllabary the 五十音 drill deals, which is a **separate axis** from
 * which part of the chart it deals. Crossing them is the point: the voiced
 * katakana rows are their own thing to practise, and folding script into
 * `KanaGroup` would have made that an eight-way list of pairs instead of two
 * short rows of buttons.
 *
 * `both` rather than `all`, because `KanaGroup` already owns `all` and the two
 * sit side by side in the picker — "all · both" reads as two answers to two
 * questions, where "all · all" reads as one question asked twice.
 */
export type KanaScriptChoice = KanaScript | 'both'

export const KANA_SCRIPT_CHOICES: readonly KanaScriptChoice[] = ['hiragana', 'katakana', 'both']

export function isKanaScriptChoice(value: unknown): value is KanaScriptChoice {
  return KANA_SCRIPT_CHOICES.includes(value as KanaScriptChoice)
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

/**
 * A text that can be chosen and practised as itself, start to finish.
 *
 * The opposite of a source: a source is a pool to deal from, this is one thing
 * to type. Its items are in the order they are meant to be typed, and nothing
 * shuffles them — that is the whole difference, and it is why choosing a text
 * does not go through `planRun`.
 *
 * `items` are the authored entries themselves, not copies. A second store of
 * the same Japanese would be a second thing to keep correct.
 */
export type PracticeText = {
  /** Stable across reorderings, so a stored run can still name it. */
  id: string
  /** Shown when there is one. A single sentence is its own label. */
  title?: string
  source: SourceName
  items: readonly TextItem[]
}

export type Lesson = {
  kana: string
  romaji: string
  source: SourceName
  /** The items this lesson was built from, kept so it can be recompiled. */
  items: readonly TextItem[]
}

/**
 * How a run ended: at the end of its passage, or when a clock ran out.
 *
 * A discriminated union rather than a flag, because a timed run's duration is
 * part of what it is — a fifteen-second sprint and a sixty-second run are not
 * the same measurement and must not be pooled into one speed.
 */
export type RunMode = { kind: 'passage' } | { kind: 'timed'; durationMs: number }

/** The standard timed duration. Only this one is progression-eligible. */
export const STANDARD_TIMED_MS = 60_000

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
  /**
   * Absent on every run recorded before time mode, which were all passage runs —
   * so absence reads as `{ kind: 'passage' }` rather than as unknown.
   */
  mode?: RunMode
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
  /**
   * Disable backspace, so every keystroke commits.
   *
   * Off by default. It trains precision over correction, but a beginner who
   * cannot take a key back has no way out of a mora they have half-assembled,
   * and this matcher already refuses wrong keys — the two together would make a
   * fumble unrecoverable rather than merely costly.
   */
  confidenceMode: boolean
  /**
   * Mark the spaces in the romaji line.
   *
   * On by default, because the space is a key you have to press and the kana
   * above it shows no gap: 写真 and 友達 sit side by side with nothing between
   * them, while the romaji demands `shashin tomodachi`. The marker is where that
   * requirement becomes visible.
   */
  whitespaceMarkers: boolean
  /**
   * End the run on a clock instead of at the end of the passage.
   *
   * Off by default: a passage is a complete thing to finish, and a beginner
   * meeting kana for the first time is not helped by a timer. One duration only
   * (`STANDARD_TIMED_MS`), because two durations are two different tests and
   * pooling their speeds would let the shorter one own the record.
   */
  timedMode: boolean
}

/**
 * Which palette the app wears. `system` is the default and not a value of its
 * own — it means "whatever the OS is asking for", resolved at read time, so
 * someone who has never opened settings gets a dark app on a dark desktop.
 *
 * `dark` is black and gold; `book` is warm paper and ink, for reading at a desk
 * rather than in the dark. `system` resolves to light or dark only, because the
 * OS has no way to ask for either of those.
 */
export type ThemeName = 'system' | 'light' | 'dark' | 'book'

export const THEME_NAMES: readonly ThemeName[] = ['system', 'light', 'dark', 'book']

export function isThemeName(value: unknown): value is ThemeName {
  return THEME_NAMES.includes(value as ThemeName)
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
