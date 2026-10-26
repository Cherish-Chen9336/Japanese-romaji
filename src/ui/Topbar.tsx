import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { PrimaryNav } from './PrimaryNav'
import type { RouteName } from './router'

/**
 * Provisional site name — Ella wants to settle on this later. It is deliberately
 * split into separate strings so the tile, the wordmark, the full stop and the
 * line beneath them can be styled apart. Change these four (and the `<title>` in
 * index.html) and the whole brand moves.
 */
export const BRAND_GLYPH = 'か'
export const BRAND_NAME = 'kana'
export const BRAND_SUFFIX = '.'
export const BRAND_TAGLINE = 'Japanese typing practice'

export interface TopbarProps {
  wpm: number
  accuracy: number
  mistakes: number
  /** Show the live-metrics block only while the practice view is active. */
  showLive: boolean
  /**
   * Seconds left in a timed run, or null when the run is not timed — and before
   * the first keystroke, because the clock starts when the typist does.
   */
  secondsLeft: number | null
  /** Current route, so the nav in the middle column can mark its own entry. */
  route: RouteName
  onNavigate: (route: RouteName) => void
  onHomeClick: () => void
}

/**
 * Application top bar: brand on the left, primary navigation on the page's
 * centre line, live metrics on the right.
 */
export function Topbar(props: TopbarProps): JSX.Element {
  return (
    <header class="topbar">
      {/* The label carries the visible wordmark, not just "home". `aria-label`
          overrides the text inside the button, so a reader who says "click
          kana" was asking for a name the button did not have — WCAG's Label in
          Name. The tagline stays out of it: it is a description, and repeating
          it would make the name longer than anything anyone would say. */}
      <button
        type="button"
        class="logo"
        onClick={() => props.onHomeClick()}
        aria-label={`${BRAND_NAME}${BRAND_SUFFIX} home`}
      >
        <BrandMark />
        <span class="logo__name">
          <span class="logo__word">
            <b>{BRAND_NAME}</b>
            <small>{BRAND_SUFFIX}</small>
          </span>
          <span class="logo__tagline">{BRAND_TAGLINE}</span>
        </span>
      </button>
      <PrimaryNav active={props.route} onNavigate={props.onNavigate} />
      <Show when={props.showLive}>
        <div class="live" aria-label="live stats">
          <span>
            <b>{props.wpm}</b> wpm
          </span>
          <span>
            <b>{props.accuracy}</b>% acc
          </span>
          <span>
            <b>{props.mistakes}</b> miss
          </span>
          {/* Leads the row when present: in a timed run it is the number that
              decides what you do next. */}
          <Show when={props.secondsLeft !== null}>
            <span class="live__clock" classList={{ 'is-low': (props.secondsLeft ?? 0) <= 10 }}>
              <b>{props.secondsLeft}</b>s left
            </span>
          </Show>
        </div>
      </Show>
    </header>
  )
}

/**
 * Brand mark — a filled tile carrying か. It replaced a stroked keyboard
 * outline: the outline said "typing" but could have belonged to any typing app,
 * and at logo size its eight dots closed up into mush. A single kana says which
 * language before the wordmark is read.
 *
 * か and not あ, which is where the gojūon actually starts. あ is a vowel and
 * draws as one, so at tile size it reads as a mark rather than as writing; か
 * has the consonant stroke and the two that cross it, and it heads the first
 * row anyone drills after the vowels. An earlier version of this comment called
 * it "the first kana of the syllabary", which it is not.
 *
 * Plain text in a styled box rather than an SVG path, so the glyph comes from
 * `--font-jp` and is picked by the same font stack that draws the practice line
 * — nothing to redraw if that stack changes.
 */
function BrandMark(): JSX.Element {
  return (
    <span class="logo__tile" aria-hidden="true">
      {BRAND_GLYPH}
    </span>
  )
}
