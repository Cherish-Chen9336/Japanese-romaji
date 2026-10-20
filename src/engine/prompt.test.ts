import { describe, expect, it } from 'vitest'
import {
  allBankItems,
  difficultBank,
  drillFallbackBank,
  gojuonBank,
  quoteBank,
  wordBank,
} from './lessons'
import {
  acceptsSpelling,
  compileItem,
  compileItems,
  compilePrompt,
  compileStrict,
  wordIndexForToken,
} from './prompt'
import { tokenizeKana } from './romanization'
import type { TextItem } from './types'

const BANKS: [string, TextItem[]][] = [
  ['wordBank', wordBank],
  ['difficultBank', difficultBank],
  ['drillFallbackBank', drillFallbackBank],
  ['quoteBank', quoteBank],
  ['gojuonBank', gojuonBank],
]

/*
 * Corpus-wide invariants read `allBankItems()`, never the list above: a bank
 * added to `sourceBanks` later joins them by existing, where a hand-listed set
 * ships unchecked until someone remembers to extend it. `BANKS` stays only to
 * name the failing bank in the per-bank cases.
 */
const ALL_ITEMS: TextItem[] = allBankItems()

describe('acceptsSpelling', () => {
  it('accepts a spelling that tiles the tokens exactly', () => {
    expect(acceptsSpelling(tokenizeKana('しゃしん'), 'shashin')).toBe(true)
  })

  it('accepts an alternate spelling of the same tokens', () => {
    expect(acceptsSpelling(tokenizeKana('しゃしん'), 'syasin')).toBe(true)
  })

  it('rejects a spelling that runs out early', () => {
    expect(acceptsSpelling(tokenizeKana('しゃしん'), 'shashi')).toBe(false)
  })

  it('rejects a spelling with characters left over', () => {
    expect(acceptsSpelling(tokenizeKana('し'), 'shix')).toBe(false)
  })

  // The reason a plain greedy walk isn't enough: `n` is a complete ん, but
  // committing to it here strands the `a`, so the parse has to back up to `nn`.
  it('backtracks past a candidate that fits locally but not globally', () => {
    expect(acceptsSpelling(tokenizeKana('んな'), 'nna')).toBe(true)
    expect(acceptsSpelling(tokenizeKana('ん'), 'nn')).toBe(true)
  })
})

describe('compileItem', () => {
  it('compiles from the kana by default', () => {
    const tokens = compileItem({ kana: 'しゃしん', romaji: 'shashin' })
    expect(tokens.map((token) => token.kana)).toEqual(['しゃ', 'し', 'ん'])
  })

  // は is `wa` only as a grammatical particle, which the kana alone can't say.
  it('compiles from the reading when one is given', () => {
    const item = { kana: 'こんにちは', romaji: 'konnichiwa', reading: 'こんにちわ' }
    expect(acceptsSpelling(compileItem(item), 'konnichiwa')).toBe(true)
  })

  it('still accepts alternate spellings through a reading', () => {
    const item = { kana: 'こんにちは', romaji: 'konnichiwa', reading: 'こんにちわ' }
    expect(acceptsSpelling(compileItem(item), 'konnitiwa')).toBe(true)
  })

  it('does not make the displayed kana typeable when a reading overrides it', () => {
    const item = { kana: 'こんにちは', romaji: 'konnichiwa', reading: 'こんにちわ' }
    expect(acceptsSpelling(compileItem(item), 'konnichiha')).toBe(false)
  })

  // An uploaded `日本語|nihongo` must not ask the typist to press 日, 本, 語.
  it('falls back to the literal romaji when the kana cannot produce it', () => {
    const tokens = compileItem({ kana: '日本語', romaji: 'nihongo' })
    expect(tokens.map((token) => token.kana).join('')).toBe('nihongo')
    expect(acceptsSpelling(tokens, 'nihongo')).toBe(true)
  })

  // Kanji needs no new machinery: `reading` already separates what's displayed
  // from what's typed, which is exactly how Japanese typing sites handle it —
  // 学校 on screen, `gakkou` on the keyboard.
  it('types a kanji item through its reading', () => {
    const item = { kana: '学校', romaji: 'gakkou', reading: 'がっこう' }
    expect(compileStrict(item)).not.toBeNull()
    expect(acceptsSpelling(compileItem(item), 'gakkou')).toBe(true)
    // Display only — the kanji itself is never a keystroke.
    expect(acceptsSpelling(compileItem(item), '学校')).toBe(false)
  })

  it('keeps alternate spellings available behind a kanji reading', () => {
    const item = { kana: '写真', romaji: 'shashin', reading: 'しゃしん' }
    expect(acceptsSpelling(compileItem(item), 'shashin')).toBe(true)
    expect(acceptsSpelling(compileItem(item), 'syasin')).toBe(true)
  })

  it('refuses a kanji item with no reading rather than demanding kanji keystrokes', () => {
    expect(compileStrict({ kana: '学校', romaji: 'gakkou' })).toBeNull()
  })

  it('falls back when the kana is typeable but yields a different spelling', () => {
    // はな reads `hana`; an uploader who wrote `wana` gets what they asked for.
    expect(acceptsSpelling(compileItem({ kana: 'はな', romaji: 'wana' }), 'wana')).toBe(true)
  })
})

