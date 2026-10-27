import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import "./App.css";
import {
  drillMoras,
  dealLesson,
  generateLesson,
  planRun,
  type RunPlan,
  kanaRows,
  type LibraryReject,
  sourceOptions,
  bundledTexts,
  lessonForText,
  libraryTexts,
} from "./engine/lessons";
import {
  mayHideParticle,
  reviewItem,
  reviewPaste,
  reviewReject,
  reviewRomaji,
  withReading,
  type TextReview,
} from "./engine/review";
import { compilePrompt, wordIndexForToken } from "./engine/prompt";
import { projectMatch } from "./engine/romanization";
import {
  applyBackspace,
  applyTypeChar,
  buildRunResult,
  computeMetrics,
  emptySession,
  finishRun,
  remainingMs,
  rollToNextPrompt,
} from "./engine/session";
import type { SessionState } from "./engine/session";
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
} from "./engine/stats";
import {
  KANA_GROUPS,
  KANA_SCRIPT_CHOICES,
  SOURCE_LABELS,
  STANDARD_TIMED_MS,
  THEME_NAMES,
} from "./engine/types";
import { Furigana } from "./ui/Furigana";
import type {
  KanaGroup,
  KanaScriptChoice,
  ThemeName,
  Lesson,
  LifetimeStats,
  PracticeText,
  RunResult,
  Settings,
  SourceName,
  TextItem,
  Unlock,
} from "./engine/types";
import {
  backupFilename,
  downloadText,
  exportBackup,
  importBackup,
  resetProfile,
} from "./io/backup";
import {
  KANA_GROUP_KEY,
  KANA_SCRIPT_KEY,
  THEME_KEY,
  SETTINGS_KEY,
  SHOW_KEYBOARD_KEY,
  SOURCE_KEY,
  emptyProfile,
  loadProfile,
  migrateLocalStorage,
  readKanaGroup,
  readKanaScript,
  readTheme,
  readSettings,
  readShowKeyboard,
  readSource,
  type Preferences,
  type StoredProfile,
} from "./io/persistence";
import { createRecordStore, type RecordName } from "./io/records";
import { writeJson } from "./io/storage";
import { chartCoverage } from "./engine/mastery";
import { MasteryMap } from "./ui/MasteryMap";
import { ProgressChart } from "./ui/ProgressChart";
import { TooltipLayer, tipFor } from "./ui/Tooltip";
import { OnScreenKeyboard } from "./ui/OnScreenKeyboard";
import { Topbar } from "./ui/Topbar";
import { routeFromHash, type RouteName } from "./ui/router";

/**
 * One store for the whole page. `durable` is false when the browser has no
 * IndexedDB at all — private browsing in some engines, or a locked-down embed —
 * in which case the session works but nothing survives a reload, and the app
 * says so rather than pretending it saved.
 */
const { store: recordStore, durable: durableStore } = createRecordStore();

/** Chart groups, labelled the way a learner would name them. */
const KANA_GROUP_LABELS: Record<KanaGroup, string> = {
  all: "all",
  seion: "seion",
  dakuten: "dakuten",
  yoon: "yōon",
};

/* The syllabary itself, rather than the word for it — あ and ア are the two
   things being chosen between, and a learner who cannot yet read "katakana"
   can read ア. */
const KANA_SCRIPT_LABELS: Record<KanaScriptChoice, string> = {
  hiragana: "あ hiragana",
  katakana: "ア katakana",
  both: "both",
};

