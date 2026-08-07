import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import './App.css'

type SourceName = 'auto' | 'drills' | 'difficult' | 'quotes' | 'words' | 'library'
type RouteName = 'practice' | 'result' | 'stats' | 'library' | 'settings'
type CharStatus = 'pending' | 'correct' | 'incorrect'
type Unlock = {
  id: string
  label: string
  reached: boolean
}

type TextItem = {
  kana: string
  romaji: string
}

type Lesson = TextItem & {
  source: SourceName
}

type RunResult = {
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

type Settings = {
  paragraphItems: number
}

type TimingStat = {
  attempts: number
  misses: number
  totalMs: number
}

type AggregatedTimingStat = TimingStat & {
  avgMs: number
  errorRate: number
}

type KeyDef = {
  code: string
  label: string
  width?: number
  variant?: 'mod' | 'space'
}

const SHOW_KEYBOARD_KEY = 'japanese-romaji:show-keyboard'
const SETTINGS_KEY = 'japanese-romaji:settings'
const RUNS_KEY = 'japanese-romaji:runs'
const MISSES_KEY = 'japanese-romaji:misses'
const CONFUSIONS_KEY = 'japanese-romaji:confusions'
const LIBRARY_KEY = 'japanese-romaji:library'

const sourceOptions: { value: SourceName; label: string; unlockAt: number }[] = [
  { value: 'auto', label: 'auto', unlockAt: 0 },
  { value: 'drills', label: 'drills', unlockAt: 0 },
  { value: 'words', label: 'words', unlockAt: 0 },
  { value: 'difficult', label: 'difficult', unlockAt: 30 },
  { value: 'quotes', label: 'quotes', unlockAt: 50 },
  { value: 'library', label: 'library', unlockAt: 70 },
]

const wordBank: TextItem[] = [
  { kana: 'おはよう', romaji: 'ohayou' },
  { kana: 'こんにちは', romaji: 'konnichiwa' },
  { kana: 'ありがとう', romaji: 'arigatou' },
  { kana: 'すみません', romaji: 'sumimasen' },
  { kana: 'ともだち', romaji: 'tomodachi' },
  { kana: 'せんせい', romaji: 'sensei' },
  { kana: 'がくせい', romaji: 'gakusei' },
  { kana: 'でんしゃ', romaji: 'densha' },
  { kana: 'じかん', romaji: 'jikan' },
  { kana: 'にほんご', romaji: 'nihongo' },
  { kana: 'たべもの', romaji: 'tabemono' },
  { kana: 'のみもの', romaji: 'nomimono' },
  { kana: 'あした', romaji: 'ashita' },
  { kana: 'きょう', romaji: 'kyou' },
  { kana: 'きのう', romaji: 'kinou' },
  { kana: 'えき', romaji: 'eki' },
  { kana: 'まち', romaji: 'machi' },
  { kana: 'ほん', romaji: 'hon' },
  { kana: 'ひこうき', romaji: 'hikouki' },
  { kana: 'かいしゃ', romaji: 'kaisha' },
  { kana: 'しゃしん', romaji: 'shashin' },
  { kana: 'りょうり', romaji: 'ryouri' },
  { kana: 'えいが', romaji: 'eiga' },
  { kana: 'てがみ', romaji: 'tegami' },
]

const difficultBank: TextItem[] = [
  { kana: 'がっこう', romaji: 'gakkou' },
  { kana: 'きって', romaji: 'kitte' },
  { kana: 'ざっし', romaji: 'zasshi' },
  { kana: 'しゅくだい', romaji: 'shukudai' },
  { kana: 'じゅぎょう', romaji: 'jugyou' },
  { kana: 'びょういん', romaji: 'byouin' },
  { kana: 'りょこう', romaji: 'ryokou' },
  { kana: 'きゃく', romaji: 'kyaku' },
  { kana: 'ちょっと', romaji: 'chotto' },
  { kana: 'しんぶん', romaji: 'shinbun' },
  { kana: 'ほんや', romaji: 'honya' },
  { kana: 'こんや', romaji: 'konya' },
  { kana: 'ちゃわん', romaji: 'chawan' },
  { kana: 'ちゅうしゃ', romaji: 'chuusha' },
  { kana: 'ちょきん', romaji: 'chokin' },
]

const drillFallbackBank: TextItem[] = [
  { kana: 'かきくけこ', romaji: 'kakikukeko' },
  { kana: 'さしすせそ', romaji: 'sashisuseso' },
  { kana: 'たちつてと', romaji: 'tachitsuteto' },
  { kana: 'なにぬねの', romaji: 'naninuneno' },
  { kana: 'はひふへほ', romaji: 'hahifuheho' },
  { kana: 'まみむめも', romaji: 'mamimumemo' },
  { kana: 'やゆよ', romaji: 'yayuyo' },
  { kana: 'らりるれろ', romaji: 'rarirurero' },
  { kana: 'わをん', romaji: 'wawon' },
  { kana: 'がぎぐげご', romaji: 'gagigugego' },
  { kana: 'ざじずぜぞ', romaji: 'zajizuzezo' },
]

const quoteBank: TextItem[] = [
  { kana: 'ななころび やおき', romaji: 'nanakorobi yaoki' },
  { kana: 'いそがば まわれ', romaji: 'isogaba maware' },
  { kana: 'ちりもつもれば やまとなる', romaji: 'chirimotsumoreba yamatonaru' },
  { kana: 'すきこそ もののじょうずなれ', romaji: 'sukikoso mononojouzunare' },
  { kana: 'あめふって じかたまる', romaji: 'amefutte jikatamaru' },
  { kana: 'いしのうえにも さんねん', romaji: 'ishinouenimo sannen' },
]

const sourceBanks: Record<Exclude<SourceName, 'auto' | 'drills' | 'library'>, TextItem[]> = {
  difficult: difficultBank,
  quotes: quoteBank,
  words: wordBank,
}

const keyboardRows: KeyDef[][] = [
  [
    { code: 'Backquote', label: '`' },
    { code: 'Digit1', label: '1' },
    { code: 'Digit2', label: '2' },
    { code: 'Digit3', label: '3' },
    { code: 'Digit4', label: '4' },
    { code: 'Digit5', label: '5' },
    { code: 'Digit6', label: '6' },
    { code: 'Digit7', label: '7' },
    { code: 'Digit8', label: '8' },
    { code: 'Digit9', label: '9' },
    { code: 'Digit0', label: '0' },
    { code: 'Minus', label: '-' },
    { code: 'Equal', label: '=' },
    { code: 'Backspace', label: '⌫', width: 2, variant: 'mod' },
  ],
  [
    { code: 'Tab', label: 'tab', width: 1.5, variant: 'mod' },
    { code: 'KeyQ', label: 'q' },
    { code: 'KeyW', label: 'w' },
    { code: 'KeyE', label: 'e' },
    { code: 'KeyR', label: 'r' },
    { code: 'KeyT', label: 't' },
    { code: 'KeyY', label: 'y' },
    { code: 'KeyU', label: 'u' },
    { code: 'KeyI', label: 'i' },
    { code: 'KeyO', label: 'o' },
    { code: 'KeyP', label: 'p' },
    { code: 'BracketLeft', label: '[' },
    { code: 'BracketRight', label: ']' },
    { code: 'Backslash', label: '\\', width: 1.5 },
  ],
  [
    { code: 'CapsLock', label: 'caps', width: 1.75, variant: 'mod' },
    { code: 'KeyA', label: 'a' },
    { code: 'KeyS', label: 's' },
    { code: 'KeyD', label: 'd' },
    { code: 'KeyF', label: 'f' },
    { code: 'KeyG', label: 'g' },
    { code: 'KeyH', label: 'h' },
    { code: 'KeyJ', label: 'j' },
    { code: 'KeyK', label: 'k' },
    { code: 'KeyL', label: 'l' },
    { code: 'Semicolon', label: ';' },
    { code: 'Quote', label: "'" },
    { code: 'Enter', label: 'enter', width: 2.25, variant: 'mod' },
  ],
  [
    { code: 'ShiftLeft', label: 'shift', width: 2.25, variant: 'mod' },
    { code: 'KeyZ', label: 'z' },
    { code: 'KeyX', label: 'x' },
    { code: 'KeyC', label: 'c' },
    { code: 'KeyV', label: 'v' },
    { code: 'KeyB', label: 'b' },
    { code: 'KeyN', label: 'n' },
    { code: 'KeyM', label: 'm' },
    { code: 'Comma', label: ',' },
    { code: 'Period', label: '.' },
    { code: 'Slash', label: '/' },
    { code: 'ShiftRight', label: 'shift', width: 2.75, variant: 'mod' },
  ],
  [
    { code: 'ControlLeft', label: 'ctrl', width: 1.25, variant: 'mod' },
    { code: 'MetaLeft', label: 'cmd', width: 1.25, variant: 'mod' },
    { code: 'AltLeft', label: 'alt', width: 1.25, variant: 'mod' },
    { code: 'Space', label: '', width: 6.25, variant: 'space' },
    { code: 'AltRight', label: 'alt', width: 1.25, variant: 'mod' },
    { code: 'MetaRight', label: 'cmd', width: 1.25, variant: 'mod' },
    { code: 'ControlRight', label: 'ctrl', width: 1.25, variant: 'mod' },
  ],
]

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLibraryText(text: string): TextItem[] {
  return stripMarkdown(text)
    .split(/\n|。|、|\.|,|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [kana, romaji] = part.includes('|') ? part.split('|') : part.split(/\s{2,}/)
      return kana && romaji ? { kana: kana.trim(), romaji: romaji.trim().toLowerCase() } : null
    })
    .filter((item): item is TextItem => item !== null)
}

