/**
 * The on-screen keyboard's keycaps: one 6-row ANSI laptop board.
 *
 * There used to be two, `mac` and `windows`, behind a `KeyboardLayoutName`
 * preference and a settings control. Nothing a typist presses during practice
 * differs between them — romaji is letters, and the rows that actually diverge
 * are the function row and the modifier row, neither of which is touched in a
 * run. The split cost a persisted preference, a type, a guard, two layout
 * definitions and a picker, and bought a difference nobody typing could feel.
 *
 * So the board is combined rather than chosen: a glyph where the platforms
 * disagree on the word (⌫ ⏎ ⌘ ⌥ ⌃), the shared word where they agree (tab,
 * caps lock, shift, control, option, fn). The bottom row is the MacBook order
 * with the arrow cluster replaced by a second control key, which puts `fn` in
 * the bottom-left corner where a laptop has it.
 *
 * `codes` lists the `KeyboardEvent.code` values that drive a cap's pressed
 * state. Caps with no code — `fn`, the power key — simply never light up.
 *
 * This is layout DATA, not logic: pure and side-effect free, but it lives in
 * `ui/` because it only ever describes how to draw a keyboard.
 */

export type KeyVariant = 'mod' | 'space'

export interface KeyDef {
  /** Stable per-key handle. For letters/digits this matches the keystroke. */
  id: string
  /**
   * What renders largest on the cap. For a modifier this is the glyph, with the
   * spelled-out word in `sub` beneath it — "⌫" over "delete", reading the way
   * an Apple keycap does.
   */
  label: string
  /** The spelled-out word under a modifier's glyph. */
  sub?: string
  /**
   * The character produced when Shift is held — drawn smaller, above the main
   * label (`!` above `1`, `<` above `,`). Mirrors physical ANSI caps.
   */
  shifted?: string
  /** Width in `u`. 1u = base cap. */
  width: number
  /** `KeyboardEvent.code` values that drive pressed-state. */
  codes?: readonly string[]
  /** Style hint: `mod` (smaller, dimmer text), `space` (spacebar). */
  variant?: KeyVariant
  /**
   * Horizontal alignment of the label stack within the cap. Centred by default;
   * the row-edge modifiers hug the edge the key runs to, like real keycaps.
   */
  align?: 'start' | 'end'
  /**
   * The raised bar moulded into `f` and `j` so touch typists can find home row
   * without looking. Decorative, but it is the detail that reads as "laptop".
   */
  nib?: boolean
}

const letters = (ids: string, width = 1): KeyDef[] =>
  ids.split('').map((id) => ({
    id,
    label: id,
    width,
    codes: [`Key${id.toUpperCase()}`],
    ...(id === 'f' || id === 'j' ? { nib: true } : {}),
  }))

/* ---- row 1: function row, drawn half height ---------------------------- */

const FUNCTION_ROW: readonly KeyDef[] = [
  { id: 'esc', label: 'esc', width: 1.5, codes: ['Escape'], variant: 'mod', align: 'start' },
  ...Array.from({ length: 12 }, (_, i): KeyDef => {
    const n = i + 1
    return { id: `f${n}`, label: `F${n}`, width: 1, codes: [`F${n}`], variant: 'mod' }
  }),
  // No code: the power key is drawn because the board has one, never pressed.
  { id: 'power', label: '⏻', width: 1.5, variant: 'mod' },
]

/* ---- rows 2-5 ---------------------------------------------------------- */

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
  { id: 'backspace', label: '⌫', sub: 'delete', width: 2, codes: ['Backspace'], variant: 'mod', align: 'end' },
]

const TAB_ROW: readonly KeyDef[] = [
  { id: 'tab', label: '⇥', sub: 'tab', width: 1.5, codes: ['Tab'], variant: 'mod', align: 'start' },
  ...letters('qwertyuiop'),
  { id: '[', label: '[', shifted: '{', width: 1, codes: ['BracketLeft'] },
  { id: ']', label: ']', shifted: '}', width: 1, codes: ['BracketRight'] },
  { id: '\\', label: '\\', shifted: '|', width: 1.5, codes: ['Backslash'] },
]

const CAPS_ROW: readonly KeyDef[] = [
  { id: 'caps', label: '⇪', sub: 'caps lock', width: 1.75, codes: ['CapsLock'], variant: 'mod', align: 'start' },
  ...letters('asdfghjkl'),
  { id: ';', label: ';', shifted: ':', width: 1, codes: ['Semicolon'] },
  { id: "'", label: "'", shifted: '"', width: 1, codes: ['Quote'] },
  { id: 'enter', label: '↩', sub: 'return', width: 2.25, codes: ['Enter'], variant: 'mod', align: 'end' },
]

const SHIFT_ROW: readonly KeyDef[] = [
  { id: 'lshift', label: '⇧', sub: 'shift', width: 2.25, codes: ['ShiftLeft'], variant: 'mod', align: 'start' },
  ...letters('zxcvbnm'),
  { id: ',', label: ',', shifted: '<', width: 1, codes: ['Comma'] },
  { id: '.', label: '.', shifted: '>', width: 1, codes: ['Period'] },
  { id: '/', label: '/', shifted: '?', width: 1, codes: ['Slash'] },
  { id: 'rshift', label: '⇧', sub: 'shift', width: 2.75, codes: ['ShiftRight'], variant: 'mod', align: 'end' },
]

/* ---- row 6: MacBook order, fn in the corner ---------------------------- */

const BOTTOM_ROW: readonly KeyDef[] = [
  // No code: `fn` produces no KeyboardEvent, so it is drawn and never lit.
  { id: 'fn', label: 'fn', width: 1.25, variant: 'mod' },
  { id: 'ctrl', label: '⌃', sub: 'control', width: 1.25, codes: ['ControlLeft'], variant: 'mod' },
  { id: 'opt', label: '⌥', sub: 'option', width: 1.25, codes: ['AltLeft'], variant: 'mod' },
  { id: 'cmd', label: '⌘', sub: 'command', width: 1.5, codes: ['MetaLeft'], variant: 'mod' },
  { id: 'space', label: ' ', width: 5.75, codes: ['Space'], variant: 'space' },
  { id: 'cmd2', label: '⌘', sub: 'command', width: 1.5, codes: ['MetaRight'], variant: 'mod' },
  { id: 'opt2', label: '⌥', sub: 'option', width: 1.25, codes: ['AltRight'], variant: 'mod' },
  { id: 'ctrl2', label: '⌃', sub: 'control', width: 1.25, codes: ['ControlRight'], variant: 'mod' },
]

/** The board, top row first. Row 1 is drawn at half height. */
export const KEYBOARD_ROWS: readonly (readonly KeyDef[])[] = [
  FUNCTION_ROW,
  NUMBER_ROW,
  TAB_ROW,
  CAPS_ROW,
  SHIFT_ROW,
  BOTTOM_ROW,
]

/**
 * Every row is exactly this many `u` wide. The keyboard frame is a fixed pixel
 * width (see `NATURAL_WIDTH` in OnScreenKeyboard.tsx) derived from it, so a row
 * that doesn't sum to 15u would overflow the case or leave a ragged edge — the
 * mockup had exactly that, one lead/trail cap's padding per row.
 */
export const ROW_WIDTH_U = 15
