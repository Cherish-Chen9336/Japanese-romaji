import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import './App.css'
import { generateLesson, parseLibraryText, sourceOptions, sourceUnlocked } from './engine/lessons'
import { applyBackspace, applyTypeChar, buildRunResult, computeMetrics, emptySession } from './engine/session'
import type { SessionState } from './engine/session'
import {
  dailyCounts,
  mergeTimingStats,
  newlyReachedMilestones,
  recentDayKeys,
  recordRunInLifetimeStats,
  runRawWpm,
  runWpm,
  sourceBreakdown,
  streakStats,
  topTimingStats,
  unlockedMilestones,
  wpmDistribution,
} from './engine/stats'
import type { Lesson, LifetimeStats, RunResult, Settings, SourceName, TextItem, Unlock } from './engine/types'
import {
  CONFUSIONS_KEY,
  LIBRARY_KEY,
  LIFETIME_KEY,
  MISSES_KEY,
  RUNS_KEY,
  SETTINGS_KEY,
  SHOW_KEYBOARD_KEY,
  readConfusionMap,
  readLibrary,
  readLifetimeStats,
  readMissMap,
  readRuns,
  readSettings,
  readShowKeyboard,
} from './io/persistence'
import { writeJson } from './io/storage'
import { routeFromHash, type RouteName } from './ui/router'

type KeyDef = {
  code: string
  label: string
  width?: number
  variant?: 'mod' | 'space'
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

function App() {
  const [route, setRoute] = createSignal<RouteName>(routeFromHash())
  const [settings, setSettings] = createSignal<Settings>(readSettings())
  const [runs, setRuns] = createSignal<RunResult[]>(readRuns())
  const [lifetimeStats, setLifetimeStats] = createSignal<LifetimeStats>(readLifetimeStats())
  const [missMap, setMissMap] = createSignal<Record<string, number>>(readMissMap())
  const [confusionMap, setConfusionMap] = createSignal<Record<string, number>>(readConfusionMap())
  const [library, setLibrary] = createSignal<TextItem[]>(readLibrary())
  const [source, setSource] = createSignal<SourceName>('auto')
  const [lesson, setLesson] = createSignal<Lesson>(
    generateLesson('auto', settings(), missMap(), library()),
  )
  const [session, setSession] = createSignal<SessionState>(emptySession())
  const [tick, setTick] = createSignal(Date.now())
  const [pressedKeys, setPressedKeys] = createSignal<ReadonlySet<string>>(new Set())
  const [showKeyboard, setShowKeyboard] = createSignal(readShowKeyboard())
  const [customText, setCustomText] = createSignal('')
  const [lastRun, setLastRun] = createSignal<RunResult | null>(runs()[0] ?? null)
  const [resultUnlocks, setResultUnlocks] = createSignal<Unlock[]>([])

  let hiddenInput: HTMLInputElement | undefined
  let savedCurrentRun = false

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
  const isComplete = createMemo(() => session().pos === expected().length)
  const metrics = createMemo(() => computeMetrics(session(), tick()))
  const accuracy = () => metrics().accuracy
  const speed = () => metrics().wpm

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
  const bestWpm = createMemo(() => lifetimeStats().bestWpm)
  const milestones = createMemo(() => unlockedMilestones(lifetimeStats()))
  const totalMinutes = createMemo(() => Math.round(lifetimeStats().totalElapsedMs / 60_000))
  const totalSessions = createMemo(() => lifetimeStats().totalSessions)
  const sourceStats = createMemo(() => sourceBreakdown(runs()))
  const dayStats = createMemo(() => dailyCounts(runs()))
  const resultRun = createMemo(() => lastRun() ?? runs()[0] ?? null)
  const keyStats = createMemo(() => mergeTimingStats(runs(), 'keyStats'))
  const bigramStats = createMemo(() => mergeTimingStats(runs(), 'bigramStats'))
  const slowKeys = createMemo(() => topTimingStats(keyStats(), 12))
  const slowBigrams = createMemo(() => topTimingStats(bigramStats(), 8))
  const streaks = createMemo(() => streakStats(lifetimeStats().streakDays))
  const distribution = createMemo(() => wpmDistribution(runs()))

  const navigate = (next: RouteName) => {
    window.location.hash = next === 'practice' ? '#/practice' : `#/${next}`
    setRoute(next)
  }

  const resetRunState = () => {
    savedCurrentRun = false
    setSession(emptySession())
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
    if (savedCurrentRun) return null
    savedCurrentRun = true
    const currentSession = session()
    const currentLesson = lesson()
    const currentMetrics = computeMetrics(currentSession, Date.now())
    const run = buildRunResult(currentSession, currentLesson, currentMetrics)
    setLastRun(run)
    const previousLifetime = lifetimeStats()
    const nextLifetime = recordRunInLifetimeStats(previousLifetime, run)
    setResultUnlocks(newlyReachedMilestones(previousLifetime, nextLifetime))
    setLifetimeStats(() => {
      writeJson(LIFETIME_KEY, nextLifetime)
      return nextLifetime
    })
    const nextRuns = [run, ...runs()].slice(0, 100)
    setRuns(() => {
      writeJson(RUNS_KEY, nextRuns)
      return nextRuns
    })
    return run
  }

  const typeChar = (rawChar: string) => {
    if (isComplete() || route() !== 'practice') return
    const result = applyTypeChar(session(), rawChar, expected(), Date.now())
    setSession(result.session)
    if (result.missed) {
      const { target, typed } = result.missed
      setMissMap((current) => {
        const key = target === ' ' ? 'space' : target
        const next = { ...current, [key]: (current[key] ?? 0) + 1 }
        writeJson(MISSES_KEY, next)
        return next
      })
      setConfusionMap((current) => {
        const expectedKey = target === ' ' ? 'space' : target
        const typedKey = typed === ' ' ? 'space' : typed
        const pair = `${expectedKey} → ${typedKey}`
        const next = { ...current, [pair]: (current[pair] ?? 0) + 1 }
        writeJson(CONFUSIONS_KEY, next)
        return next
      })
    }
    if (result.completed) {
      setTimeout(() => {
        saveCurrentRun()
        navigate('result')
      }, 0)
    }
  }

  const backspace = () => {
    setSession(applyBackspace)
  }

  const setKeyboardVisible = (visible: boolean) => {
    writeJson(SHOW_KEYBOARD_KEY, visible)
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
          <b>{session().mistakes}</b> miss
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
                    if (session().pos >= current.end) return 'done'
                    if (session().pos >= current.start && session().pos <= current.end) return 'current'
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
                      'char--correct': session().statuses[index()] === 'correct',
                      'char--incorrect': session().statuses[index()] === 'incorrect',
                      'char--current': index() === session().pos,
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
                {totalSessions()} sessions · {totalMinutes()} min typing
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