function App() {
  const [route, setRoute] = createSignal<RouteName>(routeFromHash());
  const [settings, setSettings] = createSignal<Settings>(readSettings());
  // Records live in IndexedDB, which is asynchronous, so these start empty and
  // are filled by the bootstrap below. The placeholder lesson is never seen —
  // `ready` gates the render.
  const [ready, setReady] = createSignal(false);
  const [runs, setRuns] = createSignal<RunResult[]>([]);
  const [lifetimeStats, setLifetimeStats] = createSignal<LifetimeStats>(
    emptyProfile().lifetime,
  );
  const [confusionMap, setConfusionMap] = createSignal<Record<string, number>>(
    {},
  );
  const [library, setLibrary] = createSignal<TextItem[]>([]);
  const [source, setSource] = createSignal<SourceName>(readSource());
  const [lesson, setLesson] = createSignal<Lesson>(
    generateLesson("words", readSettings(), [], [], Math.random, "all"),
  );
  const [session, setSession] = createSignal<SessionState>(emptySession());
  const [tick, setTick] = createSignal(Date.now());
  const [pressedKeys, setPressedKeys] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const [showKeyboard, setShowKeyboard] = createSignal(readShowKeyboard());
  const [theme, setThemeSignal] = createSignal<ThemeName>(readTheme());

  /*
   * Writes the resolved palette onto the root element.
   *
   * `system` sets no attribute at all rather than resolving to a value: the
   * media query then answers, and the app follows the desktop switching between
   * light and dark without a reload. Only an explicit choice pins it.
   */
  createEffect(() => {
    const chosen = theme();
    const root = document.documentElement;
    if (chosen === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", chosen);
  });

  const setTheme = (next: ThemeName) => {
    persist(THEME_KEY, next);
    setThemeSignal(next);
  };
  const [kanaGroup, setKanaGroup] = createSignal<KanaGroup>(readKanaGroup());
  const [kanaScript, setKanaScript] =
    createSignal<KanaScriptChoice>(readKanaScript());
  const [customText, setCustomText] = createSignal("");
  /*
   * A paste held between arriving and being committed. Null means the box is
   * showing; a list means the reader is confirming what it became. Nothing is
   * saved while this is set — the readings are the one thing no rule can
   * supply, and practising a guess at them teaches the guess.
   */
  const [reviews, setReviews] = createSignal<TextReview[] | null>(null);
  const [libraryMessage, setLibraryMessage] = createSignal<string | null>(null);
  const [lastRun, setLastRun] = createSignal<RunResult | null>(
    runs()[0] ?? null,
  );
  const [resultUnlocks, setResultUnlocks] = createSignal<Unlock[]>([]);
  const nextTarget = createMemo(() => nextMilestone(lifetimeStats()));
  const milestones = createMemo(() => unlockedMilestones(lifetimeStats()));
  const [saveFailed, setSaveFailed] = createSignal(false);
  const [dataMessage, setDataMessage] = createSignal("");
  const [resetArmed, setResetArmed] = createSignal(false);

  let hiddenInput: HTMLInputElement | undefined;
  let savedCurrentRun = false;
  /** Pending navigation to the result screen; cancelled if the run is reset. */
  let completionTimer: number | null = null;
  /** Fires at the deadline of a timed run; cancelled with the run. */
  let deadlineTimer: number | null = null;

  /**
   * The lesson as the matcher and the screen both see it: one token per mora,
   * each carrying every spelling that types it, plus the display words already
   * split into the runs that take a reading above them. Compiled together so the
   * cursor's word index can't address a word the display doesn't have.
   */
  const prompt = createMemo(() => compilePrompt(lesson().items));
  const tokens = createMemo(() => prompt().tokens);
  const tokenWords = createMemo(() => wordIndexForToken(tokens()));
  const displayWords = createMemo(() => prompt().words);
  const projection = createMemo(() => projectMatch(tokens(), session().match));
  /** Which word the cursor is in, for highlighting the display line. */
  const currentWord = createMemo(
    () => tokenWords()[projection().tokenIndex] ?? displayWords().length,
  );
  /** What is still to be typed: the rest of this mora, then everything after it. */
  const remaining = createMemo(() => projection().hint + projection().rest);
  const isComplete = createMemo(() => session().finishedAt !== null);
  const metrics = createMemo(() => computeMetrics(session(), tick()));
  const accuracy = () => metrics().accuracy;
  const speed = () => metrics().wpm;

  /*
   * Five, not eight. These two lists sit stacked in one column beside the key
   * board, and the column's height is what the row costs; eight rows each made
   * it the tallest thing in the group for the page's least actionable data.
   */
  const topConfusions = createMemo(() =>
    Object.entries(confusionMap())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  );
  const totalMinutes = createMemo(() =>
    Math.round(lifetimeStats().totalElapsedMs / 60_000),
  );
  const totalSessions = createMemo(() => lifetimeStats().totalSessions);
  const dayStats = createMemo(() => dailyCounts(runs()));
  const resultRun = createMemo(() => lastRun() ?? runs()[0] ?? null);
  const stillWeak = createMemo(() => {
    const run = resultRun();
    return run === null ? [] : weakAfterRun(run, kanaStats(), 5);
  });
  const keyStats = createMemo(() => mergeTimingStats(runs(), "keyStats"));
  const bigramStats = createMemo(() => mergeTimingStats(runs(), "bigramStats"));
  const slowBigrams = createMemo(() => topTimingStats(bigramStats(), 5));
  const kanaStats = createMemo(() => mergeMoraStats(runs()));
  const weakestMoras = createMemo(() => weakestKana(kanaStats(), 8));
  const coverage = createMemo(() => chartCoverage(kanaStats()));
  const weakMoras = createMemo(() => weakMoraCount(kanaStats()));
  const recentAcc = createMemo(() => recentAccuracy(runs(), 10));
  /* Six rows of ten, each labelled with the day it begins. */
  const calendarWeeks = createMemo(() => {
    const days = recentDayKeys(60);
    const rows: { label: string; days: string[] }[] = [];
    for (let i = 0; i < days.length; i += 10) {
      const chunk = days.slice(i, i + 10);
      const date = new Date(`${chunk[0]}T00:00:00Z`);
      rows.push({
        label: date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }),
        days: chunk,
      });
    }
    return rows;
  });

  const slowMoras = createMemo(() => slowestMoras(kanaStats(), 8));
  const cohorts = createMemo(() => runCohorts(runs()));
  const [pickedCohort, setCohort] = createSignal<string | null>(null);
  /* The latest run's cohort until the reader picks another, and back to it if the
     picked one disappears — a reset, or an import. */
  const cohort = createMemo(() => {
    const picked = pickedCohort();
    if (picked !== null && cohorts().some((c) => c.key === picked))
      return picked;
    return defaultCohort(runs());
  });
  const progress = createMemo(() => {
    const key = cohort();
    return key === null ? [] : progressPoints(runs(), key, 24);
  });
  /*
   * Drill targets are the weakest moras *plus* the least-practised ones. Weakness
   * alone can't drive practice: a mora is only found weak once you have met it
   * and failed it, so a pool made only of known weaknesses stops showing you
   * anything else and new ones never surface.
   */
  const weakKana = createMemo(() => [
    ...weakestMoras().map(([kana]) => kana),
    ...leastPractisedKana(kanaStats(), drillMoras, 4),
  ]);
  const streaks = createMemo(() => streakStats(lifetimeStats().streakDays));

  /**
   * Every write goes through here so a failure is visible. `writeJson` already
   * reported one and every call site dropped it, which made a full quota or a
   * private-browsing block look exactly like a successful save — right up until
   * the next reload, when the run history turned out not to be there.
   */
  const persist = <T,>(key: string, value: T): void => {
    if (!writeJson(key, value)) setSaveFailed(true);
  };

  /**
   * Records go to the database, and the write is not awaited — a keystroke must
   * never wait on one. Failures surface through the same banner.
   */
  const persistRecord = (name: RecordName, value: unknown): void => {
    void recordStore.write(name, value).catch(() => setSaveFailed(true));
  };

  /**
   * One run, appended. Never the whole history: rewriting it on every save is
   * what the separate run store exists to avoid, and the cost of that rewrite
   * grew with the history rather than with what actually changed.
   */
  /** Puts a loaded profile into the signals. Shared by boot, import and reset. */
  const adoptProfile = (profile: StoredProfile) => {
    setRuns(profile.runs);
    setLifetimeStats(profile.lifetime);
    setConfusionMap(profile.confusions);
    setLibrary(profile.library);
    setLastRun(profile.runs[0] ?? null);
  };

  const exportData = async () => {
    try {
      downloadText(backupFilename(), await exportBackup(recordStore));
      setDataMessage("Exported.");
    } catch {
      setDataMessage("Couldn't read your data to export it.");
    }
  };

  const IMPORT_ERRORS: Record<string, string> = {
    unreadable: "That file isn't readable JSON.",
    "not-a-backup": "That doesn't look like a Kana Type export.",
    "unsupported-version":
      "That export came from a newer version. Update first — reading it now could damage your profile.",
  };

  const importData = async (file: File) => {
    /* Before the awaits, not after. A timed run's deadline firing during the
       import would append the run being abandoned into the store the import is
       midway through replacing. */
    resetRunState();
    const result = await importBackup(recordStore, await file.text());
    if (!result.ok) {
      setDataMessage(IMPORT_ERRORS[result.reason]);
      return;
    }
    adoptProfile(result.profile as StoredProfile);
    const preferences = result.preferences as Preferences;
    setSettings(preferences.settings);
    setShowKeyboard(preferences.showKeyboard);
    setKanaGroup(preferences.kanaGroup);
    setKanaScript(preferences.kanaScript);
    setSource(preferences.source);
    setLesson(nextLesson(preferences.source, preferences.settings));
    resetRunState();
    setDataMessage(`Imported ${result.profile?.runs.length ?? 0} runs.`);
  };

  const resetData = async () => {
    if (!resetArmed()) {
      setResetArmed(true);
      setDataMessage("This erases every run, your library and your settings.");
      return;
    }
    setResetArmed(false);
    // Same race as import: stop the run before erasing what it would be saved into.
    resetRunState();
    adoptProfile(await resetProfile(recordStore));
    setSettings(readSettings());
    setShowKeyboard(readShowKeyboard());
    setKanaGroup(readKanaGroup());
    setKanaScript(readKanaScript());
    setSource(readSource());
    setLesson(nextLesson(readSource()));
    resetRunState();
    setDataMessage("Erased.");
  };

  const navigate = (next: RouteName) => {
    window.location.hash = next === "practice" ? "#/practice" : `#/${next}`;
    setRoute(next);
    /*
     * Arriving at practice puts focus back on the typing capture. Every route
     * change funnels through here, so this is the one place that can promise
     * it — and the promise is what the `Tab fresh text` hint depends on, since
     * the shortcut is taken from the capture and from nowhere else.
     *
     * Three ways in were landing somewhere else. The nav buttons call
     * `stopPropagation`, so `<main>`'s `onClick={refocus}` never ran for them
     * and a reader who clicked `practice` was left holding the button, where
     * the next Tab stepped along the nav instead of dealing a passage.
     * Choosing a text in the library left focus on that row. The result
     * screen's Enter left it on `<body>`.
     *
     * `refocus` is a no-op off this route, so every other destination keeps
     * the focus the reader put there.
     */
    refocus();
  };

  const cancelCompletion = () => {
    if (completionTimer !== null) {
      clearTimeout(completionTimer);
      completionTimer = null;
    }
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
  };

  /*
   * The text being practised as itself, or null while practice is dealing from
   * a pool. Two targets, not two modes: everything that follows asks which one
   * is active rather than carrying a flag.
   */
  const [chosenText, setChosenText] = createSignal<PracticeText | null>(null);

  /*
   * Derived from the target, not read from settings.
   *
   * A chosen text is finite — it is the thing you asked to type. Under a clock
   * the run would reach the end of it and keep going, dealing more passages
   * from the same source to fill the remaining seconds, so a request to type
   * one sentence would silently become a minute of whatever else was in the
   * bank. The stored preference is left alone; only this run ignores it.
   */
  const timedRun = () => settings().timedMode && chosenText() === null;
  const timeLeft = createMemo(() =>
    timedRun() ? remainingMs(session(), tick(), STANDARD_TIMED_MS) : null,
  );

  /*
   * Ends a timed run at its deadline — not at the moment the callback happened
   * to fire. A timer that runs 400 ms late would otherwise record a 60.4-second
   * run, and every timed run would be a slightly different length.
   */
  const endTimedRun = () => {
    cancelCompletion();
    const current = session();
    if (current.startedAt === null || current.finishedAt !== null) return;
    const finished = finishRun(current, current.startedAt + STANDARD_TIMED_MS);
    setSession(finished);
    saveCurrentRun(finished, lesson());
    /*
     * The result screen only if the typist is still here to see it. A deadline
     * can land while they are reading their statistics, and pulling them out of
     * that page into a result they did not ask for is the same rudeness the
     * completion timer already avoids after a restart. The run is saved either
     * way; when they come back, practice is fresh rather than a finished run
     * they cannot type into.
     */
    if (route() === "practice") {
      navigate("result");
      return;
    }
    resetRunState();
    setLesson(nextLesson(source()));
  };

  /** Arms the one-shot deadline once the typist has actually started. */
  const armDeadline = (state: SessionState) => {
    if (!timedRun() || state.startedAt === null || deadlineTimer !== null)
      return;
    const left = Math.max(0, state.startedAt + STANDARD_TIMED_MS - Date.now());
    deadlineTimer = window.setTimeout(() => {
      deadlineTimer = null;
      endTimedRun();
    }, left);
  };

  const resetRunState = () => {
    cancelCompletion();
    savedCurrentRun = false;
    setSession(emptySession());
  };

  /*
   * The material a run is committed to. Held in a plain variable rather than a
   * signal: nothing renders from it, and a timed run must keep dealing from the
   * *same* resolved source and the same deck however many passages it gets
   * through.
   */
  let plan: RunPlan | null = null;

  /*
   * The pool path. Anything that deals at random is also leaving a chosen text
   * behind, so the target is cleared here rather than at each of the five call
   * sites — one of which would eventually be forgotten, leaving a run that
   * deals from a bank while the screen still names a sentence.
   */
  const nextLesson = (
    nextSource: SourceName,
    nextSettings: Settings = settings(),
  ) => {
    setChosenText(null);
    plan = planRun(
      nextSource,
      weakKana(),
      library(),
      Math.random,
      kanaGroup(),
      kanaScript(),
    );
    const dealt = dealLesson(plan, nextSettings, Math.random);
    plan = dealt.plan;
    return dealt.lesson;
  };

  /**
   * A new run on the text already on screen.
   *
   * The plan has to be rebuilt even though the passage does not change: left
   * alone, a retried timed run would deal its *second* passage from the previous
   * run's part-spent deck, and lose the promise that a run covers its bank
   * before repeating.
   */
  const retrySameText = () => {
    const chosen = chosenText();
    if (chosen !== null) {
      // Rebuilt from the text, so a retry starts at its beginning. Rebuilding a
      // pool plan here would quietly swap the sentence for a random passage.
      plan = null;
      setLesson(lessonForText(chosen));
      resetRunState();
      navigate("practice");
      return;
    }
    plan = planRun(
      source(),
      weakKana(),
      library(),
      Math.random,
      kanaGroup(),
      kanaScript(),
    );
    resetRunState();
    navigate("practice");
  };

  /**
   * Practise one text, start to finish, instead of dealing from a pool.
   *
   * No plan: there is nothing to deal next. A run that reaches the end of a
   * chosen text is over, which is also why `timedRun` returns false while one
   * is set.
   */
  const practiseText = (text: PracticeText) => {
    plan = null;
    setChosenText(text);
    setLesson(lessonForText(text));
    resetRunState();
    navigate("practice");
  };

  /** The next passage of the *same* run — same source, same deck. */
  const refill = () => {
    // A chosen text has no next passage: `plan` is null for exactly that
    // reason, and the run ends where the text does.
    if (plan === null) return;
    const dealt = dealLesson(plan, settings(), Math.random);
    plan = dealt.plan;
    setLesson(dealt.lesson);
  };

  const setTimedMode = (timedMode: boolean) => {
    const next = { ...settings(), timedMode };
    persist(SETTINGS_KEY, next);
    setSettings(next);
    // The run in progress was measured the other way; start a clean one.
    freshText();
  };

  const setConfidenceMode = (confidenceMode: boolean) => {
    const next = { ...settings(), confidenceMode };
    persist(SETTINGS_KEY, next);
    setSettings(next);
  };

  const setWhitespaceMarkers = (whitespaceMarkers: boolean) => {
    const next = { ...settings(), whitespaceMarkers };
    persist(SETTINGS_KEY, next);
    setSettings(next);
  };

  const setStopOnError = (stopOnError: boolean) => {
    const next = { ...settings(), stopOnError };
    setSettings(next);
    persist(SETTINGS_KEY, next);
    resetRunState();
  };

  const changeKanaGroup = (group: KanaGroup) => {
    persist(KANA_GROUP_KEY, group);
    setKanaGroup(group);
    if (source() === "kana") {
      setLesson(nextLesson("kana"));
      resetRunState();
    }
  };

  /* Same shape as the group change, and for the same reason: the deck in hand
     was built from the old choice, so it has to be dealt again or the next
     thing typed is the syllabary that was just switched away from. */
  const changeKanaScript = (choice: KanaScriptChoice) => {
    persist(KANA_SCRIPT_KEY, choice);
    setKanaScript(choice);
    if (source() === "kana") {
      setLesson(nextLesson("kana"));
      resetRunState();
    }
  };

  const freshText = () => {
    setLesson(nextLesson(source()));
    resetRunState();
    navigate("practice");
  };

  const changeSource = (nextSource: SourceName) => {
    persist(SOURCE_KEY, nextSource);
    setSource(nextSource);
    setLesson(nextLesson(nextSource));
    resetRunState();
  };

  /*
   * Takes the finished session and its lesson rather than reading the signals.
   *
   * It used to re-read them from inside a deferred callback, so anything that
   * reset the run in that window — a restart keypress landing between the last
   * keystroke and the timer, which fast typing reaches — had the completed run
   * recorded against whatever state had replaced it.
   */
  const saveCurrentRun = (finished: SessionState, forLesson: Lesson) => {
    if (savedCurrentRun) return null;
    savedCurrentRun = true;
    const currentSession = finished;
    const currentLesson = forLesson;
    const currentMetrics = computeMetrics(currentSession, Date.now());
    const run = buildRunResult(
      currentSession,
      currentLesson,
      currentMetrics,
      undefined,
      // `timedRun()`, not the setting: a chosen text is always a passage run,
      // and recording it as timed would file a one-sentence result alongside
      // sixty-second ones.
      timedRun()
        ? { kind: "timed", durationMs: STANDARD_TIMED_MS }
        : { kind: "passage" },
    );
    setLastRun(run);
    const previousLifetime = lifetimeStats();
    const nextLifetime = recordRunInLifetimeStats(previousLifetime, run);
    setResultUnlocks(newlyReachedMilestones(previousLifetime, nextLifetime));
    setLifetimeStats(nextLifetime);
    /*
     * One transaction for both. Written separately, a crash or a closed tab
     * between them left the profile disagreeing with itself — a run no total
     * counted, or totals claiming a run whose record was never written — and
     * nothing afterwards records which of the two was the truth.
     *
     * No cap on history. The 100-run limit existed to fit localStorage, and
     * truncating is what used to make personal bests and streaks regress.
     */
    void recordStore
      .commitRun(run, nextLifetime)
      .catch(() => setSaveFailed(true));
    setRuns((current) => [run, ...current]);
    return run;
  };

  const typeChar = (rawChar: string) => {
    if (isComplete() || route() !== "practice") return;
    /*
     * Checked before the keystroke, not only by the timer. A throttled or
     * backgrounded tab can fire a timeout seconds late, and without this the
     * typist keeps scoring into a run that was already over.
     */
    /* One clock read for the whole keystroke. Reading `Date.now()` again below
       let a key pass the expiry check and then be scored a moment after the
       deadline, which also stamped the run with that key's time instead of the
       deadline. */
    const now = Date.now();
    if (timedRun() && remainingMs(session(), now, STANDARD_TIMED_MS) === 0) {
      endTimedRun();
      return;
    }
    const result = applyTypeChar(
      session(),
      rawChar,
      tokens(),
      now,
      settings().stopOnError,
    );
    setSession(result.session);
    armDeadline(result.session);
    if (result.missed) {
      const { legal, typed } = result.missed;
      const label = (char: string) => (char === " " ? "space" : char);
      /*
       * The `misses` record is no longer written. It counted a miss against the
       * single legal continuation, live, on every keystroke — a different
       * population from the per-run `keyStats` that the key panel reads for
       * everything else, and its only reader was that panel's printed count.
       * Two sources behind one cap is what let a profile with no completed run
       * show a miss count on a key drawn as never missed.
       *
       * The stored record is left readable and importable rather than purged:
       * `resetProfile` clears the whole records store, so nothing is stranded,
       * and an older build reading a backup still finds the field it expects.
       */
      setConfusionMap((current) => {
        const pair = `${legal.map(label).join("/")} → ${label(typed)}`;
        const next = { ...current, [pair]: (current[pair] ?? 0) + 1 };
        persistRecord("confusions", next);
        return next;
      });
    }
    if (
      result.completed &&
      timedRun() &&
      remainingMs(result.session, now, STANDARD_TIMED_MS) !== 0
    ) {
      /*
       * The passage ran out before the clock did, which in a timed run is not
       * the end of anything — the matcher and the line reset, the counters and
       * the stat tables do not, and the same run keeps going on a fresh passage.
       */
      setSession(rollToNextPrompt(result.session));
      refill();
      return;
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
      saveCurrentRun(result.session, lesson());
      completionTimer = window.setTimeout(() => {
        completionTimer = null;
        navigate("result");
      }, 0);
    }
  };

  onCleanup(cancelCompletion);

  const backspace = () => {
    setSession((current) => applyBackspace(current, tokens()));
  };

  const setKeyboardVisible = (visible: boolean) => {
    persist(SHOW_KEYBOARD_KEY, visible);
    setShowKeyboard(visible);
  };

  const updateParagraphLength = (length: number) => {
    const next = {
      ...settings(),
      paragraphItems: Math.max(3, Math.min(30, length)),
    };
    setSettings(next);
    persist(SETTINGS_KEY, next);
    setLesson(nextLesson(source(), next));
    resetRunState();
  };

  const LIBRARY_LIMIT = 200;

  const REJECT_REASONS: Record<LibraryReject["reason"], string> = {
    "no-reading": "needs a reading, as kanji|romaji",
    "word-mismatch": "the kana and romaji disagree about where the words break",
    unsupported: "contains a character this app cannot type",
    "too-long": "is longer than one practice line can hold",
  };

  /**
   * A paste becomes something to confirm, not something to save.
   *
   * Every line is shown with its kanji waiting for a reading, because that is
   * the one thing no rule can supply — and a line this app cannot read used to
   * be refused with a sentence about `kanji|romaji`, which is a format to learn
   * rather than a question to answer.
   */
  const beginReview = (text: string) => {
    const next = reviewPaste(text);
    if (next.length === 0) {
      setLibraryMessage("Nothing to add — the box is empty.");
      return;
    }
    setLibraryMessage(null);
    setReviews(next);
  };

  const editReading = (line: number, segment: number, reading: string) => {
    setReviews(
      (current) =>
        current?.map((review, at) =>
          at === line ? withReading(review, segment, reading) : review,
        ) ?? null,
    );
  };

  /*
   * Whether the paste box is open. Closed by default now that the library
   * leads with what is already there: arriving at a list and a form at once
   * asked a question — write something, or pick something — that the page can
   * answer for itself.
   */
  const [addingText, setAddingText] = createSignal(false);

  /*
   * The button that opens the paste box unmounts when it opens, so focus has
   * to be handed over deliberately in both directions: the textarea takes it
   * on the way in (its own `ref`), and this hands it back on the way out.
   * Without the return trip, cancelling drops focus on `<body>` and a keyboard
   * tab starts again from the top of the page.
   */
  let addButton: HTMLButtonElement | undefined;

  /*
   * Where "skip your saved texts" sends focus while the compose box is open.
   * The add button unmounts as the box opens, and Solid does not clear a `ref`
   * on unmount — so `addButton?.focus()` passed the optional check, called
   * `focus()` on a detached node, and did nothing at all. Optional chaining
   * tests whether the reference exists, not whether it is still in the
   * document. Predates the move into the column: the button unmounted there
   * too.
   */
  let composeInput: HTMLTextAreaElement | undefined;

  /*
   * Where the two skip controls land. The sentences list is 35 rows and your
   * own can hold 200, so crossing this page on a keyboard was up to 235 tab
   * stops. The rows keep their ordinary tab stops — they are a list of
   * buttons and that is what a list of buttons does — and these are the
   * way past, revealed on focus and silent otherwise.
   *
   * Buttons, not `href="#texts"` links: this app routes on the hash, so an
   * in-page anchor would change the route out from under the reader.
   */
  let textsHeading: HTMLHeadingElement | undefined;

  const openCompose = () => setAddingText(true);

  const closeCompose = () => {
    setAddingText(false);
    setCustomText("");
    queueMicrotask(() => addButton?.focus());
  };

  /* Split by shape, not by a flag: a text of several sentences is read
     differently from a single line, so the two are listed differently. */
  const passages = createMemo(() =>
    bundledTexts().filter((text) => text.items.length > 1),
  );
  const singles = createMemo(() =>
    bundledTexts().filter((text) => text.items.length === 1),
  );

  /** The lines that could be practised as they stand. */
  const reviewedItems = createMemo(() =>
    (reviews() ?? [])
      .map((review) => reviewItem(review))
      .filter((item): item is TextItem => item !== null),
  );

  /** Boxes still empty, so the button can say what it is waiting for. */
  const readingsOwed = createMemo(() =>
    (reviews() ?? []).reduce(
      (owed, review) =>
        owed + review.segments.filter((segment) => segment.reading.trim() === '').length,
      0,
    ),
  );

  /*
   * What the button does, said on the button. It used to read "save 0 to
   * library" and sit greyed out, which named neither the thing a person came
   * to do nor the thing standing in the way — a paste was pasted and the
   * screen appeared to have no way forward.
   */
  const reviewAction = createMemo(() => {
    const ready = reviewedItems().length;
    const total = (reviews() ?? []).length;
    if (ready === 0) {
      // No box to fill and nothing ready means the lines are refused for some
      // other reason — too long, or not typable. "fill in 0 readings" names an
      // action that does not exist; the hint under each line gives the reason.
      if (readingsOwed() === 0) return "nothing here can be practised";
      return readingsOwed() === 1
        ? "fill in 1 reading"
        : `fill in ${readingsOwed()} readings`;
    }
    return ready < total ? `practise ${ready} of ${total}` : "practise";
  });

  /*
   * The review is a step on the way to practice, not a document. Leaving the
   * library page ends it, because the library page is the only place that
   * draws it: coming back to a half-filled review from somewhere else showed a
   * screen with no paste box, no way to start another paste, and a primary
   * button that could not be pressed — which reads as the app having lost the
   * ability to take a paste at all.
   */
  createEffect(() => {
    if (route() !== "library") setReviews(null);
  });

  /** Why a line cannot be practised yet, in a sentence rather than a code. */
  const reviewHint = (review: TextReview): string => {
    const reason = reviewReject(review);
    if (reason === null) return "";
    return reason === "no-reading"
      ? "waiting for a reading"
      : `This line ${REJECT_REASONS[reason]}.`;
  };

  const saveReviewed = () => {
    const items = reviewedItems();
    const total = (reviews() ?? []).length;
    if (items.length === 0) {
      setLibraryMessage("Nothing here can be practised yet.");
      return;
    }
    let evicted = 0;
    let unfit = 0;
    setLibrary((current) => {
      /*
       * The new entries are kept whole first. They used to be concatenated and
       * the whole list truncated, so a paste of more than `LIBRARY_LIMIT` lines
       * threw away some of the lines just added — and then reported that the
       * oldest had made way, which is not what had happened.
       */
      const kept = items.slice(0, LIBRARY_LIMIT);
      unfit = items.length - kept.length;
      const combined = [...kept, ...current];
      evicted = Math.max(0, combined.length - LIBRARY_LIMIT);
      const next = combined.slice(0, LIBRARY_LIMIT);
      persistRecord("library", next);
      return next;
    });
    const skipped = total - items.length;
    setReviews(null);
    setCustomText("");
    setAddingText(false);
    setLibraryMessage(
      unfit > 0
        ? `Added ${items.length - unfit}. The library holds ${LIBRARY_LIMIT} entries, so ${unfit} of these did not fit and everything older made way.`
        : evicted > 0
          ? `Added ${items.length}. The library holds ${LIBRARY_LIMIT} entries, so the ${evicted} oldest made way.`
          : skipped > 0
            ? `Added ${items.length}, and left ${skipped} without a reading behind.`
            : null,
    );
    /*
     * The text just confirmed, in the order it was reviewed — not the library.
     * `changeSource("library")` used to stand here, which deals at random from
     * every saved entry: someone who had just read through seven boxes to
     * confirm one paragraph was handed a shuffle of everything they had ever
     * saved, including the paragraph, somewhere.
     */
    practiseText({ id: "just-reviewed", source: "library", items });
  };

  const handleFile = async (file: File) => {
    beginReview(await file.text());
  };

  const refocus = () => {
    if (route() === "practice") hiddenInput?.focus({ preventScroll: true });
  };

  /**
   * Loads the stored profile, carrying an older localStorage one across on the
   * first run. A failure is not fatal: the app opens on an empty profile and
   * says so, which beats refusing to start because history couldn't be read.
   */
  onMount(async () => {
    try {
      await migrateLocalStorage(recordStore);
      adoptProfile(await loadProfile(recordStore));
      setLesson(nextLesson(source()));
    } catch {
      setSaveFailed(true);
    }
    if (!durableStore) setSaveFailed(true);
    setReady(true);
    refocus();
  });

  onMount(() => {
    refocus();
    const interval = window.setInterval(() => setTick(Date.now()), 500);
    // Back and forward are route changes too, and landing on practice through
    // either should leave the reader able to type, the same as `navigate`.
    const hashchange = () => {
      setRoute(routeFromHash());
      refocus();
    };

    /*
     * Coming back from a hidden tab, the gap since the last keystroke is not
     * typing — it is however long the tab was away, clamped to the pause cap and
     * then charged to whichever mora happened to be next. Clearing `lastKeyAt`
     * makes that first keystroke deliberately untimed, the same treatment the
     * first key of a run and the key after a backspace already get.
     */
    const visibility = () => {
      if (document.visibilityState !== "visible") return;
      setSession((current) =>
        current.lastKeyAt === null ? current : { ...current, lastKeyAt: null },
      );
    };

    /*
     * True when the key came from a control that already owns it — anything
     * focusable other than the typing capture. The capture is excluded by
     * identity and not by selector, because it is itself an `<input>` and
     * would match the selector it is being told apart from.
     *
     * The window-level practice shortcuts sit on top of whatever has focus, so
     * this is what keeps them off keys the browser has already given a meaning
     * there.
     */
    const onOtherControl = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el === hiddenInput) return false;
      return (
        el?.closest("button, a, input, select, textarea, [tabindex]") != null
      );
    };

    const keydown = (event: KeyboardEvent) => {
      // Light the cap before any early return, so modifiers (which set their own
      // ctrl/meta/alt flag on their own keydown) still show as held on the
      // on-screen keyboard. Purely visual — nothing below this line is skipped.
      if (!event.repeat)
        setPressedKeys((current) => new Set(current).add(event.code));

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;

      /*
       * Not when a control has focus. This is a window-level shortcut, so it
       * used to fire before the focused button could act on its own Enter —
       * a keyboard user aiming at "view stats" or "retry same text" got the
       * next practice instead, with no way to reach either.
       */
      if (route() === "result" && event.key === "Enter") {
        const el = event.target as HTMLElement | null;
        const interactive = el?.closest(
          "button, a, input, select, textarea, [tabindex]",
        );
        if (interactive !== null && interactive !== undefined) return;
        event.preventDefault();
        freshText();
        return;
      }

      if (route() !== "practice") return;

      if (event.key === "Tab") {
        /*
         * From the typing capture only, and never with Shift.
         *
         * It used to fire on every Tab on this route, so the top bar could be
         * neither entered nor left by keyboard — measured as
         * `defaultPrevented === true` with the focus on `practice`. Exempting
         * focused controls fixed that much and left `<body>` still refreshing
         * and still going nowhere, which is reachable: the result screen's
         * Enter starts practice without focusing the new capture, so every
         * following Tab discarded the passage and moved nothing. Narrowed to
         * the capture itself, the shortcut belongs to the field it is a
         * shortcut for, and every other focus state gets an ordinary Tab.
         *
         * Shift+Tab is never taken. It is the supported way out of a capture
         * that is focused on load and again after every click on the stage. It
         * used to deal fresh text, but nothing advertised that and the hint
         * reads `Tab fresh text`.
         */
        if (event.shiftKey || event.target !== hiddenInput) return;
        event.preventDefault();
        freshText();
        return;
      }
      if (event.key === "Enter") {
        if (isComplete()) {
          /* The same exemption the result screen's Enter above already had,
             and missing here for the same reason it was needed there: with the
             run finished and a button focused, Enter dealt a new passage
             instead of pressing the button the reader had aimed at. */
          if (onOtherControl(event)) return;
          event.preventDefault();
          freshText();
        }
        return;
      }
      if (event.key === "Backspace") {
        // Swallowed either way: the browser would navigate back otherwise.
        event.preventDefault();
        if (!settings().confidenceMode) backspace();
        return;
      }
      if (event.key.length === 1) {
        /*
         * Space is the one printable key a focused control already owns: it is
         * one of the two standard ways to press a button, and this branch was
         * turning it into a typed space. Harmless while nothing here could be
         * reached by keyboard — and a dead key the moment Tab could reach the
         * source buttons, which is the half of that fix that was missing.
         *
         * Letters are deliberately not exempted. They mean nothing on a
         * button, and clicking a source button leaves focus on it, so a reader
         * who picks a source and carries on typing would be typing into
         * nothing if they were.
         */
        if (event.key === " " && onOtherControl(event)) return;
        event.preventDefault();
        typeChar(event.key);
      }
    };

    const keyup = (event: KeyboardEvent) => {
      setPressedKeys((current) => {
        const next = new Set(current);
        next.delete(event.code);
        return next;
      });
    };
    const clearPressedKeys = () => setPressedKeys(new Set<string>());

    window.addEventListener("hashchange", hashchange);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clearPressedKeys);

    onCleanup(() => {
      window.clearInterval(interval);
      window.removeEventListener("hashchange", hashchange);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clearPressedKeys);
    });
  });

  // Nothing is drawn until the stored profile has loaded. The alternative —
  // render an empty profile and swap the lesson out a moment later — puts a
  // different passage under the typist's fingers after they have started.
  return (
    <Show
      when={ready()}
      fallback={<main class="app app--loading">loading…</main>}
    >
      {/* The statistics page is a dashboard and wants the window; every other
          page is reading content and is better off in a narrow column. */}
      <main
        classList={{
          app: true,
          "app--wide": route() === "stats",
          "app--library": route() === "library",
        }}
        onClick={refocus}
      >
        <Topbar
          secondsLeft={
            timeLeft() === null ? null : Math.ceil(timeLeft()! / 1000)
          }
          wpm={speed()}
          accuracy={accuracy()}
          mistakes={session().mistakes}
          showLive={route() === "practice"}
          route={route()}
          onNavigate={navigate}
          onHomeClick={() => navigate("practice")}
        />

        {/* Storage can refuse a write — a full quota, or private browsing. Saying
            so beats letting the session look saved until the next reload proves
            otherwise. Stays up once raised: the runs already lost don't come back
            just because a later, smaller write succeeded. */}
        <Show when={saveFailed()}>
          <p class="alert" role="status" aria-live="polite">
            Couldn't save to this browser's storage — your progress this session
            won't be here after a reload. Private browsing or a full storage
            quota are the usual causes.
          </p>
        </Show>

        <Show when={route() === "practice"}>
          <section class="stage">
            <input
              ref={(el) => {
                hiddenInput = el;
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
                event.currentTarget.value = "";
              }}
              onBeforeInput={(event) => {
                if (event.inputType === "deleteContentBackward") {
                  event.preventDefault();
                  backspace();
                  return;
                }
                if (event.inputType === "insertText" && event.data) {
                  event.preventDefault();
                  for (const char of event.data) typeChar(char);
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
                        "kana-token": true,
                        "kana-token--done": index() < currentWord(),
                        "kana-token--current": index() === currentWord(),
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
                        "char--correct": key.correct,
                        "char--incorrect": !key.correct,
                        "char--space":
                          settings().whitespaceMarkers && key.char === " ",
                      }}
                    >
                      {key.char}
                    </span>
                  )}
                </For>
                <For each={remaining().split("")}>
                  {(char, index) => (
                    <span
                      classList={{
                        char: true,
                        "char--current": index() === 0,
                        // Stop-on-error consumes nothing, so there is no wrong
                        // character to colour. The signal goes on the one still
                        // being waited for.
                        "char--rejected":
                          index() === 0 && session().rejected !== null,
                        "char--space":
                          settings().whitespaceMarkers && char === " ",
                      }}
                    >
                      {char}
                    </span>
                  )}
                </For>
              </p>
            </section>

            <Show when={showKeyboard()}>
              <OnScreenKeyboard pressed={pressedKeys} />
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
                        event.stopPropagation();
                        changeSource(option.value);
                      }}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>

              {/* Which part of the chart to drill. Only meaningful while the kana
                  source is selected, so it stays out of the way otherwise. */}
              <Show when={source() === "kana"}>
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
                          event.stopPropagation();
                          changeKanaGroup(group);
                        }}
                      >
                        {KANA_GROUP_LABELS[group]}
                      </button>
                    )}
                  </For>
                  <span class="source-current">
                    {kanaRows(kanaGroup(), kanaScript()).length} rows
                  </span>
                </div>
                {/* A second row, not more buttons on the first. Script and
                    group are separate questions — the voiced katakana rows are
                    their own thing to drill — and crossing them into one list
                    would make twelve buttons out of seven. */}
                <div class="practice-hints__row">
                  <span class="hint-label">script</span>
                  <For each={KANA_SCRIPT_CHOICES}>
                    {(choice) => (
                      <button
                        type="button"
                        class="source-button"
                        classList={{ active: kanaScript() === choice }}
                        title={KANA_SCRIPT_LABELS[choice]}
                        onClick={(event) => {
                          event.stopPropagation();
                          changeKanaScript(choice);
                        }}
                      >
                        {KANA_SCRIPT_LABELS[choice]}
                      </button>
                    )}
                  </For>
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
                    event.stopPropagation();
                    setKeyboardVisible(!showKeyboard());
                  }}
                >
                  {showKeyboard() ? "hide keyboard" : "show keyboard"}
                </button>
              </div>
            </div>
          </section>
        </Show>

        <Show when={route() === "result"}>
          <section class="page page--narrow result-page">
            {/* No "result" heading: the numbers say what this is, and a title
                above them just delays them. The scores lead. */}
            <Show
              when={resultRun()}
              fallback={<p class="muted">No completed run yet.</p>}
            >
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
                      <b>
                        {run().consistency === undefined
                          ? "—"
                          : `${run().consistency}%`}
                      </b>
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
                    <span>{SOURCE_LABELS[run().source] ?? run().source}</span>
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
                              classList={{
                                "still-weak__chip--recurring": item.recurring,
                              }}
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
                        Ordered by how weak each is overall — the same order
                        drills pull in.
                        <Show when={stillWeak().some((item) => item.recurring)}>
                          {" "}
                          Underlined ones you have missed before.
                        </Show>
                      </p>
                    </section>
                  </Show>

                  {/* Newly reached ones are the celebration; the next one is
                      what makes this a surface rather than a flash, since a run
                      that crosses no threshold used to show nothing at all. */}
                  <Show
                    when={resultUnlocks().length > 0 || nextTarget() !== null}
                  >
                    <section
                      class="result-section"
                      role="status"
                      aria-live="polite"
                    >
                      <h2>
                        {resultUnlocks().length > 0
                          ? "milestone reached"
                          : "next milestone"}
                      </h2>
                      <div class="achievement__list">
                        <For each={resultUnlocks()}>
                          {(item) => (
                            <span class="achievement__chip">{item.label}</span>
                          )}
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
                    {/* After a chosen text the obvious next move is that text
                        again, not a random passage from whatever bank it came
                        from — so the two swap places rather than the primary
                        quietly meaning something else. */}
                    <Show
                      when={chosenText() === null}
                      fallback={
                        <>
                          <button
                            type="button"
                            class="primary"
                            onClick={retrySameText}
                          >
                            practise again
                          </button>
                          <button
                            type="button"
                            class="secondary"
                            onClick={() => navigate("library")}
                          >
                            choose another text
                          </button>
                        </>
                      }
                    >
                      <button type="button" class="primary" onClick={freshText}>
                        next practice
                      </button>
                      <button
                        type="button"
                        class="secondary"
                        onClick={retrySameText}
                      >
                        retry same text
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => navigate("stats")}
                    >
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

        <Show when={route() === "stats"}>
          <section class="page stats-page">
            <div class="profile-id">
              <div>
                <h1>your statistics</h1>
                <p class="muted">
                  {totalSessions()} sessions · {totalMinutes()} min typing
                </p>
              </div>
            </div>

            {/* Learner metrics, not leaderboard metrics. `avg wpm` averaged
                every stored run while `best wpm` was progression-gated, so the
                two disagreed about which runs counted; and `current acc` read
                the *live typing session*, which on this route is empty and so
                reported 100% whatever the history said. Speed lives in the
                progress section, where a trend can give it context.

                All four stay together in the page's first row. Splitting them
                across the groups they each describe was tried and reverted: it
                is defensible by the page's three-question structure, but it
                costs the page its opening summary, and a reader arriving wants
                the four numbers before they want them filed. */}
            <div class="stat-grid">
              {/* "hiragana", not "moras". `chartCoverage` counts the hiragana
                  chart alone — deliberately, since every one of its cells is
                  reachable from the bundled text and so the figure is a target
                  that can be finished. Called "moras seen" it quietly became a
                  lie the moment katakana got a chart: a profile that had met
                  every katakana cell and no hiragana read "0 moras seen". The
                  katakana count lives beside its own chart. */}
              <div>
                <b>{coverage().met}</b>
                <span>hiragana seen · of {coverage().total}</span>
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
                  {/* The chart and its legend only: the heading and the line
                      above sit with the page's other headings, not with the
                      chart. */}
                  <div class="mastery-panel">
                    <MasteryMap
                      stats={kanaStats()}
                      aside={
                        // The chart's right-hand column: the rankings, and the
                        // legend under them. The legend belongs beside the chart
                        // rather than below it — under the chart it sat at the
                        // foot of a 613px column of kana with nothing to its
                        // right, while this column has the room.
                        <>
                          <Show
                            when={
                              weakestMoras().length > 0 ||
                              slowMoras().length > 0
                            }
                          >
                            <div class="stat-grid stat-grid--margin">
                              {/* The rankings sit with the chart, not in the
                          legend. A legend explains what the colours mean; these
                          say what the chart *found*, which is a different job.
                          Beside it above 1462px of panel width, beneath it in a
                          footer below that — see App.css, and AGENTS.md for why
                          "margin" overstated it.
                          They also carry kana rather than digits, so they read
                          as a list and fill the column the off-chart strip
                          leaves mostly empty. */}
                              <Show when={weakestMoras().length > 0}>
                                <div class="stat-grid__rank">
                                  <b>
                                    {weakestMoras()
                                      .slice(0, 5)
                                      .map(([kana]) => kana)
                                      .join(" ")}
                                  </b>
                                  <span>weakest</span>
                                </div>
                              </Show>
                              {/* The chart's colour says what you get *wrong*; this says
                          what you have to *think about*. Each cell already
                          carries its own excess in its detail — this is the
                          ranking, which a grid cannot show. */}
                              <Show when={slowMoras().length > 0}>
                                <div class="stat-grid__rank">
                                  <b>
                                    {slowMoras()
                                      .slice(0, 5)
                                      .map(([kana]) => kana)
                                      .join(" ")}
                                  </b>
                                  <span>slowest to recall</span>
                                </div>
                              </Show>
                            </div>
                          </Show>
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
                          </div>
                        </>
                      }
                    />
                  </div>
                </section>
              </div>
            </div>

            <div class="stats-group">
              <h2 class="stats-group__label">recent progress</h2>
              <div class="stats-grid">
                <section class="panel panel--span-8">
                  <h3>speed and accuracy</h3>
                  <ProgressChart
                    points={progress()}
                    cohorts={cohorts()}
                    cohort={cohort()}
                    onCohort={setCohort}
                  />
                </section>
                <section class="panel panel--span-4">
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
                                const count = () => dayStats().get(key) ?? 0;
                                const max = () =>
                                  Math.max(1, ...dayStats().values());
                                return (
                                  <span
                                    class="calendar-cell"
                                    classList={{ active: count() > 0 }}
                                    style={{
                                      "--day-heat": String(
                                        count() === 0
                                          ? 0
                                          : 0.35 + 0.65 * (count() / max()),
                                      ),
                                    }}
                                    tabindex="0"
                                    {...tipFor(
                                      () =>
                                        `${new Date(
                                          `${key}T00:00:00Z`,
                                        ).toLocaleDateString(undefined, {
                                          day: "numeric",
                                          month: "short",
                                          timeZone: "UTC",
                                        })} · ${count()} ${count() === 1 ? "run" : "runs"}`,
                                    )}
                                  >
                                    <span class="sr-only">{`${key}: ${count()} runs`}</span>
                                  </span>
                                );
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
                          classList={{
                            "achievement__chip--next": !item.reached,
                          }}
                          aria-label={`${item.label} — ${item.reached ? "reached" : "not yet reached"}`}
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
                    <b>{milestones().filter((item) => item.reached).length}</b>{" "}
                    of {milestones().length} reached.
                  </p>
                </section>
              </div>
            </div>

            <div class="stats-group">
              <h2 class="stats-group__label">typing mechanics</h2>
              {/* The key board and the bar lists both run their content to the
                  edge they share, so this row takes the wide gutter. */}
              <div class="stats-grid stats-grid--gutter">
                <section class="panel panel--span-6">
                  <h3>romaji key errors</h3>
                  <p class="muted">
                    Romaji keys, not kana — one key types many moras, so this
                    cannot say which mora is at fault. The chart above can.
                  </p>
                  <div class="mini-keyboard">
                    <For each={["qwertyuiop", "asdfghjkl", "zxcvbnm"]}>
                      {(row) => (
                        <div class="mini-keyboard-row">
                          <For each={row.split("")}>
                            {(letter) => {
                              const stat = () => keyStats().get(letter);
                              /*
                               * Count, rate, state and tint all read `keyStats`,
                               * which aggregates COMPLETED runs. The count used to
                               * read the live `misses` record instead — written on
                               * every keystroke and saved immediately — so the cap's
                               * number and its colour described different
                               * populations. On a profile with no finished run at
                               * all, a cap printed "6" in the teal that means "never
                               * missed": a true number beside a contradicting
                               * colour. A rate needs its own denominator anyway, and
                               * only `keyStats` carries both halves.
                               */
                              const count = () => stat()?.misses ?? 0;
                              return (
                                <span
                                  class="mini-key"
                                  classList={{ "mini-key--weak": count() > 0 }}
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
                                    "--mk-heat": String(
                                      count() ? smoothedErrorRate(stat()!) : 0,
                                    ),
                                  }}
                                  tabindex="0"
                                  {...tipFor(
                                    () =>
                                      `${letter} · ${count()} ${
                                        count() === 1 ? "miss" : "misses"
                                      }, ${Math.round(
                                        (stat()?.errorRate ?? 0) * 100,
                                      )}% of ${stat()?.attempts ?? 0} · ${Math.round(
                                        stat()?.avgMs ?? 0,
                                      )} ms average`,
                                  )}
                                >
                                  {letter}
                                  <small>{count() || ""}</small>
                                </span>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
                {/*
                 * The two bar lists stack into one column beside the board
                 * rather than sitting side by side under it. They are the page's
                 * secondary surfaces — neither can name a mora — and as a full
                 * row of their own they took the width of the group while the
                 * board, which at least points at a key, had none of it.
                 *
                 * The wrapper carries `panel` as well as `panel-stack` because
                 * `.stats-grid > .panel` is what sets the single-column default;
                 * without it the wrapper would fall to one grid column below the
                 * first breakpoint instead of spanning the row.
                 */}
                <div class="panel panel-stack panel--span-6">
                  <section class="panel">
                    <h3>most confused</h3>
                    <div class="bar-list">
                      <For
                        each={topConfusions()}
                        fallback={<p class="muted">No confused pairs yet.</p>}
                      >
                        {([pair, count]) => (
                          <div class="bar-row">
                            <span>{pair}</span>
                            <meter
                              class="meter--error"
                              min="0"
                              max={Math.max(1, topConfusions()[0]?.[1] ?? 1)}
                              value={count}
                            />
                            <b>{count}</b>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>
                  <section class="panel">
                    <h3>slowest pairs</h3>
                    <div class="bar-list">
                      <For
                        each={slowBigrams()}
                        fallback={<p class="muted">No pair timing yet.</p>}
                      >
                        {([pair, stat]) => (
                          <div class="bar-row">
                            <span>{pair.replaceAll(" ", "␣")}</span>
                            <meter
                              class="meter--neutral"
                              min="0"
                              max={Math.max(
                                1,
                                slowBigrams()[0]?.[1].avgMs ?? 1,
                              )}
                              value={stat.avgMs}
                            />
                            <b>{Math.round(stat.avgMs)} ms</b>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </section>
        </Show>

        <Show when={route() === "library"}>
          <section class="page library">
            {/* Held to the reading measure inside a wider page. The lists want
                the window; a paragraph does not. */}
            <div class="library__intro">
              <h1 class="library__title">library</h1>
              <p class="muted">
                Everything you can type, one text at a time. Picking one
                practises that text and stops at the end of it, with no clock —
                the timer is for dealing from a pool, which is what the source
                buttons on the practice page do.
              </p>
            </div>
            <Show when={libraryMessage()}>
              {(message) => (
                <p class="notice" role="status" aria-live="polite">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={reviews() === null}>
              {/* Side by side, because stacked they made one very long page:
                  thirty-five sentences in a single column pushed everything
                  else — including the way to add your own — below the fold.
                  Three collections, three columns, one row. */}
              <div class="library-columns">
                <section class="library-col">
                  <h2>
                    sentences <span class="count">{singles().length}</span>
                  </h2>
                  <button
                    type="button"
                    class="skip-list"
                    onClick={() => textsHeading?.focus()}
                  >
                    skip the sentences
                  </button>
                  {/* Scrolls rather than running down the page. The list is
                      long by design and getting longer. */}
                  <div class="text-list text-list--scroll">
                    <For each={singles()}>
                      {(text) => (
                        <button
                          type="button"
                          class="text-row"
                          onClick={() => practiseText(text)}
                        >
                          <Furigana items={text.items} />
                          <span class="text-row__go" aria-hidden="true" />
                        </button>
                      )}
                    </For>
                  </div>
                </section>

                <section class="library-col">
                  <h2 ref={(element) => (textsHeading = element)} tabindex="-1">
                    texts <span class="count">{passages().length}</span>
                  </h2>
                  <div class="text-list text-list--passages">
                    <For each={passages()}>
                      {(text) => (
                        /*
                         * Named by its title, described by the rest. Without
                         * this the button's accessible name is everything
                         * inside it — "Moving house 先週 せんしゅう 新しい …
                         * 7 sentences" — because a name is computed from
                         * content, and a ruby base and its reading both count.
                         * A passage has a title, so there is a right answer
                         * here and no need to guess at one.
                         *
                         * The sentence rows below have no title, so their
                         * content IS their name and they are left alone.
                         */
                        <button
                          type="button"
                          class="text-row"
                          aria-labelledby={`text-${text.id}-title`}
                          aria-describedby={`text-${text.id}-line text-${text.id}-count`}
                          onClick={() => practiseText(text)}
                        >
                          <span class="text-row__body">
                            <b
                              class="text-row__title"
                              id={`text-${text.id}-title`}
                            >
                              {text.title}
                            </b>
                            {/* The opening line only. Enough to recognise it
                                by; the rest is on the practice screen, which
                                is where it is meant to be read. */}
                            <Furigana
                              items={text.items.slice(0, 1)}
                              id={`text-${text.id}-line`}
                            />
                            <span
                              class="muted text-row__meta"
                              id={`text-${text.id}-count`}
                            >
                              {text.items.length} sentences
                            </span>
                          </span>
                          <span class="text-row__go" aria-hidden="true" />
                        </button>
                      )}
                    </For>
                  </div>
                </section>

                {/* Your own texts are the third column, not a strip under the
                    other two, and the way to add one closes it: the button is
                    the last thing in the list it extends. */}
                <section class="library-col">
                  <h2>
                    your texts <span class="count">{library().length}</span>
                  </h2>
                  <Show when={library().length > 0}>
                    <button
                      type="button"
                      class="skip-list"
                      onClick={() =>
                        (addingText() ? composeInput : addButton)?.focus()
                      }
                    >
                      skip your saved texts
                    </button>
                  </Show>
                  {/* Bounded like the sentences, for the same reason: this one
                      holds up to `LIBRARY_LIMIT` entries, and unbounded it was
                      the one column that could push the page down again. Short
                      lists are unaffected — the cap only caps. */}
                  <div class="text-list text-list--scroll">
                    <For
                      each={libraryTexts(library())}
                      fallback={
                        <p class="muted">
                          Nothing yet. Add one below and it joins this list.
                        </p>
                      }
                    >
                      {(text) => (
                        <button
                          type="button"
                          class="text-row"
                          onClick={() => practiseText(text)}
                        >
                          <Furigana items={text.items} />
                          <span class="text-row__go" aria-hidden="true" />
                        </button>
                      )}
                    </For>
                  </div>
                  {/* The paste box replaces the button that opens it, inside the
                      column the saved texts are in. It used to open below all
                      three columns: on a wide window that put the box most of a
                      screen away from the list it was going to add to, and left
                      this column visibly unchanged, so the only sign the button
                      had done anything was the page getting taller. List,
                      button and box are one stack now. */}
                  <Show
                    when={addingText()}
                    fallback={
                      <button
                        type="button"
                        class="library-add"
                        ref={(element) => (addButton = element)}
                        onClick={() => openCompose()}
                      >
                        <span class="library-add__plus" aria-hidden="true">
                          +
                        </span>
                        add your own text
                      </button>
                    }
                  >
                    <div class="library__compose">
                      <p class="muted">
                        Paste Japanese — a line, a sentence or a paragraph. Kana
                        spells itself, in either script. Kanji cannot, so the next
                        screen asks you for its reading in kana; the romaji is
                        worked out from what you give it, and you never type romaji
                        here.
                      </p>
                      <textarea
                        ref={(element) => {
                          composeInput = element;
                          /*
                           * The button that opened this unmounts as it opens, so
                           * without this the keyboard loses its place entirely —
                           * focus falls back to `<body>` and the next Tab starts
                           * from the top of the page. Focusing the box puts the
                           * caret where the typing goes, and scrolls it into view
                           * if the column ran past the fold.
                           *
                           * In a microtask, not inline: Solid runs `ref` before the
                           * element is in the document, and `focus()` on a detached
                           * node is a no-op that fails silently — it left the
                           * focus on `<body>`, which is what this is for.
                           */
                          queueMicrotask(() => element.focus());
                        }}
                        value={customText()}
                        onInput={(event) =>
                          setCustomText(event.currentTarget.value)
                        }
                        placeholder={
                          "おはよう\nねこ いぬ\nコーヒー\n今日はいい天気です\n公園でコーヒーを飲みました"
                        }
                      />
                      <div class="action-row">
                        <button
                          type="button"
                          class="primary"
                          onClick={() => beginReview(customText())}
                        >
                          check the readings
                        </button>
                        <label class="file-button">
                          upload .txt/.md
                          <input
                            type="file"
                            accept=".txt,.md,text/plain,text/markdown"
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              if (file) void handleFile(file);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          class="secondary"
                          onClick={() => closeCompose()}
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  </Show>
                </section>
              </div>
            </Show>

            <Show when={reviews()}>
              {(list) => (
                <div class="review">
                  <h2>check the readings</h2>
                  <p class="muted">
                    Fill in the empty boxes and this becomes practice text.
                    Each one wants the kanji above it read in kana; the kana
                    boxes are filled in already, though you may want to change
                    one where a は or へ is a particle, since those are said わ
                    and え. The romaji under each line is what you will type.
                  </p>
                  {/* `Index` and not `For`: these rows are edited in place, and
                      keying them by content would rebuild the input under the
                      cursor on every keystroke. */}
                  <Index each={list()}>
                    {(review, line) => (
                      <div class="review-line">
                        <div class="review-line__segments">
                          <Index each={review().segments}>
                            {(segment, at) => (
                              <label
                                classList={{
                                  "review-seg": true,
                                  "review-seg--needs": segment().needsReading,
                                  "review-seg--particle": mayHideParticle(
                                    segment(),
                                  ),
                                }}
                              >
                                <b>{segment().text}</b>
                                <input
                                  class="review-seg__reading"
                                  /* Written out, though "text" is the default:
                                     `input[type='text']` matches the attribute
                                     and not the default, so without this the
                                     themed focus edge skipped every box on this
                                     screen. */
                                  type="text"
                                  value={segment().reading}
                                  placeholder={
                                    segment().needsReading ? "かな" : ""
                                  }
                                  aria-label={`reading for ${segment().text}`}
                                  /* `em` and not the `size` attribute, which
                                     counts in `0` widths: a kana glyph is
                                     about twice that, so a box sized for its
                                     own three characters clipped them. */
                                  style={{
                                    "inline-size": `calc(${Math.max(
                                      2,
                                      segment().text.length,
                                      segment().reading.length,
                                    )}em + var(--space-6))`,
                                  }}
                                  onInput={(event) =>
                                    editReading(
                                      line,
                                      at,
                                      event.currentTarget.value,
                                    )
                                  }
                                />
                              </label>
                            )}
                          </Index>
                        </div>
                        <p class="review-line__romaji">
                          <Show
                            when={reviewRomaji(review())}
                            fallback={
                              <span class="muted">{reviewHint(review())}</span>
                            }
                          >
                            {(romaji) => <code>{romaji()}</code>}
                          </Show>
                        </p>
                      </div>
                    )}
                  </Index>
                  <div class="action-row">
                    <button
                      type="button"
                      class="primary"
                      disabled={reviewedItems().length === 0}
                      onClick={saveReviewed}
                    >
                      {reviewAction()}
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => setReviews(null)}
                    >
                      back to the text
                    </button>
                  </div>
                </div>
              )}
            </Show>
          </section>
        </Show>

        <Show when={route() === "settings"}>
          <section class="page page--narrow">
            <h1>settings</h1>
            <label class="field">
              <span>paragraph length</span>
              <input
                type="range"
                min="3"
                max="30"
                value={settings().paragraphItems}
                onInput={(event) =>
                  updateParagraphLength(Number(event.currentTarget.value))
                }
              />
              <b>{settings().paragraphItems} items per run</b>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().stopOnError}
                onChange={(event) =>
                  setStopOnError(event.currentTarget.checked)
                }
              />
              <span>
                stop on error — refuse a wrong key instead of typing it
              </span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().timedMode}
                onChange={(event) => setTimedMode(event.currentTarget.checked)}
              />
              <span>
                timed mode — run for 60 seconds instead of to the end of the
                passage
              </span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().confidenceMode}
                onChange={(event) =>
                  setConfidenceMode(event.currentTarget.checked)
                }
              />
              <span>
                confidence mode — no backspace, every keystroke commits
              </span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings().whitespaceMarkers}
                onChange={(event) =>
                  setWhitespaceMarkers(event.currentTarget.checked)
                }
              />
              <span>mark the spaces between words</span>
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={showKeyboard()}
                onChange={(event) =>
                  setKeyboardVisible(event.currentTarget.checked)
                }
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

            <h2>your data</h2>
            <p class="muted">
              Everything is stored in this browser and never leaves it. Export
              to keep a copy or move to another machine.
            </p>
            <div class="action-row">
              <button
                type="button"
                class="secondary"
                onClick={() => void exportData()}
              >
                export
              </button>
              <label class="file-button secondary">
                import
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void importData(file);
                    event.currentTarget.value = "";
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
                {resetArmed() ? "really erase everything?" : "reset"}
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

        <TooltipLayer />
      </main>
    </Show>
  );
}

export default App;
