import { describe, expect, it } from 'vitest'
import { dealFrom, mulberry32, newDeck, pickRandom } from './rng'

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
    expect(() => pickRandom([], mulberry32(1))).toThrow()
  })

  it('picks the only item from a single-element array', () => {
    expect(pickRandom(['only'], mulberry32(1))).toBe('only')
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

describe('dealFrom', () => {
  const abc = ['a', 'b', 'c', 'd', 'e', 'f']

  /*
   * The bug this exists for. `dealRandom` shuffles a fresh deck inside every
   * call, so two consecutive four-item deals from a six-item bank could repeat
   * an item across the boundary while two of the six were never dealt at all —
   * exactly the clustering dealing exists to prevent, just moved one level up.
   */
  it('carries the deck across calls so every item is dealt before any repeats', () => {
    const rng = mulberry32(7)
    const first = dealFrom(newDeck(abc), 4, rng)
    const second = dealFrom(first.deck, 2, rng)
    expect([...first.dealt, ...second.dealt].sort()).toEqual([...abc].sort())
  })

  it('reshuffles once the deck is spent, rather than running dry', () => {
    const rng = mulberry32(3)
    const { dealt } = dealFrom(newDeck(['a', 'b']), 5, rng)
    expect(dealt).toHaveLength(5)
    expect(new Set(dealt)).toEqual(new Set(['a', 'b']))
  })

  it('is deterministic for a given seed', () => {
    const once = dealFrom(newDeck(abc), 4, mulberry32(11))
    const twice = dealFrom(newDeck(abc), 4, mulberry32(11))
    expect(once.dealt).toEqual(twice.dealt)
  })

  /*
   * Over a *part-dealt* deck, which is the only case that can catch aliasing:
   * a fresh deck's empty `remaining` is replaced by the reshuffle on the first
   * iteration, so mutating it in place is indistinguishable from copying it.
   */
  it('leaves the deck it was given untouched', () => {
    const partway = dealFrom(newDeck(abc), 2, mulberry32(2)).deck
    expect(partway.remaining.length).toBeGreaterThan(0)
    const before = [...partway.remaining]
    const again = dealFrom(partway, 2, mulberry32(5))
    expect(partway.remaining).toEqual(before)
    // And dealing the same deck twice really does deal the same items.
    expect(dealFrom(partway, 2, mulberry32(5)).dealt).toEqual(again.dealt)
  })

  it('deals nothing when asked for nothing', () => {
    expect(dealFrom(newDeck(abc), 0, mulberry32(1)).dealt).toEqual([])
  })

  it('refuses a deck with nothing in it', () => {
    expect(() => newDeck([])).toThrow('must not be empty')
  })
})
