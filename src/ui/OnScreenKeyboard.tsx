import type { Accessor, JSX } from 'solid-js'
import { For, Show, onCleanup, onMount } from 'solid-js'
import { KEYBOARD_ROWS } from './keyboard-layouts'

export interface OnScreenKeyboardProps {
  /**
   * Currently-held `KeyboardEvent.code` values. Sourced from the app root's
   * keydown/keyup listeners — this component attaches no window listeners of
   * its own, so there is exactly one source of truth for "what keys are held".
   */
  pressed: Accessor<ReadonlySet<string>>
}

// Scale-to-fit. The keyboard renders at a FIXED natural size (`--u: 22px` plus
// an explicit `width` in CSS) so its dimensions don't depend on any browser's
// intrinsic-sizing quirks. A ResizeObserver measures the wrapper's available
// width and applies `transform: scale(wrapperW / NATURAL_WIDTH)`; the wrapper's
// height is then set to the scaled visual height so the layout collapses to
// what's actually drawn.
//
// 393px = 15u + 13×3px gap + 2×0.46u padding + 2px border at --u=22, rounded up
// for headroom so the widest row can't clip a sliver of its last key. The
// padding is 0.46u rather than the old 0.35u: a wider bezel and a larger corner
// radius are most of what makes a board read as a laptop rather than a desktop.
const NATURAL_WIDTH = 393
// Cap upscale so a wide desktop doesn't render an absurdly large keyboard; cap
// downscale so a narrow phone still renders something legible.
const MAX_SCALE_UP = 1.5
const MIN_SCALE = 0.4

/**
 * The practice keyboard: one combined laptop board, drawn for orientation and
 * pressed-state feedback and nothing else.
 *
 * Deliberately carries no per-key mastery colour — see "Deliberately not built"
 * in AGENTS.md. One Latin key types many moras, so a tinted cap cannot say
 * which mora is at fault; mastery lives on the 五十音 grid instead.
 *
 * Intentionally a pure render — no DOM event listeners here.
 */
export function OnScreenKeyboard(props: OnScreenKeyboardProps): JSX.Element {
  let wrapperRef: HTMLDivElement | undefined
  let kbRef: HTMLElement | undefined

  onMount(() => {
    if (!wrapperRef || !kbRef) return
    // jsdom and very old browsers don't expose ResizeObserver — skip the
    // auto-scale and let the keyboard render at its natural fixed size.
    if (typeof ResizeObserver === 'undefined') return
    const wrapper = wrapperRef
    const kb = kbRef
    const update = (): void => {
      const wrapperW = wrapper.clientWidth
      if (wrapperW === 0) return
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE_UP, wrapperW / NATURAL_WIDTH))
      kb.style.setProperty('--kb-scale', String(scale))
      // Measure the POST-transform height via getBoundingClientRect — it
      // returns the scaled box with sub-pixel precision. (`offsetHeight ×
      // scale` rounds the natural height to an integer first and lands ~0.5px
      // short, letting the next element cover the keyboard's bottom edge.)
      wrapper.style.height = `${Math.ceil(kb.getBoundingClientRect().height)}px`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div class="kb-scale" ref={wrapperRef}>
      <section
        class="kb"
        aria-label="keyboard"
        ref={(el) => {
          kbRef = el as HTMLElement
        }}
      >
        <For each={KEYBOARD_ROWS}>
          {(row, rowIndex) => (
            // Row 0 is the function row and is drawn at half height.
            <div class="kb__row" classList={{ 'kb__row--fn': rowIndex() === 0 }}>
              <For each={row}>
                {(key) => {
                  const isPressed = () => (key.codes ?? []).some((code) => props.pressed().has(code))
                  return (
                    <div
                      class="kb__key"
                      classList={{
                        'kb__key--mod': key.variant === 'mod',
                        'kb__key--space': key.variant === 'space',
                        'kb__key--pressed': isPressed(),
                        'kb__key--align-start': key.align === 'start',
                        'kb__key--align-end': key.align === 'end',
                        'kb__key--dual': key.shifted !== undefined,
                      }}
                      data-key={key.id}
                      style={{ '--w': String(key.width) }}
                      aria-hidden="true"
                    >
                      <Show when={key.shifted}>
                        {(shifted) => <span class="kb__key__shifted">{shifted()}</span>}
                      </Show>
                      <span class="kb__key__label">{key.label}</span>
                      <Show when={key.sub}>{(sub) => <span class="kb__key__sub">{sub()}</span>}</Show>
                    </div>
                  )
                }}
              </For>
            </div>
          )}
        </For>
      </section>
    </div>
  )
}
