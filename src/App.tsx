import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import './App.css'
import {
  drillMoras,
  dealLesson,
  generateLesson,
  planRun,
  type RunPlan,
  kanaRows,
  parseLibrary,
  type LibraryReject,
  sourceOptions,
} from './engine/lessons'
import { compilePrompt, wordIndexForToken } from './engine/prompt'
import { projectMatch } from './engine/romanization'
import {
  applyBackspace,
  applyTypeChar,
  buildRunResult,
  computeMetrics,
  emptySession,
  finishRun,
  remainingMs,
  rollToNextPrompt,
} from './engine/session'
import type { SessionState } from './engine/session'
import {
  dailyCounts,
  mergeTimingStats,
  newlyReachedMilestones,
  nextMilestone,
  unlockedMilestones,
  recentDayKeys,
  recordRunInLifetimeStats,
  runRawWpm,
  runWpm,
  streakStats,
  topTimingStats,
  mergeMoraStats,
  recentAccuracy,
  slowestMoras,
  weakMoraCount,
  runCohorts,
  defaultCohort,
  progressPoints,
  weakAfterRun,
  smoothedErrorRate,
  leastPractisedKana,
  weakestKana,
} from './engine/stats'
import { KANA_GROUPS, KEYBOARD_LAYOUT_NAMES, STANDARD_TIMED_MS, THEME_NAMES } from './engine/types'
import type {
  KanaGroup,
  KeyboardLayoutName,
  ThemeName,
  Lesson,
  LifetimeStats,
  RunResult,
  Settings,
  SourceName,
  TextItem,
  Unlock,
} from './engine/types'
import {
  backupFilename,
  downloadText,
  exportBackup,
  importBackup,
  resetProfile,
} from './io/backup'
import {
  KANA_GROUP_KEY,
  KEYBOARD_LAYOUT_KEY,
  THEME_KEY,
  SETTINGS_KEY,
  SHOW_KEYBOARD_KEY,
  SOURCE_KEY,
  emptyProfile,
  loadProfile,
  migrateLocalStorage,
  readKanaGroup,
  readKeyboardLayout,
  readTheme,
  readSettings,
  readShowKeyboard,
  readSource,
  type Preferences,
  type StoredProfile,
} from './io/persistence'
import { createRecordStore, type RecordName } from './io/records'
import { writeJson } from './io/storage'
import { BottomNav } from './ui/BottomNav'
import { chartCoverage } from './engine/mastery'
import { MasteryMap } from './ui/MasteryMap'
import { ProgressChart } from './ui/ProgressChart'
import { TooltipLayer, tipFor } from './ui/Tooltip'
import { OnScreenKeyboard } from './ui/OnScreenKeyboard'
import { Topbar } from './ui/Topbar'
import { routeFromHash, type RouteName } from './ui/router'

/**
 * One store for the whole page. `durable` is false when the browser has no
 * IndexedDB at all — private browsing in some engines, or a locked-down embed —
 * in which case the session works but nothing survives a reload, and the app
 * says so rather than pretending it saved.
 */
const { store: recordStore, durable: durableStore } = createRecordStore()

/** Chart groups, labelled the way a learner would name them. */
const KANA_GROUP_LABELS: Record<KanaGroup, string> = {
  all: 'all',
  seion: 'seion',
  dakuten: 'dakuten',
  yoon: 'yōon',
}

