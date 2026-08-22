import type { Accessor, JSX } from 'solid-js'
import { For, Show, onCleanup, onMount } from 'solid-js'
import type { KeyboardLayoutName } from '../engine/types'
import { KEYBOARD_LAYOUTS, type KeyDef } from './keyboard-layouts'

export interface OnScreenKeyboardProps {
  /** Which physical layout to render. */
  layout: KeyboardLayoutName
  /**
   * Currently-held `KeyboardEvent.code` values. Sourced from the app root's
   * keydown/keyup listeners — this component attaches no window listeners of
   * its own, so there is exactly one source of truth for "what keys are held".
   */
  pressed: Accessor<ReadonlySet<string>>
}

function KeyIcon(props: { icon: KeyDef['icon'] }): JSX.Element {
  if (props.icon === 'win-logo') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 5.5l8-1.1v7.1H3V5.5zm0 13l8 1.1v-7.1H3v6zm9 1.2l12 1.6v-8.7H12v7.1zm0-15.5v7.2h12V2.5L12 4.2z" />
      </svg>
    )
  }
  if (props.icon === 'maximize') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="16" rx="1" />
      </svg>
    )
  }
  if (props.icon === 'touch-id') {
    // Sized via CSS (`.kb__key__icon--touch-id`) so the diameter scales with
    // the cap's `--u` and stays geometrically centered.
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        class="kb__key__icon--touch-id"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    )
  }
  return null
}

// Scale-to-fit. The keyboard renders at a FIXED natural size (`--u: 22px` plus
// an explicit `width` in CSS) so its dimensions don't depend on any browser's
// intrinsic-sizing quirks. A ResizeObserver measures the wrapper's available
// width and applies `transform: scale(wrapperW / NATURAL_WIDTH)`; the wrapper's
// height is then set to the scaled visual height so the layout collapses to
// what's actually drawn.
//
// 388px = 15u + 13×3px gap + 2×0.35u padding + 2px border at --u=22, rounded up
// for headroom so the widest row can't clip a sliver of its last key.
const NATURAL_WIDTH = 388
// Cap upscale so a wide desktop doesn't render an absurdly large keyboard; cap
// downscale so a narrow phone still renders something legible.
const MAX_SCALE_UP = 1.5
const MIN_SCALE = 0.4

/**
 * Full ANSI keyboard visualisation, mac- or windows-variant. Ported from
 * type-review's `OnScreenKeyboard`, minus the per-key mastery heatmap (this app
 * has no lesson plan to colour caps by).
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
        class={`kb kb--${props.layout}`}
        aria-label={`${props.layout} keyboard`}
        ref={(el) => {
          kbRef = el as HTMLElement
        }}
      >
        <For each={KEYBOARD_LAYOUTS[props.layout]}>
          {(row) => (
            <div class="kb__row">
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
                      <span class="kb__key__label">
                        <Show when={key.icon} fallback={key.label}>
                          <KeyIcon icon={key.icon} />
                        </Show>
                      </span>
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
