import { describe, expect, it } from 'vitest'
import { mulberry32, pickRandom } from './rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const sequenceA = Array.from({ length: 5 }, () => a())
    const sequenceB = Array.from({ length: 5 }, () => b())
    expect(sequenceA).toEqual(sequenceB)
  })

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('stays within [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 200; i += 1) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('pickRandom', () => {
  it('throws on an empty array rather than returning undefined', () => {
    expect(() => pickRandom([])).toThrow()
  })

  it('picks the only item from a single-element array', () => {
    expect(pickRandom(['only'])).toBe('only')
  })

  it('uses the injected rng deterministically', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(pickRandom(items, () => 0)).toBe('a')
    expect(pickRandom(items, () => 0.99)).toBe('d')
    expect(pickRandom(items, () => 0.5)).toBe('c')
  })

  it('never returns an out-of-range index for rng values near 1', () => {
    const items = ['a', 'b', 'c']
    expect(() => pickRandom(items, () => 0.999999)).not.toThrow()
  })
})