function buildParagraph(items: TextItem[], source: SourceName, length: number): Lesson {
  const picked = Array.from({ length }, () => pickRandom(items))
  return {
    kana: picked.map((item) => item.kana).join(' '),
    romaji: picked.map((item) => item.romaji).join(' '),
    source,
  }
}

function drillBankFromMisses(misses: Record<string, number>): TextItem[] {
  const weakLetters = Object.entries(misses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([letter]) => letter)

  if (weakLetters.length === 0) return drillFallbackBank

  const candidates = [...wordBank, ...difficultBank, ...drillFallbackBank].filter((item) =>
    weakLetters.some((letter) => item.romaji.includes(letter)),
  )
  return candidates.length > 0 ? candidates : drillFallbackBank
}

function generateLesson(
  requestedSource: SourceName,
  settings: Settings,
  misses: Record<string, number>,
  library: TextItem[],
  bestWpmValue = 0,
): Lesson {
  const usableSource =
    !sourceUnlocked(requestedSource, bestWpmValue)
      ? 'words'
      : requestedSource === 'library' && library.length === 0
      ? 'words'
      : requestedSource === 'auto'
        ? pickRandom<Exclude<SourceName, 'auto' | 'library'>>(
            explicitSourcesForBest(bestWpmValue).filter(
              (item): item is Exclude<SourceName, 'auto' | 'library'> => item !== 'library',
            ),
          )
        : requestedSource

  if (usableSource === 'drills') {
    return buildParagraph(drillBankFromMisses(misses), 'drills', settings.paragraphItems)
  }
  if (usableSource === 'library') {
    return buildParagraph(library, 'library', settings.paragraphItems)
  }
  return buildParagraph(sourceBanks[usableSource], usableSource, settings.paragraphItems)
}

