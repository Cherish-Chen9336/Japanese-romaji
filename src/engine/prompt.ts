import { rubySegments, type RubySegment } from './furigana'
import { tokenizeKana, type RomajiToken } from './romanization'
import type { TextItem } from './types'

/**
 * Turns lesson items into the token stream the matcher runs on.
 *
 * Two things the raw tokeniser can't do on its own:
 *
 *  1. **Particles.** は reads `wa` and へ reads `e` when they're grammatical
 *     particles, and nothing in the kana says which one it is — こんにちは is
 *     `konnichiwa`, but はな is `hana`. An item that needs it declares a
 *     `reading`: the phonetic spelling used for typing, separate from the
 *     orthographic `kana` shown on screen.
 *  2. **Anything the table doesn't know.** An uploaded `日本語|nihongo` would
 *     otherwise ask the typist to press 日, 本, 語. When an item's own romaji
 *     isn't reachable from its kana, we fall back to typing that romaji
 *     literally, one character per token.
 *
 * The invariant both of these serve: every item's canonical romaji must be
 * typeable. `compileItem` guarantees it, and a test asserts it across every
 * bundled bank.
 */

const SPACE_TOKEN: RomajiToken = { kana: ' ', candidates: [' '] }

/**
 * Walks `romaji` across the tokens, returning the candidate each one was spelled
 * with, or null if the spelling doesn't tile them exactly.
 *
 * Memoised on `(tokenIndex, offset)`, which is what keeps it linear. ん spells
 * as `n`, `nn` or `n'`, so a run of ん against romaji that can't match forces the
 * walk to try every way of tiling the n's — measured at 24 tokens: 0.6s, and
 * tripling for every further pair. An uploaded file of forty ん would have hung
 * the tab. Offsets rather than `slice` also stop the string copying.
 */
function spellingPath(tokens: RomajiToken[], romaji: string): string[] | null {
  const text = romaji.toLowerCase()
  const width = text.length + 1
  const deadEnds = new Set<number>()

  const walk = (tokenIndex: number, offset: number): string[] | null => {
    if (tokenIndex === tokens.length) return offset === text.length ? [] : null

    const visited = tokenIndex * width + offset
    if (deadEnds.has(visited)) return null

    for (const candidate of tokens[tokenIndex].candidates) {
      if (!text.startsWith(candidate, offset)) continue
      const tail = walk(tokenIndex + 1, offset + candidate.length)
      if (tail !== null) return [candidate, ...tail]
    }

    deadEnds.add(visited)
    return null
  }

  return walk(0, 0)
}

/** Can `romaji` be typed against these tokens, spelling them out end to end? */
export function acceptsSpelling(tokens: RomajiToken[], romaji: string): boolean {
  return spellingPath(tokens, romaji) !== null
}

/** One token per character — the escape hatch for text the kana table can't reach. */
function literalTokens(romaji: string): RomajiToken[] {
  return [...romaji.toLowerCase()].map((char) => ({ kana: char, candidates: [char] }))
}

/**
 * Compiles an item **only** if its romaji genuinely falls out of its kana,
 * returning null otherwise. Curated content compiles through here, so a typo in
 * a bank entry is a failing test rather than a silently reinterpreted lesson.
 *
 * The distinction matters more than it looks: `compileItem`'s fallback will
 * happily manufacture tokens for any romaji at all, so an assertion phrased over
 * `compileItem` can never fail — `{ kana: 'し', romaji: 'xi' }` would "pass".
 */
export function compileStrict(item: TextItem): RomajiToken[] | null {
  const tokens = tokenizeKana(item.reading ?? item.kana)
  const path = spellingPath(tokens, item.romaji)
  if (path === null) return null

  // Promote the spelling this item is written with, so the on-screen hint
  // teaches the item's own romaji instead of whatever the table happens to list
  // first. It matters most where the two disagree: the だ row has to be taught
  // as `di`/`du` for ぢ/づ, because `ji`/`zu` are the spellings that produce
  // じ/ず. Every alternate stays accepted — only the hint changes.
  return tokens.map((token, index) => ({
    kana: token.kana,
    candidates: [path[index], ...token.candidates.filter((c) => c !== path[index])],
  }))
}

/**
 * Runtime compilation. Falls back to typing the romaji literally when the kana
 * can't produce it — the right behaviour for uploads, where the user's own
 * `kana|romaji` pair is authoritative and may not be kana at all.
 */
export function compileItem(item: TextItem): RomajiToken[] {
  return compileStrict(item) ?? literalTokens(item.romaji)
}

export type PromptWord = { segments: readonly RubySegment[] }

export type CompiledPrompt = {
  tokens: RomajiToken[]
  /** One entry per word, guaranteed to line up with the token stream. */
  words: PromptWord[]
}

/**
 * Display words for one item.
 *
 * Word breaks are expected to agree with the token stream — curated content is
 * held to it by a test, stored content by `readLibrary`. An earlier version
 * forced agreement by folding and padding the display, which was worse than the
 * problem: `{ kana: '一二', reading: 'いち に' }` came out as 一二 glossed いち
 * plus an invisible second word, so the wrong reading sat over the wrong
 * character. Showing the item as written and letting the highlight fall short is
 * the honest failure.
 */
function itemWords(item: TextItem): PromptWord[] {
  const shown = item.kana.split(' ')
  const read = item.reading?.split(' ')
  // A reading that doesn't break into the same number of words as its kana can't
  // be zipped to it — pairing them positionally puts one word's reading over
  // another word's characters. Drop the gloss rather than misplace it.
  const aligned = read !== undefined && read.length === shown.length ? read : undefined
  return shown.map((text, index) => ({ segments: rubySegments(text, aligned?.[index]) }))
}

/**
 * Compiles a lesson into what the matcher runs on and what the screen shows,
 * together — so the two can't drift apart. Items are joined by a typed space.
 */
export function compilePrompt(items: readonly TextItem[]): CompiledPrompt {
  const tokens: RomajiToken[] = []
  const words: PromptWord[] = []
  items.forEach((item, index) => {
    if (index > 0) tokens.push(SPACE_TOKEN)
    tokens.push(...compileItem(item))
    words.push(...itemWords(item))
  })
  return { tokens, words }
}

/** Just the token stream, for callers that don't draw anything. */
export function compileItems(items: readonly TextItem[]): RomajiToken[] {
  return compilePrompt(items).tokens
}

/**
 * Which word each token belongs to. The matcher counts morae, but the kana line
 * is drawn a word at a time, so highlighting the current word means mapping one
 * to the other. A separator counts as ending the word it follows.
 */
export function wordIndexForToken(tokens: readonly RomajiToken[]): number[] {
  let word = 0
  return tokens.map((token) => (token.kana === ' ' ? word++ : word))
}