describe('compileItems', () => {
  it('joins items with a typed space', () => {
    const tokens = compileItems([
      { kana: 'えき', romaji: 'eki' },
      { kana: 'まち', romaji: 'machi' },
    ])
    expect(tokens.map((token) => token.kana).join('')).toBe('えき まち')
    expect(acceptsSpelling(tokens, 'eki machi')).toBe(true)
  })

  it('compiles a single item without a leading space', () => {
    expect(acceptsSpelling(compileItems([{ kana: 'えき', romaji: 'eki' }]), 'eki')).toBe(true)
  })
})

// The invariant that makes the banks safe to ship: every curated item's romaji
// genuinely falls out of its own kana. Phrased over `compileStrict`, not
// `compileItem` — the latter's literal fallback would accept any romaji at all
// and make the assertion unfalsifiable.
describe('every bundled item is derivable from its own kana', () => {
  for (const [name, bank] of BANKS) {
    it(`${name} — romaji is derivable for every item`, () => {
      const broken = bank.filter((item) => compileStrict(item) === null).map((item) => item.kana)
      expect(broken).toEqual([])
    })
  }

  it('こんにちは is typeable as konnichiwa', () => {
    const item = wordBank.find((entry) => entry.kana === 'こんにちは')
    expect(item).toBeDefined()
    expect(acceptsSpelling(compileItem(item as TextItem), 'konnichiwa')).toBe(true)
  })

  // Guards the guard: proves the bank assertion above is capable of failing.
  it('rejects a romaji that is not a spelling of its kana', () => {
    expect(compileStrict({ kana: 'し', romaji: 'xi' })).toBeNull()
    expect(compileStrict({ kana: 'し', romaji: 'shi' })).not.toBeNull()
  })

  /*
   * A `reading` has to break into words the same way its `kana` does. The
   * display line is split from the kana and zipped with the reading per word,
   * while the cursor's word index is counted from the *compiled* stream — which
   * tokenises the reading. Disagree on where the spaces go and the highlight
   * silently lands on the wrong word, with nothing failing to say so.
   */
  it('every reading breaks into words the same way its kana does', () => {
    const mismatched = ALL_ITEMS.filter(
      (item) =>
        item.reading !== undefined &&
        item.reading.split(' ').length !== item.kana.split(' ').length,
    ).map((item) => `${item.kana} / ${item.reading}`)
    expect(mismatched).toEqual([])
  })

  it('every romaji breaks into words the same way its kana does', () => {
    const mismatched = ALL_ITEMS.filter(
      (item) => item.romaji.split(' ').length !== item.kana.split(' ').length,
    ).map((item) => `${item.kana} / ${item.romaji}`)
    expect(mismatched).toEqual([])
  })
})

