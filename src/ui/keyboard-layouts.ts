/**
 * Full 6-row ANSI keyboard layouts, ported from type-review's
 * `ui/components/keyboard-layouts.ts`.
 *
 * The two layouts share rows 2-5 (number / tab / caps / shift) and diverge on
 * the function row and the bottom modifier row. Each key is a `KeyDef`; `codes`
 * lists the `KeyboardEvent.code` values that drive its pressed-state. Keys with
 * no code (Touch ID, Print Screen) simply never light up.
 *
 * This is layout DATA, not logic — pure and side-effect free, but it lives in
 * `ui/` rather than `engine/` because it only ever describes how to draw the
 * on-screen keyboard.
 */

import type { KeyboardLayoutName } from '../engine/types'

export type KeyVariant = 'mod' | 'space'
export type KeyIcon = 'win-logo' | 'maximize' | 'touch-id'

export interface KeyDef {
  /** Stable per-key handle. For letters/digits this matches the keystroke. */
  id: string
  /** What renders on the cap. */
  label: string
  /** Optional smaller subtitle below the label (`control`, `⇪`, etc.). */
  sub?: string
  /**
   * The character produced when Shift is held — drawn as a smaller line above
   * the main label (`!` above `1`, `<` above `,`). Mirrors physical ANSI caps.
   */
  shifted?: string
  /** Width in `u`. 1u = base cap. */
  width: number
  /** `KeyboardEvent.code` values that drive pressed-state. */
  codes?: readonly string[]
  /** Style hint: `mod` (smaller dim text), `space` (spacebar). */
  variant?: KeyVariant
  /** Render an inline SVG instead of the text label. */
  icon?: KeyIcon
  /**
   * Horizontal alignment of the label + sub stack within the cap. Defaults to
   * centered; mac modifier caps hug the outer edge like real Apple keycaps.
   */
  align?: 'start' | 'end'
}

/* ---- shared rows ------------------------------------------------------- */

const FUNCTION_ROW_BASE: readonly KeyDef[] = [
  { id: 'esc', label: 'esc', width: 2, codes: ['Escape'], variant: 'mod' },
  ...Array.from({ length: 12 }, (_, i): KeyDef => {
    const n = i + 1
    return { id: `f${n}`, label: `F${n}`, width: 1, codes: [`F${n}`], variant: 'mod' }
  }),
]

const NUMBER_ROW: readonly KeyDef[] = [
  { id: '`', label: '`', shifted: '~', width: 1, codes: ['Backquote'] },
  { id: '1', label: '1', shifted: '!', width: 1, codes: ['Digit1'] },
  { id: '2', label: '2', shifted: '@', width: 1, codes: ['Digit2'] },
  { id: '3', label: '3', shifted: '#', width: 1, codes: ['Digit3'] },
  { id: '4', label: '4', shifted: '$', width: 1, codes: ['Digit4'] },
  { id: '5', label: '5', shifted: '%', width: 1, codes: ['Digit5'] },
  { id: '6', label: '6', shifted: '^', width: 1, codes: ['Digit6'] },
  { id: '7', label: '7', shifted: '&', width: 1, codes: ['Digit7'] },
  { id: '8', label: '8', shifted: '*', width: 1, codes: ['Digit8'] },
  { id: '9', label: '9', shifted: '(', width: 1, codes: ['Digit9'] },
  { id: '0', label: '0', shifted: ')', width: 1, codes: ['Digit0'] },
  { id: '-', label: '-', shifted: '_', width: 1, codes: ['Minus'] },
  { id: '=', label: '=', shifted: '+', width: 1, codes: ['Equal'] },
]

const TAB_ROW: readonly KeyDef[] = [
  { id: 'q', label: 'q', width: 1, codes: ['KeyQ'] },
  { id: 'w', label: 'w', width: 1, codes: ['KeyW'] },
  { id: 'e', label: 'e', width: 1, codes: ['KeyE'] },
  { id: 'r', label: 'r', width: 1, codes: ['KeyR'] },
  { id: 't', label: 't', width: 1, codes: ['KeyT'] },
  { id: 'y', label: 'y', width: 1, codes: ['KeyY'] },
  { id: 'u', label: 'u', width: 1, codes: ['KeyU'] },
  { id: 'i', label: 'i', width: 1, codes: ['KeyI'] },
  { id: 'o', label: 'o', width: 1, codes: ['KeyO'] },
  { id: 'p', label: 'p', width: 1, codes: ['KeyP'] },
  { id: '[', label: '[', shifted: '{', width: 1, codes: ['BracketLeft'] },
  { id: ']', label: ']', shifted: '}', width: 1, codes: ['BracketRight'] },
]