function App() {
  const [route, setRoute] = createSignal<RouteName>(routeFromHash())
  const [settings, setSettings] = createSignal<Settings>(readSettings())
  // Records live in IndexedDB, which is asynchronous, so these start empty and
  // are filled by the bootstrap below. The placeholder lesson is never seen —
  // `ready` gates the render.
  const [ready, setReady] = createSignal(false)
  const [runs, setRuns] = createSignal<RunResult[]>([])
  const [lifetimeStats, setLifetimeStats] = createSignal<LifetimeStats>(emptyProfile().lifetime)
  const [missMap, setMissMap] = createSignal<Record<string, number>>({})
  const [confusionMap, setConfusionMap] = createSignal<Record<string, number>>({})
  const [library, setLibrary] = createSignal<TextItem[]>([])
  const [source, setSource] = createSignal<SourceName>(readSource())
  const [lesson, setLesson] = createSignal<Lesson>(
    generateLesson('words', readSettings(), [], [], Math.random, 'all'),
  )
  const [session, setSession] = createSignal<SessionState>(emptySession())
  const [tick, setTick] = createSignal(Date.now())
  const [pressedKeys, setPressedKeys] = createSignal<ReadonlySet<string>>(new Set())
  const [showKeyboard, setShowKeyboard] = createSignal(readShowKeyboard())
  const [theme, setThemeSignal] = createSignal<ThemeName>(readTheme())

  /*
   * Writes the resolved palette onto the root element.
   *
   * `system` sets no attribute at all rather than resolving to a value: the
   * media query then answers, and the app follows the desktop switching between
   * light and dark without a reload. Only an explicit choice pins it.
   */
  createEffect(() => {
    const chosen = theme()
    const root = document.documentElement
    if (chosen === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', chosen)
  })

  const setTheme = (next: ThemeName) => {
    persist(THEME_KEY, next)
    setThemeSignal(next)
  }
  const [keyboardLayout, setKeyboardLayout] = createSignal<KeyboardLayoutName>(readKeyboardLayout())
  const [kanaGroup, setKanaGroup] = createSignal<KanaGroup>(readKanaGroup())
  const [customText, setCustomText] = createSignal('')
  const [libraryMessage, setLibraryMessage] = createSignal<string | null>(null)
  const [lastRun, setLastRun] = createSignal<RunResult | null>(runs()[0] ?? null)
  const [resultUnlocks, setResultUnlocks] = createSignal<Unlock[]>([])
  const nextTarget = createMemo(() => nextMilestone(lifetimeStats()))
  const milestones = createMemo(() => unlockedMilestones(lifetimeStats()))
  const [saveFailed, setSaveFailed] = createSignal(false)
  const [dataMessage, setDataMessage] = createSignal('')
  const [resetArmed, setResetArmed] = createSignal(false)

  let hiddenInput: HTMLInputElement | undefined
  let savedCurrentRun = false
  /** Pending navigation to the result screen; cancelled if the run is reset. */
  let completionTimer: number | null = null
  /** Fires at the deadline of a timed run; cancelled with the run. */
  let deadlineTimer: number | null = null

  /**
   * The lesson as the matcher and the screen both see it: one token per mora,
   * each carrying every spelling that types it, plus the display words already
   * split into the runs that take a reading above them. Compiled together so the
   * cursor's word index can't address a word the display doesn't have.
   */
  const prompt = createMemo(() => compilePrompt(lesson().items))
  const tokens = createMemo(() => prompt().tokens)
  const tokenWords = createMemo(() => wordIndexForToken(tokens()))
  const displayWords = createMemo(() => prompt().words)
  const projection = createMemo(() => projectMatch(tokens(), session().match))
  /** Which word the cursor is in, for highlighting the display line. */
  const currentWord = createMemo(() => tokenWords()[projection().tokenIndex] ?? displayWords().length)
  /** What is still to be typed: the rest of this mora, then everything after it. */
  const remaining = createMemo(() => projection().hint + projection().rest)
  const isComplete = createMemo(() => session().finishedAt !== null)
  const metrics = createMemo(() => computeMetrics(session(), tick()))
  const accuracy = () => metrics().accuracy
  const speed = () => metrics().wpm

  const topConfusions = createMemo(() =>
    Object.entries(confusionMap())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  )
  const totalMinutes = createMemo(() => Math.round(lifetimeStats().totalElapsedMs / 60_000))
  const totalSessions = createMemo(() => lifetimeStats().totalSessions)
  const dayStats = createMemo(() => dailyCounts(runs()))
  const resultRun = createMemo(() => lastRun() ?? runs()[0] ?? null)
  const stillWeak = createMemo(() => {
    const run = resultRun()
    return run === null ? [] : weakAfterRun(run, kanaStats(), 5)
  })
  const keyStats = createMemo(() => mergeTimingStats(runs(), 'keyStats'))
  const bigramStats = createMemo(() => mergeTimingStats(runs(), 'bigramStats'))
  const slowBigrams = createMemo(() => topTimingStats(bigramStats(), 8))
  const kanaStats = createMemo(() => mergeMoraStats(runs()))
  const weakestMoras = createMemo(() => weakestKana(kanaStats(), 8))
  const coverage = createMemo(() => chartCoverage(kanaStats()))
  const weakMoras = createMemo(() => weakMoraCount(kanaStats()))
  const recentAcc = createMemo(() => recentAccuracy(runs(), 10))
  /* Six rows of ten, each labelled with the day it begins. */
  const calendarWeeks = createMemo(() => {
    const days = recentDayKeys(60)
    const rows: { label: string; days: string[] }[] = []
    for (let i = 0; i < days.length; i += 10) {
      const chunk = days.slice(i, i + 10)
      const date = new Date(`${chunk[0]}T00:00:00Z`)
      rows.push({
        label: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        days: chunk,
      })
    }
    return rows
  })

  const slowMoras = createMemo(() => slowestMoras(kanaStats(), 8))
  const cohorts = createMemo(() => runCohorts(runs()))
  const [pickedCohort, setCohort] = createSignal<string | null>(null)
  /* The latest run's cohort until the reader picks another, and back to it if the
     picked one disappears — a reset, or an import. */
  const cohort = createMemo(() => {
    const picked = pickedCohort()
    if (picked !== null && cohorts().some((c) => c.key === picked)) return picked
    return defaultCohort(runs())
  })
  const progress = createMemo(() => {
    const key = cohort()
    return key === null ? [] : progressPoints(runs(), key, 24)
  })
  /*
   * Drill targets are the weakest moras *plus* the least-practised ones. Weakness
   * alone can't drive practice: a mora is only found weak once you have met it
   * and failed it, so a pool made only of known weaknesses stops showing you
   * anything else and new ones never surface.
   */
  const weakKana = createMemo(() => [
    ...weakestMoras().map(([kana]) => kana),
    ...leastPractisedKana(kanaStats(), drillMoras, 4),
  ])
  const streaks = createMemo(() => streakStats(lifetimeStats().streakDays))

  /**
   * Every write goes through here so a failure is visible. `writeJson` already
   * reported one and every call site dropped it, which made a full quota or a
   * private-browsing block look exactly like a successful save — right up until
   * the next reload, when the run history turned out not to be there.
   */
  const persist = <T,>(key: string, value: T): void => {
    if (!writeJson(key, value)) setSaveFailed(true)
  }

  /**
   * Records go to the database, and the write is not awaited — a keystroke must
   * never wait on one. Failures surface through the same banner.
   */
  const persistRecord = (name: RecordName, value: unknown): void => {
    void recordStore.write(name, value).catch(() => setSaveFailed(true))
  }

  /**
   * One run, appended. Never the whole history: rewriting it on every save is
   * what the separate run store exists to avoid, and the cost of that rewrite
   * grew with the history rather than with what actually changed.
   */
  /** Puts a loaded profile into the signals. Shared by boot, import and reset. */
  const adoptProfile = (profile: StoredProfile) => {
    setRuns(profile.runs)
    setLifetimeStats(profile.lifetime)
    setMissMap(profile.misses)
    setConfusionMap(profile.confusions)
    setLibrary(profile.library)
    setLastRun(profile.runs[0] ?? null)
  }

  const exportData = async () => {
    try {
      downloadText(backupFilename(), await exportBackup(recordStore))
      setDataMessage('Exported.')
    } catch {
      setDataMessage("Couldn't read your data to export it.")
    }
  }

  const IMPORT_ERRORS: Record<string, string> = {
    unreadable: "That file isn't readable JSON.",
    'not-a-backup': "That doesn't look like a Kana Type export.",
    'unsupported-version':
      'That export came from a newer version. Update first — reading it now could damage your profile.',
  }

  const importData = async (file: File) => {
    /* Before the awaits, not after. A timed run's deadline firing during the
       import would append the run being abandoned into the store the import is
       midway through replacing. */
    resetRunState()
    const result = await importBackup(recordStore, await file.text())
    if (!result.ok) {
      setDataMessage(IMPORT_ERRORS[result.reason])
      return
    }
    adoptProfile(result.profile as StoredProfile)
    const preferences = result.preferences as Preferences
    setSettings(preferences.settings)
    setShowKeyboard(preferences.showKeyboard)
    setKeyboardLayout(preferences.keyboardLayout)
    setKanaGroup(preferences.kanaGroup)
    setSource(preferences.source)
    setLesson(nextLesson(preferences.source, preferences.settings))
    resetRunState()
    setDataMessage(`Imported ${result.profile?.runs.length ?? 0} runs.`)
  }

  const resetData = async () => {
    if (!resetArmed()) {
      setResetArmed(true)
      setDataMessage('This erases every run, your library and your settings.')
      return
    }
    setResetArmed(false)
    // Same race as import: stop the run before erasing what it would be saved into.
    resetRunState()
    adoptProfile(await resetProfile(recordStore))
    setSettings(readSettings())
    setShowKeyboard(readShowKeyboard())
    setKeyboardLayout(readKeyboardLayout())
    setKanaGroup(readKanaGroup())
    setSource(readSource())
    setLesson(nextLesson(readSource()))
    resetRunState()
    setDataMessage('Erased.')
  }

  const navigate = (next: RouteName) => {
    window.location.hash = next === 'practice' ? '#/practice' : `#/${next}`
    setRoute(next)
  }

  const cancelCompletion = () => {
    if (completionTimer !== null) {
      clearTimeout(completionTimer)
      completionTimer = null
    }
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer)
      deadlineTimer = null
    }
  }

  const timedRun = () => settings().timedMode
  const timeLeft = createMemo(() =>
    timedRun() ? remainingMs(session(), tick(), STANDARD_TIMED_MS) : null,
  )

  /*
   * Ends a timed run at its deadline — not at the moment the callback happened
   * to fire. A timer that runs 400 ms late would otherwise record a 60.4-second
   * run, and every timed run would be a slightly different length.
   */
  const endTimedRun = () => {
    cancelCompletion()
    const current = session()
    if (current.startedAt === null || current.finishedAt !== null) return
    const finished = finishRun(current, current.startedAt + STANDARD_TIMED_MS)
    setSession(finished)
    saveCurrentRun(finished, lesson())
    /*
     * The result screen only if the typist is still here to see it. A deadline
     * can land while they are reading their statistics, and pulling them out of
     * that page into a result they did not ask for is the same rudeness the
     * completion timer already avoids after a restart. The run is saved either
     * way; when they come back, practice is fresh rather than a finished run
     * they cannot type into.
     */
    if (route() === 'practice') {
      navigate('result')
      return
    }
    resetRunState()
    setLesson(nextLesson(source()))
  }

  /** Arms the one-shot deadline once the typist has actually started. */
  const armDeadline = (state: SessionState) => {
    if (!timedRun() || state.startedAt === null || deadlineTimer !== null) return
    const left = Math.max(0, state.startedAt + STANDARD_TIMED_MS - Date.now())
    deadlineTimer = window.setTimeout(() => {
      deadlineTimer = null
      endTimedRun()
    }, left)
  }

  const resetRunState = () => {
    cancelCompletion()
    savedCurrentRun = false
    setSession(emptySession())
  }

  /*
   * The material a run is committed to. Held in a plain variable rather than a
   * signal: nothing renders from it, and a timed run must keep dealing from the
   * *same* resolved source and the same deck however many passages it gets
   * through.
   */
  let plan: RunPlan | null = null

  const nextLesson = (nextSource: SourceName, nextSettings: Settings = settings()) => {
    plan = planRun(nextSource, weakKana(), library(), Math.random, kanaGroup())
    const dealt = dealLesson(plan, nextSettings, Math.random)
    plan = dealt.plan
    return dealt.lesson
  }

  /**
   * A new run on the text already on screen.
   *
   * The plan has to be rebuilt even though the passage does not change: left
   * alone, a retried timed run would deal its *second* passage from the previous
   * run's part-spent deck, and lose the promise that a run covers its bank
   * before repeating.
   */
  const retrySameText = () => {
    plan = planRun(source(), weakKana(), library(), Math.random, kanaGroup())
    resetRunState()
    navigate('practice')
  }

  /** The next passage of the *same* run — same source, same deck. */
  const refill = () => {
    if (plan === null) return
    const dealt = dealLesson(plan, settings(), Math.random)
    plan = dealt.plan
    setLesson(dealt.lesson)
  }

  const setTimedMode = (timedMode: boolean) => {
    const next = { ...settings(), timedMode }
    persist(SETTINGS_KEY, next)
    setSettings(next)
    // The run in progress was measured the other way; start a clean one.
    freshText()
  }

  const setConfidenceMode = (confidenceMode: boolean) => {
    const next = { ...settings(), confidenceMode }
    persist(SETTINGS_KEY, next)
    setSettings(next)
  }

  const setWhitespaceMarkers = (whitespaceMarkers: boolean) => {
    const next = { ...settings(), whitespaceMarkers }
    persist(SETTINGS_KEY, next)
    setSettings(next)
  }

  const setStopOnError = (stopOnError: boolean) => {
    const next = { ...settings(), stopOnError }
    setSettings(next)
    persist(SETTINGS_KEY, next)
    resetRunState()
  }

  const changeKanaGroup = (group: KanaGroup) => {
    persist(KANA_GROUP_KEY, group)
    setKanaGroup(group)
    if (source() === 'kana') {
      setLesson(nextLesson('kana'))
      resetRunState()
    }
  }

  const freshText = () => {
    setLesson(nextLesson(source()))
    resetRunState()
    navigate('practice')
  }

  const changeSource = (nextSource: SourceName) => {
    persist(SOURCE_KEY, nextSource)
    setSource(nextSource)
    setLesson(nextLesson(nextSource))
    resetRunState()
  }

  /*
   * Takes the finished session and its lesson rather than reading the signals.
   *
   * It used to re-read them from inside a deferred callback, so anything that
   * reset the run in that window — a restart keypress landing between the last
   * keystroke and the timer, which fast typing reaches — had the completed run
   * recorded against whatever state had replaced it.
   */
  const saveCurrentRun = (finished: SessionState, forLesson: Lesson) => {
    if (savedCurrentRun) return null
    savedCurrentRun = true
    const currentSession = finished
    const currentLesson = forLesson
    const currentMetrics = computeMetrics(currentSession, Date.now())
    const run = buildRunResult(
      currentSession,
      currentLesson,
      currentMetrics,
      undefined,
      settings().timedMode
        ? { kind: 'timed', durationMs: STANDARD_TIMED_MS }
        : { kind: 'passage' },
    )
    setLastRun(run)
    const previousLifetime = lifetimeStats()
    const nextLifetime = recordRunInLifetimeStats(previousLifetime, run)
    setResultUnlocks(newlyReachedMilestones(previousLifetime, nextLifetime))
    setLifetimeStats(nextLifetime)
    /*
     * One transaction for both. Written separately, a crash or a closed tab
     * between them left the profile disagreeing with itself — a run no total
     * counted, or totals claiming a run whose record was never written — and
     * nothing afterwards records which of the two was the truth.
     *
     * No cap on history. The 100-run limit existed to fit localStorage, and
     * truncating is what used to make personal bests and streaks regress.
     */
    void recordStore.commitRun(run, nextLifetime).catch(() => setSaveFailed(true))
    setRuns((current) => [run, ...current])
    return run
  }

  const typeChar = (rawChar: string) => {
    if (isComplete() || route() !== 'practice') return
    /*
     * Checked before the keystroke, not only by the timer. A throttled or
     * backgrounded tab can fire a timeout seconds late, and without this the
     * typist keeps scoring into a run that was already over.
     */
    /* One clock read for the whole keystroke. Reading `Date.now()` again below
       let a key pass the expiry check and then be scored a moment after the
       deadline, which also stamped the run with that key's time instead of the
       deadline. */
    const now = Date.now()
    if (timedRun() && remainingMs(session(), now, STANDARD_TIMED_MS) === 0) {
      endTimedRun()
      return
    }
    const result = applyTypeChar(session(), rawChar, tokens(), now, settings().stopOnError)
    setSession(result.session)
    armDeadline(result.session)
    if (result.missed) {
      const { legal, typed } = result.missed
      const label = (char: string) => (char === ' ' ? 'space' : char)
      // Only a single legal continuation names one key to blame. After `s` on
      // し both `h` and `i` were legal, and charging either would invent a miss
      // on a key the typist never got wrong.
      if (legal.length === 1) {
        setMissMap((current) => {
          const key = label(legal[0])
          const next = { ...current, [key]: (current[key] ?? 0) + 1 }
          persistRecord('misses', next)
          return next
        })
      }
      setConfusionMap((current) => {
        const pair = `${legal.map(label).join('/')} → ${label(typed)}`
        const next = { ...current, [pair]: (current[pair] ?? 0) + 1 }
        persistRecord('confusions', next)
        return next
      })
    }
    if (result.completed && timedRun() && remainingMs(result.session, now, STANDARD_TIMED_MS) !== 0) {
      /*
       * The passage ran out before the clock did, which in a timed run is not
       * the end of anything — the matcher and the line reset, the counters and
       * the stat tables do not, and the same run keeps going on a fresh passage.
       */
      setSession(rollToNextPrompt(result.session))
      refill()
      return
    }
    if (result.completed) {
      /*
       * Recorded now, navigated to next.
       *
       * Both used to happen in a deferred callback that re-read the session and
       * lesson signals, so a restart keypress landing in that window — which
       * fast typing reaches, since Tab and Enter both reset — had the finished
       * run written against the empty session that had replaced it: a phantom
       * run in the history, and in the lifetime totals and streaks built from
       * it. Saving here means a completed run is a completed run whatever
       * happens next; only the navigation is deferred, and it is cancelled on a
       * reset rather than yanking the typist to a result screen for a run they
       * have already moved on from.
       */
      saveCurrentRun(result.session, lesson())
      completionTimer = window.setTimeout(() => {
        completionTimer = null
        navigate('result')
      }, 0)
    }
  }

  onCleanup(cancelCompletion)

  const backspace = () => {
    setSession((current) => applyBackspace(current, tokens()))
  }

  const setKeyboardVisible = (visible: boolean) => {
    persist(SHOW_KEYBOARD_KEY, visible)
    setShowKeyboard(visible)
  }

  const changeKeyboardLayout = (layout: KeyboardLayoutName) => {
    persist(KEYBOARD_LAYOUT_KEY, layout)
    setKeyboardLayout(layout)
  }

  const updateParagraphLength = (length: number) => {
    const next = { ...settings(), paragraphItems: Math.max(3, Math.min(30, length)) }
    setSettings(next)
    persist(SETTINGS_KEY, next)
    setLesson(nextLesson(source(), next))
    resetRunState()
  }

  const REJECT_REASONS: Record<LibraryReject['reason'], string> = {
    'no-reading': 'needs a reading, as kanji|romaji',
    'word-mismatch': 'the kana and romaji disagree about where the words break',
    unsupported: 'contains a character this app cannot type',
    'too-long': 'is longer than one practice line can hold',
  }

  const addCustomText = (text: string) => {
    const { items, rejected } = parseLibrary(text)
    if (items.length === 0) {
      /*
       * Say why. A paste that produced nothing used to return in silence, so
       * the button looked broken — and pasting plain Japanese, which is the
       * obvious thing to try, is exactly what produced nothing.
       */
      setLibraryMessage(
        rejected.length === 0
          ? 'Nothing to add — the box is empty.'
          : `Could not read ${rejected.length === 1 ? 'that line' : `any of those ${rejected.length} lines`}: ${
              REJECT_REASONS[rejected[0].reason]
            }.`,
      )
      return
    }
    setLibrary((current) => {
      const next = [...items, ...current].slice(0, 200)
      persistRecord('library', next)
      return next
    })
    setCustomText('')
    setLibraryMessage(
      rejected.length === 0
        ? null
        : `Added ${items.length}, skipped ${rejected.length}: ${REJECT_REASONS[rejected[0].reason]}.`,
    )
    changeSource('library')
    navigate('practice')
  }

  const handleFile = async (file: File) => {
    addCustomText(await file.text())
  }

  const refocus = () => {
    if (route() === 'practice') hiddenInput?.focus({ preventScroll: true })
  }

  /**
   * Loads the stored profile, carrying an older localStorage one across on the
   * first run. A failure is not fatal: the app opens on an empty profile and
   * says so, which beats refusing to start because history couldn't be read.
   */
  onMount(async () => {
    try {
      await migrateLocalStorage(recordStore)
      adoptProfile(await loadProfile(recordStore))
      setLesson(nextLesson(source()))
    } catch {
      setSaveFailed(true)
    }
    if (!durableStore) setSaveFailed(true)
    setReady(true)
    refocus()
  })

  onMount(() => {
    refocus()
    const interval = window.setInterval(() => setTick(Date.now()), 500)
    const hashchange = () => setRoute(routeFromHash())

    /*
     * Coming back from a hidden tab, the gap since the last keystroke is not
     * typing — it is however long the tab was away, clamped to the pause cap and
     * then charged to whichever mora happened to be next. Clearing `lastKeyAt`
     * makes that first keystroke deliberately untimed, the same treatment the
     * first key of a run and the key after a backspace already get.
     */
    const visibility = () => {
      if (document.visibilityState !== 'visible') return
      setSession((current) => (current.lastKeyAt === null ? current : { ...current, lastKeyAt: null }))
    }

    const keydown = (event: KeyboardEvent) => {
      // Light the cap before any early return, so modifiers (which set their own
      // ctrl/meta/alt flag on their own keydown) still show as held on the
      // on-screen keyboard. Purely visual — nothing below this line is skipped.
      if (!event.repeat) setPressedKeys((current) => new Set(current).add(event.code))

      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.isComposing || event.keyCode === 229 || event.repeat) return

      /*
       * Not when a control has focus. This is a window-level shortcut, so it
       * used to fire before the focused button could act on its own Enter —
       * a keyboard user aiming at "view stats" or "retry same text" got the
       * next practice instead, with no way to reach either.
       */
      if (route() === 'result' && event.key === 'Enter') {
        const el = event.target as HTMLElement | null
        const interactive = el?.closest('button, a, input, select, textarea, [tabindex]')
        if (interactive !== null && interactive !== undefined) return
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
        // Swallowed either way: the browser would navigate back otherwise.
        event.preventDefault()
        if (!settings().confidenceMode) backspace()
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
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clearPressedKeys)

    onCleanup(() => {
      window.clearInterval(interval)
      window.removeEventListener('hashchange', hashchange)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clearPressedKeys)
    })
  })

  // Nothing is drawn until the stored profile has loaded. The alternative —
  // render an empty profile and swap the lesson out a moment later — puts a
  // different passage under the typist's fingers after they have started.
  return (
    <Show when={ready()} fallback={<main class="app app--loading">loading…</main>}>
      {/* The statistics page is a dashboard and wants the window; every other
          page is reading content and is better off in a narrow column. */}
      <main classList={{ app: true, 'app--wide': route() === 'stats' }} onClick={refocus}>
        <Topbar
          secondsLeft={timeLeft() === null ? null : Math.ceil(timeLeft()! / 1000)}
          wpm={speed()}
          accuracy={accuracy()}
          mistakes={session().mistakes}
          showLive={route() === 'practice'}
          onHomeClick={() => navigate('practice')}
        />

        {/* Storage can refuse a write — a full quota, or private browsing. Saying
            so beats letting the session look saved until the next reload proves
            otherwise. Stays up once raised: the runs already lost don't come back
            just because a later, smaller write succeeded. */}
        <Show when={saveFailed()}>
          <p class="alert" role="status" aria-live="polite">
            Couldn't save to this browser's storage — your progress this session
            won't be here after a reload. Private browsing or a full storage quota
            are the usual causes.
          </p>
        </Show>

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
              {/* Kanji is shown with its reading above it and typed as that
                  reading — display and keystrokes are separate concerns. Words
                  with nothing to gloss render as plain text. */}
              <p class="kana-line">
                <For each={displayWords()}>
                  {(word, index) => (
                    <span
                      classList={{
                        'kana-token': true,
                        'kana-token--done': index() < currentWord(),
                        'kana-token--current': index() === currentWord(),
                      }}
                    >
                      <For each={word.segments}>
                        {(segment) => (
                          <Show when={segment.ruby} fallback={segment.text}>
                            {(ruby) => (
                              <ruby>
                                {segment.text}
                                <rt>{ruby()}</rt>
                              </ruby>
                            )}
                          </Show>
                        )}
                      </For>
                    </span>
                  )}
                </For>
              </p>
              {/* Everything already pressed, then what's left to press. Wrong keys
                  stand in the line in red exactly where they were typed — the
                  matcher consumed an edge for each, so the two halves always meet
                  at the cursor. */}
              <p class="romaji-line">
                <For each={session().keys}>
                  {(key) => (
                    <span
                      classList={{
                        char: true,
                        'char--correct': key.correct,
                        'char--incorrect': !key.correct,
                        'char--space': settings().whitespaceMarkers && key.char === ' ',
                      }}
                    >
                      {key.char}
                    </span>
                  )}
                </For>
                <For each={remaining().split('')}>
                  {(char, index) => (
                    <span
                      classList={{
                        char: true,
                        'char--current': index() === 0,
                        // Stop-on-error consumes nothing, so there is no wrong
                        // character to colour. The signal goes on the one still
                        // being waited for.
                        'char--rejected': index() === 0 && session().rejected !== null,
                        'char--space': settings().whitespaceMarkers && char === ' ',
                      }}
                    >
                      {char}
                    </span>
                  )}
                </For>
              </p>
            </section>

            <Show when={showKeyboard()}>
              <OnScreenKeyboard layout={keyboardLayout()} pressed={pressedKeys} />
            </Show>

            {/* Source picker sits directly under the keyboard, keyboard
                shortcuts below it — the order type.review uses. */}
            <div class="practice-hints">
              <div class="practice-hints__row">
                <span class="hint-label">source</span>
                <For each={sourceOptions}>
                  {(option) => (
                    <button
                      type="button"
                      class="source-button"
                      title={option.label}
                      classList={{ active: source() === option.value }}
                      onClick={(event) => {
                        event.stopPropagation()
                        changeSource(option.value)
                      }}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
                <span class="source-current">picked: {lesson().source}</span>
              </div>

              {/* Which part of the chart to drill. Only meaningful while the kana
                  source is selected, so it stays out of the way otherwise. */}
              <Show when={source() === 'kana'}>
                <div class="practice-hints__row">
                  <span class="hint-label">五十音</span>
                  <For each={KANA_GROUPS}>
                    {(group) => (
                      <button
                        type="button"
                        class="source-button"
                        classList={{ active: kanaGroup() === group }}
                        title={KANA_GROUP_LABELS[group]}
                        onClick={(event) => {
                          event.stopPropagation()
                          changeKanaGroup(group)
                        }}
                      >
                        {KANA_GROUP_LABELS[group]}
                      </button>
                    )}
                  </For>
                  <span class="source-current">{kanaRows(kanaGroup()).length} rows</span>
                </div>
              </Show>
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
            </div>
          </section>
        </Show>

        <Show when={route() === 'result'}>
          <section class="page page--narrow result-page">
            {/* No "result" heading: the numbers say what this is, and a title
                above them just delays them. The scores lead. */}
            <Show when={resultRun()} fallback={<p class="muted">No completed run yet.</p>}>
              {(run) => (
                <>
                  <div class="result-hero">
                    <div>
                      <b>{runWpm(run())}</b>
                      <span>wpm</span>
                    </div>
                    <div>
                      <b>{run().accuracy}%</b>
                      <span>accuracy</span>
                    </div>
                  </div>

                  {/* Secondary, and it has to read that way: same treatment,
                      markedly smaller, so the two numbers above stay the point. */}
                  <div class="result-grid">
                    <div>
                      <b>{runRawWpm(run())}</b>
                      <span>raw</span>
                    </div>
                    <div>
                      {/* Not `?? 100`. A run written before consistency was
                          recorded has no value, and showing a perfect score for
                          missing data is worse than showing nothing. */}
                      <b>{run().consistency === undefined ? '—' : `${run().consistency}%`}</b>
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
                    <span>{run().source}</span>
                    <span>{run().chars} characters</span>
                    <span>{new Date(run().date).toLocaleString()}</span>
                  </div>

                  {/* The mastery model otherwise lives only on the Statistics
                      page, which you have to go looking for. This is the screen
                      you are already on when you stop, so it is where knowing
                      what to fix actually closes the loop. */}
                  <Show when={stillWeak().length > 0}>
                    <section class="result-section still-weak">
                      <h2>still weak</h2>
                      <div class="still-weak__list">
                        <For each={stillWeak()}>
                          {(item) => (
                            <span
                              class="still-weak__chip"
                              classList={{ 'still-weak__chip--recurring': item.recurring }}
                              title={
                                item.recurring
                                  ? `${item.kana}: ${item.missed} of ${item.attempts} missed this run — and missed before`
                                  : `${item.kana}: ${item.missed} of ${item.attempts} missed this run`
                              }
                            >
                              <b>{item.kana}</b>
                              <small>
                                {item.missed}/{item.attempts}
                              </small>
                            </span>
                          )}
                        </For>
                      </div>
                      <p class="muted">
                        Ordered by how weak each is overall — the same order drills pull in.
                        <Show when={stillWeak().some((item) => item.recurring)}>
                          {' '}Underlined ones you have missed before.
                        </Show>
                      </p>
                    </section>
                  </Show>

                  {/* Newly reached ones are the celebration; the next one is
                      what makes this a surface rather than a flash, since a run
                      that crosses no threshold used to show nothing at all. */}
                  <Show when={resultUnlocks().length > 0 || nextTarget() !== null}>
                    <section class="result-section" role="status" aria-live="polite">
                      <h2>{resultUnlocks().length > 0 ? 'milestone reached' : 'next milestone'}</h2>
                      <div class="achievement__list">
                        <For each={resultUnlocks()}>
                          {(item) => <span class="achievement__chip">{item.label}</span>}
                        </For>
                        <Show when={nextTarget()}>
                          {(item) => (
                            <span class="achievement__chip achievement__chip--next">
                              {item().label}
                            </span>
                          )}
                        </Show>
                      </div>
                    </section>
                  </Show>

                  <div class="action-row">
                    <button type="button" class="primary" onClick={freshText}>
                      next practice
                    </button>
                    <button type="button" class="secondary" onClick={retrySameText}>
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
              <div>
                <h1>your statistics</h1>
                <p class="muted">
                  {totalSessions()} sessions · {totalMinutes()} min typing
                </p>
              </div>
            </div>

            <div class="stat-grid">
              {/* Learner metrics, not leaderboard metrics. `avg wpm` averaged
                  every stored run while `best wpm` was progression-gated, so the
                  two disagreed about which runs counted; and `current acc` read
                  the *live typing session*, which on this route is empty and so
                  reported 100% whatever the history said. Speed now lives in the
                  progress section, where a trend can give it context. */}
              <div>
                <b>{coverage().met}</b>
                <span>moras seen · of {coverage().total}</span>
              </div>
              <div>
                <b>{weakMoras()}</b>
                <span>weak moras</span>
              </div>
              <div>
                <b>{recentAcc()}%</b>
                <span>accuracy · last 10 runs</span>
              </div>
              <div>
                <b>{streaks().current}</b>
                <span>day streak</span>
              </div>
            </div>

            <div class="stats-group stats-group--wide">
              <h2 class="stats-group__label">kana learning</h2>
              <div class="stats-grid">
              <section class="panel panel--span-12 panel--map">
                <h3>kana typing mastery</h3>
                {/* Not "accuracy": the colour is weakness weighted by how much
                    evidence stands behind it, which is why one miss in a hundred
                    barely shows. The plain rate is in each cell's own detail.
                    And nothing here may promise hovering — on a touch screen
                    there is no hover to offer. */}
                <p class="muted">
                  Red is weakness, weighted by how often you've met the mora.
                </p>
                <MasteryMap stats={kanaStats()} />
                <div class="mastery-legend">
                  <span>
                    <i class="is-unseen" />
                    not yet seen
                  </span>
                  <span>
                    <i class="is-clean" />
                    seen, never missed
                  </span>
                  <span>
                    <i class="is-weak" />
                    missed — deeper is weaker
                  </span>
                  <Show when={weakestMoras().length > 0}>
                    <span>
                      weakest: <b>{weakestMoras().slice(0, 5).map(([kana]) => kana).join(' ')}</b>
                    </span>
                  </Show>
                  {/* The chart's colour says what you get *wrong*; this says what
                      you have to *think about*. Each cell already carries its own
                      excess in its detail — this is the ranking, which a grid
                      cannot show. */}
                  <Show when={slowMoras().length > 0}>
                    <span>
                      slowest: <b>{slowMoras().slice(0, 5).map(([kana]) => kana).join(' ')}</b>
                    </span>
                  </Show>
                </div>
              </section>
              </div>
            </div>

            <div class="stats-group">
              <h2 class="stats-group__label">recent progress</h2>
              <div class="stats-grid">
                <section class="panel panel--span-12">
                  <h3>speed and accuracy</h3>
                  <ProgressChart
                    points={progress()}
                    cohorts={cohorts()}
                    cohort={cohort()}
                    onCohort={setCohort}
                  />
                </section>
              <section class="panel panel--span-6">
                <h3>romaji key errors</h3>
                <p class="muted">
                  Romaji keys, not kana — one key types many moras, so this cannot say which
                  mora is at fault. The chart above can.
                </p>
                <div class="mini-keyboard">
                  <For each={['qwertyuiop', 'asdfghjkl', 'zxcvbnm']}>
                    {(row) => (
                      <div class="mini-keyboard-row">
                        <For each={row.split('')}>
                          {(letter) => {
                            const count = () => missMap()[letter] ?? 0
                            const stat = () => keyStats().get(letter)
                            return (
                              <span
                                class="mini-key"
                                classList={{ 'mini-key--weak': (stat()?.misses ?? 0) > 0 }}
                                style={{
                                  /*
                                   * Accuracy alone, and in the error colour. This
                                   * used to blend latency in as
                                   * `avgMs / 600 + errorRate`, so one shade stood
                                   * for two different problems; then it faded the
                                   * accent, which elsewhere on this page means the
                                   * opposite — teal is "never missed" on the kana
                                   * chart. Speed keeps its own panel.
                                   */
                                  '--mk-heat': String(
                                    stat()?.misses ? smoothedErrorRate(stat()!) : 0,
                                  ),
                                }}
                                tabindex="0"
                                {...tipFor(
                                  () =>
                                    `${letter} · ${count()} misses, ${Math.round(
                                      (stat()?.errorRate ?? 0) * 100,
                                    )}% of ${stat()?.attempts ?? 0} · ${Math.round(
                                      stat()?.avgMs ?? 0,
                                    )} ms average`,
                                )}
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
              <section class="panel panel--span-6">
                <h3>last 60 days</h3>
                {/* Ten days a row, each row labelled with the day it starts.
                    The grid was unlabelled squares whose only date lived in a
                    `title`, so it said "you practised sometimes" and nothing a
                    reader could place in time. */}
                <div class="calendar">
                  <For each={calendarWeeks()}>
                    {(week) => (
                      <div class="calendar__row">
                        <span class="calendar__date">{week.label}</span>
                        <div class="calendar__days">
                          <For each={week.days}>
                            {(key) => {
                              const count = () => dayStats().get(key) ?? 0
                              const max = () => Math.max(1, ...dayStats().values())
                              return (
                                <span
                                  class="calendar-cell"
                                  classList={{ active: count() > 0 }}
                                  style={{
                                    '--day-heat': String(count() === 0 ? 0 : 0.35 + 0.65 * (count() / max())),
                                  }}
                                  tabindex="0"
                                  {...tipFor(
                                    () =>
                                      `${new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
                                        day: 'numeric',
                                        month: 'short',
                                        timeZone: 'UTC',
                                      })} · ${count()} ${count() === 1 ? 'run' : 'runs'}`,
                                  )}
                                >
                                  <span class="sr-only">{`${key}: ${count()} runs`}</span>
                                </span>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
                <p class="muted">
                  Longest streak <b>{streaks().longest}</b> days.
                </p>
              </section>

              {/* The whole ladder, which the result screen cannot show: it names
                  what you just crossed and what is next, and nothing else. Seeing
                  the reached ones is the point — progress you can look back at
                  rather than a notification you either caught or missed. */}
              <section class="panel panel--span-12">
                <h3>milestones</h3>
                <div class="achievement__list">
                  <For each={milestones()}>
                    {(item) => (
                      <span
                        class="achievement__chip"
                        classList={{ 'achievement__chip--next': !item.reached }}
                        aria-label={`${item.label} — ${item.reached ? 'reached' : 'not yet reached'}`}
                      >
                        {item.label}
                        <Show when={item.reached}>
                          <small aria-hidden="true">✔</small>
                        </Show>
                      </span>
                    )}
                  </For>
                </div>
                <p class="muted">
                  <b>{milestones().filter((item) => item.reached).length}</b> of{' '}
                  {milestones().length} reached.
                </p>
              </section>

              </div>
            </div>

            <div class="stats-group">
              <h2 class="stats-group__label">typing mechanics</h2>
              <div class="stats-grid">
              <section class="panel panel--span-6">
                <h3>most confused</h3>
                <div class="bar-list">
                  <For each={topConfusions()} fallback={<p class="muted">No confused pairs yet.</p>}>
                    {([pair, count]) => (
                      <div class="bar-row">
                        <span>{pair}</span>
                        <meter class="meter--error" min="0" max={Math.max(1, topConfusions()[0]?.[1] ?? 1)} value={count} />
                        <b>{count}</b>
                      </div>
                    )}
                  </For>
                </div>
              </section>
              <section class="panel panel--span-6">
                <h3>slowest pairs</h3>
                <div class="bar-list">
                  <For each={slowBigrams()} fallback={<p class="muted">No pair timing yet.</p>}>
                    {([pair, stat]) => (
                      <div class="bar-row">
                        <span>{pair.replaceAll(' ', '␣')}</span>
                        <meter class="meter--neutral" min="0" max={Math.max(1, slowBigrams()[0]?.[1].avgMs ?? 1)} value={stat.avgMs} />
                        <b>{Math.round(stat.avgMs)} ms</b>
                      </div>
                    )}
                  </For>
                </div>
              </section>
              </div>
            </div>
          </section>
        </Show>

        <Show when={route() === 'library'}>
          <section class="page">
            <h1>library</h1>
            <p class="muted">
              Paste Japanese, one line or sentence at a time. Kana is enough — the
              romaji is worked out for you. Kanji needs its reading, as{' '}
              <code>学校|gakkou</code>.
            </p>
            <Show when={libraryMessage()}>
              {(message) => (
                <p class="notice" role="status" aria-live="polite">
                  {message()}
                </p>
              )}
            </Show>
            <textarea
              value={customText()}
              onInput={(event) => setCustomText(event.currentTarget.value)}
              placeholder={'おはよう\nきょうはいいてんきです\n学校|gakkou'}
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
                checked={settings().stopOnError}
                onChange={(event) => setStopOnError(event.currentTarget.checked)}
              />
              <span>stop on error — refuse a wrong key instead of typing it</span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().timedMode}
                onChange={(event) => setTimedMode(event.currentTarget.checked)}
              />
              <span>timed mode — run for 60 seconds instead of to the end of the passage</span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().confidenceMode}
                onChange={(event) => setConfidenceMode(event.currentTarget.checked)}
              />
              <span>confidence mode — no backspace, every keystroke commits</span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().whitespaceMarkers}
                onChange={(event) => setWhitespaceMarkers(event.currentTarget.checked)}
              />
              <span>mark the spaces between words</span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={showKeyboard()}
                onChange={(event) => setKeyboardVisible(event.currentTarget.checked)}
              />
              <span>show on-screen keyboard</span>
            </label>
            <div class="field">
              <span>theme</span>
              <div class="pill-row">
                <For each={THEME_NAMES}>
                  {(name) => (
                    <button
                      type="button"
                      class="pill"
                      classList={{ active: theme() === name }}
                      aria-pressed={theme() === name}
                      onClick={() => setTheme(name)}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="field">
              <span>keyboard layout</span>
              <div class="pill-row">
                <For each={KEYBOARD_LAYOUT_NAMES}>
                  {(layout) => (
                    <button
                      type="button"
                      class="pill"
                      classList={{ active: keyboardLayout() === layout }}
                      aria-pressed={keyboardLayout() === layout}
                      onClick={() => changeKeyboardLayout(layout)}
                    >
                      {layout}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <h2>your data</h2>
            <p class="muted">
              Everything is stored in this browser and never leaves it. Export to
              keep a copy or move to another machine.
            </p>
            <div class="action-row">
              <button type="button" class="secondary" onClick={() => void exportData()}>
                export
              </button>
              <label class="file-button secondary">
                import
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) void importData(file)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              {/* Two-step rather than a confirm dialog: destructive, and a
                  mis-click on a single button would take the whole history. */}
              <button
                type="button"
                classList={{ secondary: !resetArmed(), primary: resetArmed() }}
                onClick={() => void resetData()}
              >
                {resetArmed() ? 'really erase everything?' : 'reset'}
              </button>
            </div>
            <Show when={dataMessage()}>
              {(message) => (
                <p class="muted" role="status" aria-live="polite">
                  {message()}
                </p>
              )}
            </Show>
          </section>
        </Show>

        <BottomNav active={route()} onNavigate={navigate} />
        <TooltipLayer />
      </main>
    </Show>
  )
}

export default App
