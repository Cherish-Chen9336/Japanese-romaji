import type { JSX } from 'solid-js'
import { Show } from 'solid-js'

/**
 * Provisional site name — Ella wants to settle on this later. It is deliberately
 * split into two spans so the wordmark and the suffix can be styled apart, the
 * way `TYPE` / `.review` is in type-review. Change these two strings (and the
 * `<title>` in index.html) and the whole brand moves.
 */
export const BRAND_NAME = 'KANA'
export const BRAND_SUFFIX = '.type'

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
  onHomeClick: () => void
}

/** Application top bar: brand button on the left, live metrics on the right. */
export function Topbar(props: TopbarProps): JSX.Element {
  return (
    <header class="topbar">
      <button type="button" class="logo" onClick={() => props.onHomeClick()} aria-label="home">
        <BrandMark />
        <b>{BRAND_NAME}</b>
        <small>{BRAND_SUFFIX}</small>
      </button>
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
 * Keyboard outline, sized in `em` so it scales with the logo's font size and
 * inheriting `currentColor` from the accent-coloured wordmark next to it.
 */
function BrandMark(): JSX.Element {
  return (
    <svg
      class="logo__mark"
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M7 16h10" />
    </svg>
  )
}
