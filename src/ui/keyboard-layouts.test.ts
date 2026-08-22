import { describe, expect, it } from 'vitest'
import { KEYBOARD_LAYOUT_NAMES, isKeyboardLayoutName } from '../engine/types'
import { KEYBOARD_LAYOUTS, ROW_WIDTH_U } from './keyboard-layouts'

describe('KEYBOARD_LAYOUTS', () => {
  // The settings picker renders from KEYBOARD_LAYOUT_NAMES; a layout defined
  // here but missing from that list would be unreachable in the UI.
  it('defines exactly the layouts named in engine/types', () => {
    expect(Object.keys(KEYBOARD_LAYOUTS).sort()).toEqual([...KEYBOARD_LAYOUT_NAMES].sort())
  })

  for (const name of KEYBOARD_LAYOUT_NAMES) {
    describe(name, () => {
      const rows = KEYBOARD_LAYOUTS[name]

      it('has the six ANSI rows', () => {
        expect(rows).toHaveLength(6)
      })

      // The frame is a fixed pixel width derived from ROW_WIDTH_U, so a row
      // that doesn't sum to it overflows the case or leaves a ragged edge.
      it('has every row exactly ROW_WIDTH_U wide', () => {
        const widths = rows.map((row) => row.reduce((sum, key) => sum + key.width, 0))
        expect(widths).toEqual(rows.map(() => ROW_WIDTH_U))
      })

      it('gives every key a unique id', () => {
        const ids = rows.flatMap((row) => row.map((key) => key.id))
        expect(new Set(ids).size).toBe(ids.length)
      })

      // Two caps sharing a KeyboardEvent.code would both light up on one press.
      it('never assigns the same KeyboardEvent.code to two caps', () => {
        const codes = rows.flatMap((row) => row.flatMap((key) => key.codes ?? []))
        expect(new Set(codes).size).toBe(codes.length)
      })

      it('carries a label, an icon, or a space variant on every cap', () => {
        const blank = rows
          .flatMap((row) => row)
          .filter((key) => key.label.trim() === '' && !key.icon && key.variant !== 'space')
        expect(blank).toEqual([])
      })

      it('covers every letter of the alphabet', () => {
        const codes = new Set(rows.flatMap((row) => row.flatMap((key) => key.codes ?? [])))
        const missing = 'abcdefghijklmnopqrstuvwxyz'
          .split('')
          .filter((letter) => !codes.has(`Key${letter.toUpperCase()}`))
        expect(missing).toEqual([])
      })
    })
  }
})

describe('isKeyboardLayoutName', () => {
  it('accepts the known layout names', () => {
    expect(KEYBOARD_LAYOUT_NAMES.every(isKeyboardLayoutName)).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isKeyboardLayoutName('linux')).toBe(false)
    expect(isKeyboardLayoutName('')).toBe(false)
    expect(isKeyboardLayoutName(null)).toBe(false)
    expect(isKeyboardLayoutName(undefined)).toBe(false)
    expect(isKeyboardLayoutName(1)).toBe(false)
  })
})
