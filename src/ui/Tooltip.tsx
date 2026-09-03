import { Show, createSignal } from 'solid-js'

/**
 * One tooltip element for the whole page, driven by a signal.
 *
 * These were native `title` attributes, which the operating system draws and CSS
 * cannot touch — so they could not be styled at all, appeared after a delay, and
 * on a touch screen never appeared. Since the numbers on the kana chart, the
 * keyboard and the calendar live *only* in their tooltip, that made them
 * unreachable on a phone entirely.
 *
 * A single shared element rather than one per cell: the chart alone has over a
 * hundred, and none of them are visible at once.
 */

type Tip = { text: string; x: number; y: number }

const [tip, setTip] = createSignal<Tip | null>(null)

const GAP = 14

/**
 * Handlers for anything that carries a tooltip. Pointer and focus both, so the
 * detail is reachable by keyboard, and `pointerdown` so a tap shows it rather
 * than requiring a hover the device cannot do.
 */
export function tipFor(text: () => string) {
  const show = (event: { clientX: number; clientY: number }) =>
    setTip({ text: text(), x: event.clientX, y: event.clientY })
  const showAt = (event: FocusEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setTip({ text: text(), x: box.left + box.width / 2, y: box.top })
  }
  return {
    onPointerEnter: show,
    onPointerMove: show,
    onPointerDown: show,
    onPointerLeave: () => setTip(null),
    onFocus: showAt,
    onBlur: () => setTip(null),
  }
}

export function TooltipLayer() {
  /* Kept inside the viewport: a cell at the right edge would otherwise push its
     tooltip off-screen, which is where the interesting kana tend to be. */
  const left = () => {
    const t = tip()
    if (t === null) return 0
    const half = 130
    return Math.min(Math.max(t.x, half + 8), window.innerWidth - half - 8)
  }

  return (
    <Show when={tip()}>
      {(t) => (
        <div
          class="tooltip"
          role="presentation"
          style={{ left: `${left()}px`, top: `${t().y - GAP}px` }}
        >
          {t()
            .text.split(' · ')
            .map((part, index) => (
              <span classList={{ tooltip__lead: index === 0 }}>{part}</span>
            ))}
        </div>
      )}
    </Show>
  )
}