describe('compilePrompt', () => {
  it('produces one display word per word in the token stream', () => {
    const { tokens, words } = compilePrompt([
      { kana: 'えき', romaji: 'eki' },
      { kana: 'ななころび やおき', romaji: 'nanakorobi yaoki' },
    ])
    expect(words).toHaveLength(Math.max(...wordIndexForToken(tokens)) + 1)
    expect(words).toHaveLength(3)
  })

  it('carries furigana through for a kanji item', () => {
    const { words } = compilePrompt([{ kana: '学校', romaji: 'gakkou', reading: 'がっこう' }])
    expect(words).toEqual([{ segments: [{ text: '学校', ruby: 'がっこう' }] }])
  })

  it('does not gloss a kana item that carries a reading', () => {
    const { words } = compilePrompt([
      { kana: 'こんにちは', romaji: 'konnichiwa', reading: 'こんにちわ' },
    ])
    expect(words).toEqual([{ segments: [{ text: 'こんにちは' }] }])
  })

  /*
   * An item whose kana and romaji disagree about where the words are used to be
   * papered over by folding and padding the display to match. That was worse
   * than the problem — `{ kana: '一二', reading: 'いち に' }` came out as 一二
   * glossed いち plus an invisible second word, putting the wrong reading over
   * the wrong character. Such items are now refused at the boundary instead, so
   * this shape never reaches compilation.
   */
  it('shows a malformed item as written rather than inventing words for it', () => {
    const { words } = compilePrompt([{ kana: '一二', reading: 'いち に', romaji: 'ichi ni' }])
    expect(words).toHaveLength(1)
    expect(words[0].segments).toEqual([{ text: '一二' }])
  })

  it('holds the alignment across every bundled item', () => {
    for (const item of ALL_ITEMS) {
      const { tokens, words } = compilePrompt([item])
      expect(words.length, item.kana).toBe(Math.max(...wordIndexForToken(tokens)) + 1)
    }
    const { tokens, words } = compilePrompt(ALL_ITEMS)
    expect(words.length).toBe(Math.max(...wordIndexForToken(tokens)) + 1)
  })
})

describe('spellingPath performance', () => {
  /*
   * ん spells as n, nn or n', so a run of ん against romaji that cannot match
   * forces the walk to try every tiling of the n's. Unmemoised this was
   * exponential — 24 tokens took 0.6s and tripled every further pair, so a
   * modest uploaded file froze the tab.
   */
  it('does not blow up on a long unmatchable run of ん', () => {
    const item = { kana: 'ん'.repeat(200), romaji: `${'n'.repeat(300)}x` }
    const started = performance.now()
    expect(compileStrict(item)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('still finds the spelling when one exists in a long run', () => {
    const item = { kana: 'ん'.repeat(50), romaji: 'n'.repeat(50) }
    expect(compileStrict(item)).not.toBeNull()
  })
})

/*
 * Not "what is displayed is what is typed" — that is false by design, and
 * naming it so would contradict the central split: `kana` is displayed,
 * `reading ?? kana` is typed, which is what makes 学校 shown and `gakkou`
 * pressed. The narrower claim is the one worth holding: a reading may differ
 * from its kana in script, never in the *marks* it carries.
 */
describe('a reading carries every mark its kana displays', () => {
  /*
   * `compileStrict` tokenizes `reading ?? kana`, so a reading that omits a mark
   * the kana displays leaves that mark on screen and out of the typing target.
   * Verified against the current compiler: `{ kana: '学校。', reading: 'がっこう' }`
   * compiles to が・っこ・う and never asks for the full stop. Nothing else
   * catches that, because the item compiles perfectly well.
   *
   * The sequence is compared unsorted on purpose. Sorted, this checked only how
   * many marks each side had, so 「ねこ」 against ねこ」「 passed — a reading that
   * moved a bracket rather than dropping one. Known limit even so: the set below
   * is the marks the corpus actually uses, not every mark `stripPunctuation`
   * knows, so a reading could still shed one from outside it.
   */
  const MARKS = /[、。！？「」『』（）【】〔〕・…ー～〜]/gu

  const marksIn = (text: string): string => (text.match(MARKS) ?? []).join('')

  it('no bundled item displays a mark its reading does not carry', () => {
    const offenders = ALL_ITEMS.filter((item) => item.reading !== undefined)
      .filter((item) => marksIn(item.kana) !== marksIn(item.reading as string))
      .map((item) => `${item.kana} / ${item.reading}`)
    expect(offenders).toEqual([])
  })

  // Guards the guard: order has to matter, or the check is back to counting.
  it('catches a reading that moves a mark instead of dropping it', () => {
    expect(marksIn('「ねこ」')).not.toBe(marksIn('ねこ」「'))
  })

  /*
   * Pins the hazard against the real compiler rather than against the helper
   * above. This item compiles cleanly and the full stop is simply absent from
   * the tokens, so nothing downstream can tell that the screen is showing a
   * mark the typist is never asked for. When the symbol table lands, this is
   * the assertion that has to flip.
   */
  it('compiles 学校。 without ever asking for the full stop', () => {
    const tokens = compileStrict({ kana: '学校。', reading: 'がっこう', romaji: 'gakkou' })
    expect(tokens).not.toBeNull()
    expect((tokens ?? []).map((token) => token.kana)).toEqual(['が', 'っこ', 'う'])
    expect((tokens ?? []).some((token) => token.kana === '。')).toBe(false)
  })
})
