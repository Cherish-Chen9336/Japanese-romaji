import { describe, expect, it } from 'vitest'
import { dealRandom, mulberry32, pickRandom } from './rng'

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

describe('dealRandom', () => {
  it('deals every item once before repeating any', () => {
    const items = ['a', 'b', 'c', 'd']
    const dealt = dealRandom(items, 4, mulberry32(1))
    expect([...dealt].sort()).toEqual(items)
  })

  it('reshuffles when the deck runs out', () => {
    const dealt = dealRandom(['a', 'b'], 6, mulberry32(9))
    expect(dealt).toHaveLength(6)
    expect(dealt.filter((x) => x === 'a')).toHaveLength(3)
    expect(dealt.filter((x) => x === 'b')).toHaveLength(3)
  })

  it('deals fewer than a full deck without repeating', () => {
    const dealt = dealRandom(['a', 'b', 'c', 'd', 'e'], 3, mulberry32(4))
    expect(new Set(dealt).size).toBe(3)
  })

  it('is deterministic for a given seed', () => {
    expect(dealRandom(['a', 'b', 'c'], 5, mulberry32(42))).toEqual(
      dealRandom(['a', 'b', 'c'], 5, mulberry32(42)),
    )
  })

  it('throws on an empty pool', () => {
    expect(() => dealRandom([], 1)).toThrow('must not be empty')
  })

  it('returns nothing when asked for nothing', () => {
    expect(dealRandom(['a'], 0, mulberry32(1))).toEqual([])
  })
})