const CAPS_ROW: readonly KeyDef[] = [
  { id: 'a', label: 'a', width: 1, codes: ['KeyA'] },
  { id: 's', label: 's', width: 1, codes: ['KeyS'] },
  { id: 'd', label: 'd', width: 1, codes: ['KeyD'] },
  { id: 'f', label: 'f', width: 1, codes: ['KeyF'] },
  { id: 'g', label: 'g', width: 1, codes: ['KeyG'] },
  { id: 'h', label: 'h', width: 1, codes: ['KeyH'] },
  { id: 'j', label: 'j', width: 1, codes: ['KeyJ'] },
  { id: 'k', label: 'k', width: 1, codes: ['KeyK'] },
  { id: 'l', label: 'l', width: 1, codes: ['KeyL'] },
  { id: ';', label: ';', shifted: ':', width: 1, codes: ['Semicolon'] },
  { id: "'", label: "'", shifted: '"', width: 1, codes: ['Quote'] },
]

const SHIFT_ROW: readonly KeyDef[] = [
  { id: 'z', label: 'z', width: 1, codes: ['KeyZ'] },
  { id: 'x', label: 'x', width: 1, codes: ['KeyX'] },
  { id: 'c', label: 'c', width: 1, codes: ['KeyC'] },
  { id: 'v', label: 'v', width: 1, codes: ['KeyV'] },
  { id: 'b', label: 'b', width: 1, codes: ['KeyB'] },
  { id: 'n', label: 'n', width: 1, codes: ['KeyN'] },
  { id: 'm', label: 'm', width: 1, codes: ['KeyM'] },
  { id: ',', label: ',', shifted: '<', width: 1, codes: ['Comma'] },
  { id: '.', label: '.', shifted: '>', width: 1, codes: ['Period'] },
  { id: '/', label: '/', shifted: '?', width: 1, codes: ['Slash'] },
]

/* ---- mac-specific ------------------------------------------------------ */

const MAC_FUNCTION_ROW: readonly KeyDef[] = [
  ...FUNCTION_ROW_BASE,
  // Touch ID — a large outlined circle mirroring the physical round button.
  { id: 'touchid', label: '', width: 1, variant: 'mod', icon: 'touch-id' },
]

// Row math: fn(1) + ctrl(1) + opt(1) + cmd(1.25) + space(6) + cmd2(1.75) +
//           opt2(1.5) + ctrl2(1.5) = 15u.
const MAC_BOTTOM_ROW: readonly KeyDef[] = [
  { id: 'fn', label: 'fn', width: 1, variant: 'mod' },
  { id: 'ctrl', label: '⌃', sub: 'control', width: 1, codes: ['ControlLeft'], variant: 'mod', align: 'start' },
  { id: 'opt', label: '⌥', sub: 'option', width: 1, codes: ['AltLeft'], variant: 'mod', align: 'start' },
  { id: 'cmd', label: '⌘', sub: 'command', width: 1.25, codes: ['MetaLeft'], variant: 'mod', align: 'start' },
  { id: 'space', label: ' ', width: 6, codes: ['Space'], variant: 'space' },
  { id: 'cmd2', label: '⌘', sub: 'command', width: 1.75, codes: ['MetaRight'], variant: 'mod', align: 'end' },
  { id: 'opt2', label: '⌥', sub: 'option', width: 1.5, codes: ['AltRight'], variant: 'mod', align: 'end' },
  { id: 'ctrl2', label: '⌃', sub: 'control', width: 1.5, codes: ['ControlRight'], variant: 'mod', align: 'end' },
]

/* ---- windows-specific -------------------------------------------------- */

const WIN_FUNCTION_ROW: readonly KeyDef[] = [
  ...FUNCTION_ROW_BASE,
  { id: 'prtsc', label: 'PrtSc', width: 1, variant: 'mod', icon: 'maximize' },
]