function routeFromHash(): RouteName {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'result' || hash === 'stats' || hash === 'library' || hash === 'settings') {
    return hash
  }
  return 'practice'
}

function dayKey(dateString: string): string {
  return new Date(dateString).toISOString().slice(0, 10)
}

function runWpm(run: RunResult): number {
  return run.wpm ?? Math.round((run.cpm ?? 0) / 5)
}

function runRawWpm(run: RunResult): number {
  return run.rawWpm ?? Math.round((run.rawCpm ?? run.cpm ?? 0) / 5)
}

function sourceUnlockAt(source: SourceName): number {
  return sourceOptions.find((option) => option.value === source)?.unlockAt ?? 0
}

function sourceUnlocked(source: SourceName, best: number): boolean {
  return best >= sourceUnlockAt(source)
}

function explicitSourcesForBest(best: number): Exclude<SourceName, 'auto'>[] {
  return sourceOptions
    .filter((option) => option.value !== 'auto' && option.value !== 'library')
    .filter((option) => sourceUnlocked(option.value, best))
    .map((option) => option.value as Exclude<SourceName, 'auto'>)
}

function unlockedMilestones(runs: RunResult[]): Unlock[] {
  const best = Math.max(0, ...runs.map((run) => runWpm(run)))
  const sessions = runs.length
  const chars = runs.reduce((sum, run) => sum + run.chars, 0)
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

function newlyReachedMilestones(before: RunResult[], after: RunResult[]): Unlock[] {
  const oldReached = new Set(unlockedMilestones(before).filter((item) => item.reached).map((item) => item.id))
  return unlockedMilestones(after).filter((item) => item.reached && !oldReached.has(item.id))
}

function sourceBreakdown(runs: RunResult[]): { source: SourceName; count: number; avg: number }[] {
  const grouped = new Map<SourceName, { count: number; total: number }>()
  for (const run of runs) {
    const current = grouped.get(run.source) ?? { count: 0, total: 0 }
    current.count += 1
    current.total += runWpm(run)
    grouped.set(run.source, current)
  }
  return [...grouped.entries()]
    .map(([source, data]) => ({ source, count: data.count, avg: Math.round(data.total / data.count) }))
    .sort((a, b) => b.count - a.count)
}

function dailyCounts(runs: RunResult[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const run of runs) {
    const key = dayKey(run.date)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function recentDayKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (count - 1 - index))
    return date.toISOString().slice(0, 10)
  })
}

function mergeTimingStats(runs: RunResult[], field: 'keyStats' | 'bigramStats') {
  const merged = new Map<string, TimingStat>()
  for (const run of runs) {
    const stats = run[field] ?? {}
    for (const [key, stat] of Object.entries(stats)) {
      const current = merged.get(key) ?? { attempts: 0, misses: 0, totalMs: 0 }
      current.attempts += stat.attempts
      current.misses += stat.misses
      current.totalMs += stat.totalMs
      merged.set(key, current)
    }
  }

  const aggregated = new Map<string, AggregatedTimingStat>()
  for (const [key, stat] of merged) {
    aggregated.set(key, {
      ...stat,
      avgMs: stat.attempts > 0 ? stat.totalMs / stat.attempts : 0,
      errorRate: stat.attempts > 0 ? stat.misses / stat.attempts : 0,
    })
  }
  return aggregated
}

function topTimingStats(stats: Map<string, AggregatedTimingStat>, limit: number) {
  return [...stats.entries()]
    .filter(([, stat]) => stat.attempts >= 2)
    .sort((a, b) => b[1].avgMs + b[1].errorRate * 500 - (a[1].avgMs + a[1].errorRate * 500))
    .slice(0, limit)
}

