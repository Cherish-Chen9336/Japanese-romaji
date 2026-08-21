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

export type TimingStat = {
  attempts: number
  misses: number
  totalMs: number
}

export type AggregatedTimingStat = TimingStat & {
  avgMs: number
  errorRate: number
}