const WIN_BOTTOM_ROW: readonly KeyDef[] = [
  { id: 'ctrl', label: 'Ctrl', width: 1.25, codes: ['ControlLeft'], variant: 'mod' },
  { id: 'win', label: '', width: 1.25, codes: ['MetaLeft'], variant: 'mod', icon: 'win-logo' },
  { id: 'alt', label: 'Alt', width: 1.25, codes: ['AltLeft'], variant: 'mod' },
  { id: 'space', label: ' ', width: 6.25, codes: ['Space'], variant: 'space' },
  { id: 'altgr', label: 'Alt', width: 1.25, codes: ['AltRight'], variant: 'mod' },
  { id: 'win2', label: '', width: 1.25, codes: ['MetaRight'], variant: 'mod', icon: 'win-logo' },
  { id: 'menu', label: '≡', width: 1.25, codes: ['ContextMenu'], variant: 'mod' },
  { id: 'ctrl2', label: 'Ctrl', width: 1.25, codes: ['ControlRight'], variant: 'mod' },
]

/* ---- per-layout edge labels for rows 2-5 ------------------------------- */

interface EdgeKeys {
  backspace: KeyDef
  tab: KeyDef
  backslash: KeyDef
  caps: KeyDef
  enter: KeyDef
  lshift: KeyDef
  rshift: KeyDef
}

/**
 * Mac edge keys carry their glyph only — no spelled-out word — and hug the
 * outer edge of the keyboard: left-row caps align-start, right-row caps
 * align-end.
 */
function macEdges(): EdgeKeys {
  return {
    backspace: { id: 'backspace', label: '⌫', width: 2, codes: ['Backspace'], variant: 'mod', align: 'end' },
    tab: { id: 'tab', label: '⇥', width: 1.5, codes: ['Tab'], variant: 'mod', align: 'start' },
    backslash: { id: '\\', label: '\\', shifted: '|', width: 1.5, codes: ['Backslash'] },
    caps: { id: 'caps', label: '⇪', width: 1.75, codes: ['CapsLock'], variant: 'mod', align: 'start' },
    enter: { id: 'enter', label: '⏎', width: 2.25, codes: ['Enter'], variant: 'mod', align: 'end' },
    lshift: { id: 'lshift', label: '⇧', width: 2.25, codes: ['ShiftLeft'], variant: 'mod', align: 'start' },
    rshift: { id: 'rshift', label: '⇧', width: 2.75, codes: ['ShiftRight'], variant: 'mod', align: 'end' },
  }
}

function winEdges(): EdgeKeys {
  return {
    backspace: { id: 'backspace', label: 'Backspace', width: 2, codes: ['Backspace'], variant: 'mod' },
    tab: { id: 'tab', label: 'Tab', width: 1.5, codes: ['Tab'], variant: 'mod' },
    backslash: { id: '\\', label: '\\', shifted: '|', width: 1.5, codes: ['Backslash'] },
    caps: { id: 'caps', label: 'Caps', sub: '⇪', width: 1.75, codes: ['CapsLock'], variant: 'mod' },
    enter: { id: 'enter', label: 'Enter', width: 2.25, codes: ['Enter'], variant: 'mod' },
    lshift: { id: 'lshift', label: 'Shift', width: 2.25, codes: ['ShiftLeft'], variant: 'mod' },
    rshift: { id: 'rshift', label: 'Shift', width: 2.75, codes: ['ShiftRight'], variant: 'mod' },
  }
}

function buildLayout(
  functionRow: readonly KeyDef[],
  bottomRow: readonly KeyDef[],
  edges: EdgeKeys,
): readonly (readonly KeyDef[])[] {
  return [
    functionRow,
    [...NUMBER_ROW, edges.backspace],
    [edges.tab, ...TAB_ROW, edges.backslash],
    [edges.caps, ...CAPS_ROW, edges.enter],
    [edges.lshift, ...SHIFT_ROW, edges.rshift],
    bottomRow,
  ]
}

export const KEYBOARD_LAYOUTS: Record<KeyboardLayoutName, readonly (readonly KeyDef[])[]> = {
  mac: buildLayout(MAC_FUNCTION_ROW, MAC_BOTTOM_ROW, macEdges()),
  windows: buildLayout(WIN_FUNCTION_ROW, WIN_BOTTOM_ROW, winEdges()),
}

/**
 * Every row is exactly this many `u` wide. The keyboard frame is a fixed pixel
 * width (see `NATURAL_WIDTH` in OnScreenKeyboard.tsx) derived from it, so a row
 * that doesn't sum to 15u would overflow or leave a ragged edge.
 */
export const ROW_WIDTH_U = 15