function streakStats(runs: RunResult[]): { current: number; longest: number } {
  const days = [...new Set(runs.map((run) => dayKey(run.date)))].sort()
  if (days.length === 0) return { current: 0, longest: 0 }

  let longest = 1
  let runLength = 1
  for (let index = 1; index < days.length; index += 1) {
    const prev = new Date(`${days[index - 1]}T00:00:00`)
    prev.setDate(prev.getDate() + 1)
    if (prev.toISOString().slice(0, 10) === days[index]) {
      runLength += 1
      longest = Math.max(longest, runLength)
    } else {
      runLength = 1
    }
  }

  const daySet = new Set(days)
  const cursor = new Date()
  if (!daySet.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  let current = 0
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    current += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return { current, longest }
}

function wpmDistribution(runs: RunResult[]): { label: string; count: number }[] {
  const bins = [
    { label: '0-20', min: 0, max: 20, count: 0 },
    { label: '20-40', min: 20, max: 40, count: 0 },
    { label: '40-60', min: 40, max: 60, count: 0 },
    { label: '60-80', min: 60, max: 80, count: 0 },
    { label: '80+', min: 80, max: Number.POSITIVE_INFINITY, count: 0 },
  ]
  for (const run of runs) {
    const wpm = runWpm(run)
    const bin = bins.find((candidate) => wpm >= candidate.min && wpm < candidate.max)
    if (bin) bin.count += 1
  }
  return bins
}

function App() {
  const [route, setRoute] = createSignal<RouteName>(routeFromHash())
  const [settings, setSettings] = createSignal<Settings>(
    readJson<Settings>(SETTINGS_KEY, { paragraphItems: 8 }),
  )
  const [runs, setRuns] = createSignal<RunResult[]>(readJson<RunResult[]>(RUNS_KEY, []))
  const [missMap, setMissMap] = createSignal<Record<string, number>>(
    readJson<Record<string, number>>(MISSES_KEY, {}),
  )
  const [confusionMap, setConfusionMap] = createSignal<Record<string, number>>(
    readJson<Record<string, number>>(CONFUSIONS_KEY, {}),
  )
  const [library, setLibrary] = createSignal<TextItem[]>(readJson<TextItem[]>(LIBRARY_KEY, []))
  const [source, setSource] = createSignal<SourceName>('auto')
  const [lesson, setLesson] = createSignal<Lesson>(
    generateLesson('auto', settings(), missMap(), library()),
  )
  const [pos, setPos] = createSignal(0)
  const [statuses, setStatuses] = createSignal<CharStatus[]>([])
  const [mistakes, setMistakes] = createSignal(0)
  const [startedAt, setStartedAt] = createSignal<number | null>(null)
  const [finishedAt, setFinishedAt] = createSignal<number | null>(null)
  const [tick, setTick] = createSignal(Date.now())
  const [runKeyStats, setRunKeyStats] = createSignal<Record<string, TimingStat>>({})
  const [runBigramStats, setRunBigramStats] = createSignal<Record<string, TimingStat>>({})
  const [intervals, setIntervals] = createSignal<number[]>([])
  const [pressedKeys, setPressedKeys] = createSignal<ReadonlySet<string>>(new Set())
  const [showKeyboard, setShowKeyboard] = createSignal(
    localStorage.getItem(SHOW_KEYBOARD_KEY) !== '0',
  )
  const [customText, setCustomText] = createSignal('')
  const [lastRun, setLastRun] = createSignal<RunResult | null>(runs()[0] ?? null)
  const [resultUnlocks, setResultUnlocks] = createSignal<Unlock[]>([])

  let hiddenInput: HTMLInputElement | undefined
  let savedCurrentRun = false
  let lastCorrectAt: number | null = null

  const expected = createMemo(() => lesson().romaji)
  const kanaParts = createMemo(() => lesson().kana.split(' '))
  const romajiParts = createMemo(() => expected().split(' '))
  const tokenRanges = createMemo(() => {
    let cursor = 0
    return romajiParts().map((part) => {
      const start = cursor
      const end = start + part.length
      cursor = end + 1
      return { start, end }
    })
  })
  const isComplete = createMemo(() => pos() === expected().length)
  const elapsedSeconds = createMemo(() => {
    tick()
    const start = startedAt()
    if (!start) return 0
    return ((finishedAt() ?? Date.now()) - start) / 1000
  })
  const accuracy = createMemo(() => {
    const hits = statuses().filter((status) => status === 'correct').length
    const attempts = hits + mistakes()
    if (attempts === 0) return 100
    return Math.max(0, Math.round((hits / attempts) * 100))
  })
  const speed = createMemo(() => {
    const elapsed = elapsedSeconds()
    if (elapsed <= 0) return 0
    return Math.round(((pos() / 5) / elapsed) * 60)
  })
  const rawSpeed = createMemo(() => {
    const elapsed = elapsedSeconds()
    if (elapsed <= 0) return 0
    return Math.round((((pos() + mistakes()) / 5) / elapsed) * 60)
  })
  const consistency = createMemo(() => {
    const samples = intervals().filter((interval) => interval > 0)
    if (samples.length < 3) return 100
    const avg = samples.reduce((sum, interval) => sum + interval, 0) / samples.length
    const variance =
      samples.reduce((sum, interval) => sum + (interval - avg) ** 2, 0) / samples.length
    const deviation = Math.sqrt(variance)
    return Math.max(0, Math.min(100, Math.round(100 - (deviation / avg) * 100)))
  })
  const topConfusions = createMemo(() =>
    Object.entries(confusionMap())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  )
  const averageCpm = createMemo(() => {
    const history = runs()
    if (history.length === 0) return 0
    return Math.round(history.reduce((sum, run) => sum + runWpm(run), 0) / history.length)
  })
  const bestWpm = createMemo(() => Math.max(0, ...runs().map((run) => runWpm(run))))
  const milestones = createMemo(() => unlockedMilestones(runs()))
  const totalMinutes = createMemo(() =>
    Math.round(runs().reduce((sum, run) => sum + run.elapsedMs, 0) / 60_000),
  )
  const sourceStats = createMemo(() => sourceBreakdown(runs()))
  const dayStats = createMemo(() => dailyCounts(runs()))
  const resultRun = createMemo(() => lastRun() ?? runs()[0] ?? null)
  const keyStats = createMemo(() => mergeTimingStats(runs(), 'keyStats'))
  const bigramStats = createMemo(() => mergeTimingStats(runs(), 'bigramStats'))
  const slowKeys = createMemo(() => topTimingStats(keyStats(), 12))
  const slowBigrams = createMemo(() => topTimingStats(bigramStats(), 8))
  const streaks = createMemo(() => streakStats(runs()))
  const distribution = createMemo(() => wpmDistribution(runs()))

  const navigate = (next: RouteName) => {
    window.location.hash = next === 'practice' ? '#/practice' : `#/${next}`
    setRoute(next)
  }

  const resetRunState = () => {
    savedCurrentRun = false
    setPos(0)
    setStatuses([])
    setMistakes(0)
    setStartedAt(null)
    setFinishedAt(null)
    setRunKeyStats({})
    setRunBigramStats({})
    setIntervals([])
    lastCorrectAt = null
  }

  const freshText = () => {
    setLesson(generateLesson(source(), settings(), missMap(), library(), bestWpm()))
    resetRunState()
    navigate('practice')
  }

  const changeSource = (nextSource: SourceName) => {
    if (!sourceUnlocked(nextSource, bestWpm())) return
    setSource(nextSource)
    setLesson(generateLesson(nextSource, settings(), missMap(), library(), bestWpm()))
    resetRunState()
  }

  const saveCurrentRun = () => {
    const start = startedAt()
    const finish = finishedAt()
    if (savedCurrentRun || !start || !finish) return null
    savedCurrentRun = true
    const run: RunResult = {
      source: lesson().source,
      chars: expected().length,
      mistakes: mistakes(),
      accuracy: accuracy(),
      wpm: speed(),
      rawWpm: rawSpeed(),
      consistency: consistency(),
      elapsedMs: finish - start,
      date: new Date().toISOString(),
      keyStats: runKeyStats(),
      bigramStats: runBigramStats(),
    }
    setLastRun(run)
    const previous = runs()
    const nextRuns = [run, ...previous].slice(0, 100)
    setResultUnlocks(newlyReachedMilestones(previous, nextRuns))
    setRuns((current) => {
      const next = [run, ...current].slice(0, 100)
      writeJson(RUNS_KEY, next)
      return next
    })
    return run
  }

  const typeChar = (rawChar: string) => {
    if (isComplete() || route() !== 'practice') return

    const char = rawChar.toLowerCase()
    const currentPos = pos()
    const target = expected()[currentPos]
    const now = Date.now()

    if (!startedAt()) setStartedAt(now)

    if (char === target) {
      const interval = lastCorrectAt === null ? 0 : Math.min(3000, now - lastCorrectAt)
      if (interval > 0) {
        setIntervals((current) => [...current, interval])
      }
      setRunKeyStats((current) => {
        const stat = current[target] ?? { attempts: 0, misses: 0, totalMs: 0 }
        return {
          ...current,
          [target]: {
            attempts: stat.attempts + 1,
            misses: stat.misses,
            totalMs: stat.totalMs + interval,
          },
        }
      })
      if (currentPos > 0) {
        const bigram = expected().slice(currentPos - 1, currentPos + 1)
        setRunBigramStats((current) => {
          const stat = current[bigram] ?? { attempts: 0, misses: 0, totalMs: 0 }
          return {
            ...current,
            [bigram]: {
              attempts: stat.attempts + 1,
              misses: stat.misses,
              totalMs: stat.totalMs + interval,
            },
          }
        })
      }
      lastCorrectAt = now
      setStatuses((current) => {
        const next = [...current]
        next[currentPos] = 'correct'
        return next
      })
      const nextPos = currentPos + 1
      setPos(nextPos)
      if (nextPos === expected().length) {
        setFinishedAt(now)
        setTimeout(() => {
          saveCurrentRun()
          navigate('result')
        }, 0)
      }
      return
    }

    setStatuses((current) => {
      const next = [...current]
      next[currentPos] = 'incorrect'
      return next
    })
    setMistakes((count) => count + 1)
    setRunKeyStats((current) => {
      const stat = current[target] ?? { attempts: 0, misses: 0, totalMs: 0 }
      return {
        ...current,
        [target]: {
          attempts: stat.attempts + 1,
          misses: stat.misses + 1,
          totalMs: stat.totalMs,
        },
      }
    })
    if (currentPos > 0) {
      const bigram = expected().slice(currentPos - 1, currentPos + 1)
      setRunBigramStats((current) => {
        const stat = current[bigram] ?? { attempts: 0, misses: 0, totalMs: 0 }
        return {
          ...current,
          [bigram]: {
            attempts: stat.attempts + 1,
            misses: stat.misses + 1,
            totalMs: stat.totalMs,
          },
        }
      })
    }
    setMissMap((current) => {
      const key = target === ' ' ? 'space' : target
      const next = { ...current, [key]: (current[key] ?? 0) + 1 }
      writeJson(MISSES_KEY, next)
      return next
    })
    setConfusionMap((current) => {
      const expectedKey = target === ' ' ? 'space' : target
      const typedKey = char === ' ' ? 'space' : char
      const pair = `${expectedKey} → ${typedKey}`
      const next = { ...current, [pair]: (current[pair] ?? 0) + 1 }
      writeJson(CONFUSIONS_KEY, next)
      return next
    })
  }

  const backspace = () => {
    if (pos() === 0 || isComplete()) return
    const nextPos = pos() - 1
    setPos(nextPos)
    setStatuses((current) => {
      const next = [...current]
      next[nextPos] = 'pending'
      return next
    })
  }

  const setKeyboardVisible = (visible: boolean) => {
    localStorage.setItem(SHOW_KEYBOARD_KEY, visible ? '1' : '0')
    setShowKeyboard(visible)
  }

  const updateParagraphLength = (length: number) => {
    const next = { paragraphItems: Math.max(3, Math.min(30, length)) }
    setSettings(next)
    writeJson(SETTINGS_KEY, next)
    setLesson(generateLesson(source(), next, missMap(), library(), bestWpm()))
    resetRunState()
  }

  const addCustomText = (text: string) => {
    const parsed = parseLibraryText(text)
    if (parsed.length === 0) return
    setLibrary((current) => {
      const next = [...parsed, ...current].slice(0, 200)
      writeJson(LIBRARY_KEY, next)
      return next
    })
    setCustomText('')
    changeSource('library')
    navigate('practice')
  }

  const handleFile = async (file: File) => {
    addCustomText(await file.text())
  }

  const refocus = () => {
    if (route() === 'practice') hiddenInput?.focus({ preventScroll: true })
  }

  onMount(() => {
    refocus()
    const interval = window.setInterval(() => setTick(Date.now()), 500)
    const hashchange = () => setRoute(routeFromHash())

    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.isComposing || event.keyCode === 229 || event.repeat) return
      setPressedKeys((current) => new Set(current).add(event.code))

      if (route() === 'result' && event.key === 'Enter') {
        event.preventDefault()
        freshText()
        return
      }

      if (route() !== 'practice') return

      if (event.key === 'Tab') {
        event.preventDefault()
        freshText()
        return
      }
      if (event.key === 'Enter') {
        if (isComplete()) {
          event.preventDefault()
          freshText()
        }
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        backspace()
        return
      }
      if (event.key.length === 1) {
        event.preventDefault()
        typeChar(event.key)
      }
    }

    const keyup = (event: KeyboardEvent) => {
      setPressedKeys((current) => {
        const next = new Set(current)
        next.delete(event.code)
        return next
      })
    }
    const clearPressedKeys = () => setPressedKeys(new Set<string>())

    window.addEventListener('hashchange', hashchange)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clearPressedKeys)

    onCleanup(() => {
      window.clearInterval(interval)
      window.removeEventListener('hashchange', hashchange)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clearPressedKeys)
    })
  })

  return (
    <main class="app" onClick={refocus}>
      <aside class="live-stats" aria-label="live stats">
        <span>
          <b>{speed()}</b> wpm
        </span>
        <span>
          <b>{accuracy()}</b>% acc
        </span>
        <span>
          <b>{mistakes()}</b> miss
        </span>
      </aside>

      <nav class="topnav" aria-label="main navigation">
        <button classList={{ active: route() === 'practice' }} onClick={() => navigate('practice')}>
          practice
        </button>
        <button classList={{ active: route() === 'stats' }} onClick={() => navigate('stats')}>
          stats
        </button>
        <button classList={{ active: route() === 'library' }} onClick={() => navigate('library')}>
          library
        </button>
        <button
          classList={{ active: route() === 'settings' }}
          onClick={() => navigate('settings')}
        >
          settings
        </button>
      </nav>

      <Show when={route() === 'practice'}>
        <section class="stage">
          <input
            ref={(el) => {
              hiddenInput = el
            }}
            class="sr-only"
            type="text"
            inputmode="text"
            autocapitalize="off"
            autocomplete="off"
            spellcheck={false}
            aria-label="typing capture"
            value=""
            onInput={(event) => {
              event.currentTarget.value = ''
            }}
            onBeforeInput={(event) => {
              if (event.inputType === 'deleteContentBackward') {
                event.preventDefault()
                backspace()
                return
              }
              if (event.inputType === 'insertText' && event.data) {
                event.preventDefault()
                for (const char of event.data) typeChar(char)
              }
            }}
          />

          <section class="typing-area" aria-label="practice paragraph">
            <p class="kana-line">
              <For each={kanaParts()}>
                {(part, index) => {
                  const range = () => tokenRanges()[index()]
                  const state = () => {
                    const current = range()
                    if (!current) return 'pending'
                    if (pos() >= current.end) return 'done'
                    if (pos() >= current.start && pos() <= current.end) return 'current'
                    return 'pending'
                  }
                  return (
                    <span
                      classList={{
                        'kana-token': true,
                        'kana-token--done': state() === 'done',
                        'kana-token--current': state() === 'current',
                      }}
                    >
                      {part}
                    </span>
                  )
                }}
              </For>
            </p>
            <p class="romaji-line">
              <For each={expected().split('')}>
                {(char, index) => (
                  <span
                    classList={{
                      char: true,
                      'char--correct': statuses()[index()] === 'correct',
                      'char--incorrect': statuses()[index()] === 'incorrect',
                      'char--current': index() === pos(),
                    }}
                  >
                    {char}
                  </span>
                )}
              </For>
            </p>
          </section>

          <Show when={showKeyboard()}>
            <section class="kb" aria-label="keyboard">
              <For each={keyboardRows}>
                {(row) => (
                  <div class="kb__row">
                    <For each={row}>
                      {(key) => (
                        <div
                          class="kb__key"
                          classList={{
                            'kb__key--mod': key.variant === 'mod',
                            'kb__key--space': key.variant === 'space',
                            'kb__key--pressed': pressedKeys().has(key.code),
                          }}
                          style={{ '--w': key.width ?? 1 }}
                          aria-hidden="true"
                        >
                          {key.label}
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </section>
          </Show>

          <div class="practice-hints">
            <div class="practice-hints__row">
              <p class="hint">
                <kbd>Tab</kbd> fresh text
              </p>
              <Show when={isComplete()}>
                <p class="hint">
                  <kbd>Enter</kbd> next
                </p>
              </Show>
              <button
                type="button"
                class="hint-button"
                aria-pressed={showKeyboard()}
                onClick={(event) => {
                  event.stopPropagation()
                  setKeyboardVisible(!showKeyboard())
                }}
              >
                {showKeyboard() ? 'hide keyboard' : 'show keyboard'}
              </button>
            </div>
            <div class="practice-hints__row">
              <span>source</span>
              <For each={sourceOptions}>
                {(option) => (
                  <button
                    type="button"
                    class="source-button"
                    disabled={!sourceUnlocked(option.value, bestWpm())}
                    title={
                      sourceUnlocked(option.value, bestWpm())
                        ? option.label
                        : `unlocks at ${option.unlockAt} wpm`
                    }
                    classList={{
                      active: source() === option.value,
                      locked: !sourceUnlocked(option.value, bestWpm()),
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      changeSource(option.value)
                    }}
                  >
                    {option.label}
                    <Show when={!sourceUnlocked(option.value, bestWpm())}>
                      <small> {option.unlockAt}</small>
                    </Show>
                  </button>
                )}
              </For>
              <span class="source-current">picked: {lesson().source}</span>
            </div>
          </div>
        </section>
      </Show>

      <Show when={route() === 'result'}>
        <section class="page page--narrow result-page">
          <h1>result</h1>
          <Show when={resultRun()} fallback={<p class="muted">No completed run yet.</p>}>
            {(run) => (
              <>
                <Show when={resultUnlocks().length > 0}>
                  <section class="achievement" role="status" aria-live="polite">
                    <span class="achievement__title">achievement unlocked</span>
                    <For each={resultUnlocks()}>
                      {(item) => <span class="achievement__chip">{item.label}</span>}
                    </For>
                  </section>
                </Show>

                <div class="result-hero">
                  <div>
                    <b>{runWpm(run())}</b>
                    <span>speed</span>
                  </div>
                  <div>
                    <b>{run().accuracy}%</b>
                    <span>accuracy</span>
                  </div>
                </div>

                <div class="result-grid">
                  <div>
                    <b>{runRawWpm(run())}</b>
                    <span>raw</span>
                  </div>
                  <div>
                    <b>{run().consistency ?? 100}%</b>
                    <span>consistency</span>
                  </div>
                  <div>
                    <b>{run().mistakes}</b>
                    <span>misses</span>
                  </div>
                  <div>
                    <b>{(run().elapsedMs / 1000).toFixed(1)}s</b>
                    <span>time</span>
                  </div>
                </div>

                <div class="result-meta">
                  <span>source: {run().source}</span>
                  <span>chars: {run().chars}</span>
                  <span>{new Date(run().date).toLocaleString()}</span>
                </div>

                <div class="action-row">
                  <button type="button" class="primary" onClick={freshText}>
                    next practice
                  </button>
                  <button
                    type="button"
                    class="secondary"
                    onClick={() => {
                      resetRunState()
                      navigate('practice')
                    }}
                  >
                    retry same text
                  </button>
                  <button type="button" class="secondary" onClick={() => navigate('stats')}>
                    view stats
                  </button>
                </div>

                <p class="muted">
                  <kbd>Enter</kbd> next practice
                </p>
              </>
            )}
          </Show>
        </section>
      </Show>

      <Show when={route() === 'stats'}>
        <section class="page stats-page">
          <div class="profile-id">
            <div class="avatar">YOU</div>
            <div>
              <h1>your statistics</h1>
              <p class="muted">
                {runs().length} sessions · {totalMinutes()} min typing
              </p>
            </div>
          </div>

          <div class="stat-grid">
            <div>
              <b>{bestWpm()}</b>
              <span>best wpm</span>
            </div>
            <div>
              <b>{averageCpm()}</b>
              <span>avg wpm</span>
            </div>
            <div>
              <b>{accuracy()}%</b>
              <span>current acc</span>
            </div>
            <div>
              <b>{streaks().current}</b>
              <span>current streak</span>
            </div>
          </div>

          <div class="stats-grid-2">
            <section class="panel">
              <h2>slow / missed keys</h2>
              <div class="mini-keyboard">
                <For each={['qwertyuiop', 'asdfghjkl', 'zxcvbnm']}>
                  {(row) => (
                    <div class="mini-keyboard-row">
                      <For each={row.split('')}>
                        {(letter) => {
                          const count = () => missMap()[letter] ?? 0
                          return (
                            <span
                              class="mini-key"
                              style={{
                                opacity: String(
                                  0.24 +
                                    Math.min(
                                      0.76,
                                      ((keyStats().get(letter)?.avgMs ?? 0) / 600) +
                                        (keyStats().get(letter)?.errorRate ?? 0),
                                    ),
                                ),
                              }}
                              title={`${letter}: ${count()} misses · ${Math.round(
                                keyStats().get(letter)?.avgMs ?? 0,
                              )} ms avg`}
                            >
                              {letter}
                              <small>{count() || ''}</small>
                            </span>
                          )
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section class="panel">
              <h2>most confused</h2>
              <div class="bar-list">
                <For each={topConfusions()} fallback={<p class="muted">No confused pairs yet.</p>}>
                  {([pair, count]) => (
                    <div class="bar-row">
                      <span>{pair}</span>
                      <meter min="0" max={Math.max(1, topConfusions()[0]?.[1] ?? 1)} value={count} />
                      <b>{count}</b>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>

          <div class="stats-grid-2">
            <section class="panel">
              <h2>slowest letters</h2>
              <div class="bar-list">
                <For each={slowKeys()} fallback={<p class="muted">Complete a run to collect timing.</p>}>
                  {([letter, stat]) => (
                    <div class="bar-row">
                      <span>{letter === ' ' ? 'space' : letter}</span>
                      <meter min="0" max={Math.max(1, slowKeys()[0]?.[1].avgMs ?? 1)} value={stat.avgMs} />
                      <b>{Math.round(stat.avgMs)} ms</b>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section class="panel">
              <h2>slowest pairs</h2>
              <div class="bar-list">
                <For each={slowBigrams()} fallback={<p class="muted">No pair timing yet.</p>}>
                  {([pair, stat]) => (
                    <div class="bar-row">
                      <span>{pair.replaceAll(' ', '␣')}</span>
                      <meter min="0" max={Math.max(1, slowBigrams()[0]?.[1].avgMs ?? 1)} value={stat.avgMs} />
                      <b>{Math.round(stat.avgMs)} ms</b>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>

          <div class="stats-grid-2">
            <section class="panel">
              <h2>last 60 days</h2>
              <div class="calendar-grid">
                <For each={recentDayKeys(60)}>
                  {(key) => {
                    const count = () => dayStats().get(key) ?? 0
                    const max = () => Math.max(1, ...dayStats().values())
                    return (
                      <span
                        class="calendar-cell"
                        classList={{ active: count() > 0 }}
                        style={{ opacity: String(count() === 0 ? 0.24 : 0.35 + count() / max()) }}
                        title={`${key}: ${count()} runs`}
                      />
                    )
                  }}
                </For>
              </div>
            </section>

            <section class="panel">
              <h2>source breakdown</h2>
              <div class="bar-list">
                <For each={sourceStats()} fallback={<p class="muted">No runs yet.</p>}>
                  {(item) => (
                    <div class="bar-row">
                      <span>{item.source}</span>
                      <meter min="0" max={runs().length || 1} value={item.count} />
                      <b>{item.avg} wpm</b>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>

          <div class="stats-grid-2">
            <section class="panel">
              <h2>streaks</h2>
              <div class="stat-grid stat-grid--compact">
                <div>
                  <b>{streaks().current}</b>
                  <span>current</span>
                </div>
                <div>
                  <b>{streaks().longest}</b>
                  <span>longest</span>
                </div>
              </div>
            </section>

            <section class="panel">
              <h2>wpm distribution</h2>
              <div class="bar-list">
                <For each={distribution()}>
                  {(bin) => (
                    <div class="bar-row">
                      <span>{bin.label}</span>
                      <meter min="0" max={Math.max(1, ...distribution().map((item) => item.count))} value={bin.count} />
                      <b>{bin.count}</b>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>

          <section class="panel">
            <h2>milestones</h2>
            <div class="milestone-grid">
              <For each={milestones()}>
                {(item) => (
                  <span class="milestone" classList={{ reached: item.reached }}>
                    {item.label}
                  </span>
                )}
              </For>
            </div>
          </section>

          <section class="panel">
            <h2>recent runs</h2>
            <div class="runs-table">
              <For each={runs().slice(0, 12)} fallback={<p class="muted">No runs yet.</p>}>
                {(run) => (
                  <div class="run-row">
                    <span>{new Date(run.date).toLocaleDateString()}</span>
                    <span>{run.source}</span>
                    <span>{run.accuracy}%</span>
                    <b>{runWpm(run)} wpm</b>
                  </div>
                )}
              </For>
            </div>
          </section>
        </section>
      </Show>

      <Show when={route() === 'library'}>
        <section class="page">
          <h1>library</h1>
          <p class="muted">
            Paste lines as <code>かな|romaji</code>, or upload a .txt/.md file with that format.
          </p>
          <textarea
            value={customText()}
            onInput={(event) => setCustomText(event.currentTarget.value)}
            placeholder={'おはよう|ohayou\nきょうはいいてんきです|kyouhaiitenkidesu'}
          />
          <div class="action-row">
            <button type="button" class="primary" onClick={() => addCustomText(customText())}>
              add text
            </button>
            <label class="file-button">
              upload .txt/.md
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void handleFile(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </div>
          <h2>saved entries</h2>
          <div class="library-list">
            <For each={library()} fallback={<p class="muted">No custom text yet.</p>}>
              {(item) => (
                <div class="library-item">
                  <span>{item.kana}</span>
                  <code>{item.romaji}</code>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={route() === 'settings'}>
        <section class="page page--narrow">
          <h1>settings</h1>
          <label class="field">
            <span>paragraph length</span>
            <input
              type="range"
              min="3"
              max="30"
              value={settings().paragraphItems}
              onInput={(event) => updateParagraphLength(Number(event.currentTarget.value))}
            />
            <b>{settings().paragraphItems} items per run</b>
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={showKeyboard()}
              onChange={(event) => setKeyboardVisible(event.currentTarget.checked)}
            />
            <span>show on-screen keyboard</span>
          </label>
        </section>
      </Show>
    </main>
  )
}

export default App
