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

/** Fisher-Yates, on a copy. */
function shuffled<T>(items: readonly T[], rng: RandomSource): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * `count` items, dealt from a shuffled deck rather than drawn independently.
 *
 * Independent draws are what a naive `Array.from({length}, pickRandom)` does,
 * and over a short lesson they cluster badly — an eight-item run routinely came
 * back as the same word eight times while leaving most of the bank unseen. That
 * is a poor lesson in general and useless for drilling coverage. Dealing from a
 * deck guarantees every item appears once before any appears twice; when the
 * deck runs out it is reshuffled, so runs longer than the bank still vary.
 */
/**
 * A deck part-way through being dealt: what is left, and what it is a deck of.
 *
 * `dealRandom` builds its deck inside the call, so two consecutive calls each
 * start from a full shuffle and can hand out the same item either side of the
 * boundary — the very repetition dealing exists to prevent. That was invisible
 * while one deal filled one whole run; a timed run deals several times.
 */
export type Deck<T> = {
  readonly items: readonly T[]
  readonly remaining: readonly T[]
}

export function newDeck<T>(items: readonly T[]): Deck<T> {
  if (items.length === 0) {
    throw new Error('newDeck: items must not be empty')
  }
  return { items, remaining: [] }
}

/**
 * Deals `count` items and hands back the deck to deal from next time.
 *
 * The same guarantee `dealRandom` gives within one call — every item appears
 * once before any appears twice — now holds *across* calls, which is what makes
 * a run of several passages cover the bank rather than restarting it.
 */
export function dealFrom<T>(
  deck: Deck<T>,
  count: number,
  rng: RandomSource = Math.random,
): { dealt: T[]; deck: Deck<T> } {
  const dealt: T[] = []
  let remaining = [...deck.remaining]
  while (dealt.length < count) {
    if (remaining.length === 0) remaining = shuffled(deck.items, rng)
    dealt.push(remaining.pop() as T)
  }
  return { dealt, deck: { items: deck.items, remaining } }
}

export function dealRandom<T>(
  items: readonly T[],
  count: number,
  rng: RandomSource = Math.random,
): T[] {
  if (items.length === 0) {
    throw new Error('dealRandom: items must not be empty')
  }
  const out: T[] = []
  let deck: T[] = []
  while (out.length < count) {
    if (deck.length === 0) deck = shuffled(items, rng)
    out.push(deck.pop() as T)
  }
  return out
}
