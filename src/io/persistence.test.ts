// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  readConfusionMap,
  readLibrary,
  readMissMap,
  readRuns,
  readSettings,
  readShowKeyboard,
} from './persistence'

const RUNS_KEY = 'japanese-romaji:runs'
const SETTINGS_KEY = 'japanese-romaji:settings'
const LIBRARY_KEY = 'japanese-romaji:library'
const MISSES_KEY = 'japanese-romaji:misses'
const CONFUSIONS_KEY = 'japanese-romaji:confusions'
const SHOW_KB_KEY = 'japanese-romaji:show-keyboard'

beforeEach(() => {
  localStorage.clear()
})

describe('readRuns', () => {
  it('returns an empty array when the key is absent', () => {
    expect(readRuns()).toEqual([])
  })

  it('returns an empty array when the stored value is not an array', () => {
    localStorage.setItem(RUNS_KEY, JSON.stringify({ not: 'array' }))
    expect(readRuns()).toEqual([])
  })

  it('returns an empty array for corrupt JSON', () => {
    localStorage.setItem(RUNS_KEY, '{not json')
    expect(readRuns()).toEqual([])
  })

  it('accepts a well-formed run', () => {
    const run = {
      source: 'words',
      chars: 10,
      mistakes: 1,
      accuracy: 90,
      wpm: 30,
      elapsedMs: 20_000,
      date: '2026-08-01T00:00:00.000Z',
    }
    localStorage.setItem(RUNS_KEY, JSON.stringify([run]))
    const result = readRuns()
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('words')
    expect(result[0].wpm).toBe(30)
  })

  it('normalizes a legacy run that has cpm but no wpm', () => {
    const legacy = {
      source: 'drills',
      chars: 8,
      mistakes: 0,
      accuracy: 100,
      cpm: 250,
      elapsedMs: 10_000,
      date: '2025-01-01T00:00:00.000Z',
    }
    localStorage.setItem(RUNS_KEY, JSON.stringify([legacy]))
    const result = readRuns()
    expect(result).toHaveLength(1)
    expect(result[0].wpm).toBe(50) // 250 / 5
  })

  it('drops items that are missing required fields', () => {
    const bad = [
      { source: 'words', chars: 10 }, // no accuracy, wpm, date, etc.
      {
        source: 'words',
        chars: 10,
        mistakes: 0,
        accuracy: 100,
        wpm: 30,
        elapsedMs: 5000,
        date: '2026-08-01T00:00:00.000Z',
      },
    ]
    localStorage.setItem(RUNS_KEY, JSON.stringify(bad))
    expect(readRuns()).toHaveLength(1)
  })

  it('drops items with an invalid source name', () => {
    const bad = {
      source: 'hacker',
      chars: 10,
      mistakes: 0,
      accuracy: 100,
      wpm: 30,
      elapsedMs: 5000,
      date: '2026-08-01T00:00:00.000Z',
    }
    localStorage.setItem(RUNS_KEY, JSON.stringify([bad]))
    expect(readRuns()).toHaveLength(0)
  })

  it('drops items with a non-parseable date', () => {
    const bad = {
      source: 'words',
      chars: 10,
      mistakes: 0,
      accuracy: 100,
      wpm: 30,
      elapsedMs: 5000,
      date: 'not-a-date',
    }
    localStorage.setItem(RUNS_KEY, JSON.stringify([bad]))
    expect(readRuns()).toHaveLength(0)
  })

  it('drops items with neither wpm nor cpm', () => {
    const bad = {
      source: 'words',
      chars: 10,
      mistakes: 0,
      accuracy: 100,
      elapsedMs: 5000,
      date: '2026-08-01T00:00:00.000Z',
    }
    localStorage.setItem(RUNS_KEY, JSON.stringify([bad]))
    expect(readRuns()).toHaveLength(0)
  })
})

describe('readSettings', () => {
  it('returns the default when the key is absent', () => {
    expect(readSettings()).toEqual({ paragraphItems: 8 })
  })

  it('returns the stored value when valid', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ paragraphItems: 12 }))
    expect(readSettings()).toEqual({ paragraphItems: 12 })
  })

  it('clamps paragraphItems below 3 back to 3', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ paragraphItems: 1 }))
    expect(readSettings().paragraphItems).toBe(3)
  })

  it('clamps paragraphItems above 30 back to 30', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ paragraphItems: 999 }))
    expect(readSettings().paragraphItems).toBe(30)
  })

  it('falls back to the default for corrupt or non-object values', () => {
    localStorage.setItem(SETTINGS_KEY, 'null')
    expect(readSettings()).toEqual({ paragraphItems: 8 })
    localStorage.setItem(SETTINGS_KEY, '"string"')
    expect(readSettings()).toEqual({ paragraphItems: 8 })
  })
})

describe('readLibrary', () => {
  it('returns an empty array when the key is absent', () => {
    expect(readLibrary()).toEqual([])
  })

  it('accepts valid kana/romaji pairs', () => {
    const items = [{ kana: 'あ', romaji: 'a' }, { kana: 'い', romaji: 'i' }]
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items))
    expect(readLibrary()).toEqual(items)
  })

  it('drops items that are missing kana or romaji', () => {
    const mixed = [
      { kana: 'あ', romaji: 'a' },
      { kana: 'い' },
      { romaji: 'u' },
      { kana: 42, romaji: 'a' },
    ]
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(mixed))
    expect(readLibrary()).toHaveLength(1)
  })

  it('returns an empty array for a non-array value', () => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ kana: 'あ', romaji: 'a' }))
    expect(readLibrary()).toEqual([])
  })
})

describe('readMissMap', () => {
  it('returns an empty object when the key is absent', () => {
    expect(readMissMap()).toEqual({})
  })

  it('returns the stored object when valid', () => {
    localStorage.setItem(MISSES_KEY, JSON.stringify({ a: 3, s: 1 }))
    expect(readMissMap()).toEqual({ a: 3, s: 1 })
  })

  it('drops entries with non-numeric values', () => {
    localStorage.setItem(MISSES_KEY, JSON.stringify({ a: 3, b: 'lots' }))
    expect(readMissMap()).toEqual({ a: 3 })
  })

  it('returns an empty object for a non-object stored value', () => {
    localStorage.setItem(MISSES_KEY, JSON.stringify([1, 2, 3]))
    expect(readMissMap()).toEqual({})
  })
})

describe('readConfusionMap', () => {
  it('returns an empty object when the key is absent', () => {
    expect(readConfusionMap()).toEqual({})
  })

  it('returns the stored object when valid', () => {
    localStorage.setItem(CONFUSIONS_KEY, JSON.stringify({ 'a → s': 2 }))
    expect(readConfusionMap()).toEqual({ 'a → s': 2 })
  })
})

describe('readShowKeyboard', () => {
  it('returns true (show) when the key is absent', () => {
    expect(readShowKeyboard()).toBe(true)
  })

  it("returns false when the key is '0' (legacy format)", () => {
    localStorage.setItem(SHOW_KB_KEY, '0')
    expect(readShowKeyboard()).toBe(false)
  })

  it("returns true when the key is '1' (legacy format)", () => {
    localStorage.setItem(SHOW_KB_KEY, '1')
    expect(readShowKeyboard()).toBe(true)
  })

  it('returns true when the key stores JSON true', () => {
    localStorage.setItem(SHOW_KB_KEY, 'true')
    expect(readShowKeyboard()).toBe(true)
  })

  it('returns false when the key stores JSON false', () => {
    localStorage.setItem(SHOW_KB_KEY, 'false')
    expect(readShowKeyboard()).toBe(false)
  })
})
