/**
 * Deterministic PRNG (mulberry32). Production code seeds it from the current
 * time; tests pass a fixed seed and get reproducible sequences. Keeping
 * randomness behind an injectable function is what makes `pickRandom` and
 * anything built on it testable without mocking `Math.random`.
 */
export function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type RandomSource = () => number

export function pickRandom<T>(items: readonly T[], rng: RandomSource = Math.random): T {
  if (items.length === 0) {
    throw new Error('pickRandom: items must not be empty')
  }
  return items[Math.floor(rng() * items.length)]
}
