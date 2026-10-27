import { describe, expect, it } from 'vitest'
import { TYPEABLE_ROMAJI_CHARS } from '../engine/romanization'
import { KEYBOARD_ROWS, ROW_WIDTH_U } from './keyboard-layouts'

describe('KEYBOARD_ROWS', () => {
  it('has the six ANSI rows', () => {
    expect(KEYBOARD_ROWS).toHaveLength(6)
  })

  /*
   * The frame is a fixed pixel width derived from ROW_WIDTH_U, so a row that
   * doesn't sum to it overflows the case or leaves a ragged edge. The mockup
   * this board came from shipped with exactly that bug — every row ran 0.17u
   * long per edge modifier, because their padding fell outside the flex basis.
   */
  it('has every row exactly ROW_WIDTH_U wide', () => {
    const widths = KEYBOARD_ROWS.map((row) => row.reduce((sum, key) => sum + key.width, 0))
    expect(widths).toEqual(KEYBOARD_ROWS.map(() => ROW_WIDTH_U))
  })

  it('gives every key a unique id', () => {
    const ids = KEYBOARD_ROWS.flatMap((row) => row.map((key) => key.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Two caps sharing a KeyboardEvent.code would both light up on one press.
  it('never assigns the same KeyboardEvent.code to two caps', () => {
    const codes = KEYBOARD_ROWS.flatMap((row) => row.flatMap((key) => key.codes ?? []))
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('carries a label or a space variant on every cap', () => {
    const blank = KEYBOARD_ROWS.flatMap((row) => row).filter(
      (key) => key.label.trim() === '' && key.variant !== 'space',
    )
    expect(blank).toEqual([])
  })

  it('covers every letter of the alphabet', () => {
    const codes = new Set(KEYBOARD_ROWS.flatMap((row) => row.flatMap((key) => key.codes ?? [])))
    const missing = 'abcdefghijklmnopqrstuvwxyz'
      .split('')
      .filter((letter) => !codes.has(`Key${letter.toUpperCase()}`))
    expect(missing).toEqual([])
  })

  /*
   * The two punctuation keys the narrow-start symbol work needs: `,` types 、
   * and `.` types 。 in a romaji IME. They were already on the board; this
   * pins them so a later tidy-up of the keycaps can't quietly drop the only
   * two symbol keys the corpus is about to use.
   */
  it('carries the comma and full-stop caps the symbol work needs', () => {
    const byId = new Map(KEYBOARD_ROWS.flatMap((row) => row).map((key) => [key.id, key]))
    expect(byId.get(',')?.codes).toEqual(['Comma'])
    expect(byId.get('.')?.codes).toEqual(['Period'])
  })

  /*
   * Mac wording is the whole point of combining the two boards: a glyph where
   * the platforms disagree on the word, so no cap says "Backspace" or "Enter".
   */
  it('labels the diverging caps with their glyph and the word beneath', () => {
    const byId = new Map(KEYBOARD_ROWS.flatMap((row) => row).map((key) => [key.id, key]))
    for (const [id, label, sub] of [
      ['backspace', '⌫', 'delete'],
      ['enter', '↩', 'return'],
      ['caps', '⇪', 'caps lock'],
      ['cmd', '⌘', 'command'],
      ['opt', '⌥', 'option'],
      ['ctrl', '⌃', 'control'],
    ] as const) {
      expect(byId.get(id)?.label, id).toBe(label)
      expect(byId.get(id)?.sub, id).toBe(sub)
    }
  })

  // fn holds the bottom-left corner, which is what makes it read as a laptop
  // rather than a desktop board with the arrow cluster cut off.
  it('runs the MacBook bottom row with fn in the corner', () => {
    expect(KEYBOARD_ROWS[5].map((key) => key.id)).toEqual([
      'fn', 'ctrl', 'opt', 'cmd', 'space', 'cmd2', 'opt2', 'ctrl2',
    ])
  })

  /*
   * The other half of the engine's `isTypeableRomaji`.
   *
   * That predicate decides what a bundled item's romaji is allowed to contain,
   * and `prompt.test.ts` holds every bank to it — but on its own it is only a
   * list someone wrote down. This is what ties it to the board the typist is
   * actually looking at: the two can disagree in either direction, and both
   * ways are silent. Widen the predicate and the banks may ship a character
   * with no cap; drop a cap and the hint under the kana names a key that is no
   * longer drawn.
   *
   * `ui` imports from `engine` and never the reverse, so this file is the only
   * place the two can be pinned together.
   */
  it('draws a cap for every character the engine calls typeable', () => {
    const drawn = new Set<string>()
    for (const row of KEYBOARD_ROWS) {
      for (const key of row) {
        if (key.variant === 'space') drawn.add(' ')
        // `id` is the keystroke for letters and punctuation; modifiers carry a
        // word instead, and a word is never a single character.
        if (key.id.length === 1) drawn.add(key.id)
        if (key.shifted?.length === 1) drawn.add(key.shifted)
      }
    }
    const missing = [...TYPEABLE_ROMAJI_CHARS].filter((character) => !drawn.has(character))
    expect(missing).toEqual([])
  })
})
