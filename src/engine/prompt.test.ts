import { describe, expect, it } from 'vitest'
import { allBankItems, drillFallbackBank, gojuonBank, sourceBanks } from './lessons'
import {
  acceptsSpelling,
  compileItem,
  compileItems,
  compilePrompt,
  compileStrict,
  wordIndexForToken,
} from './prompt'
import { isTypeableRomaji, tokenizeKana } from './romanization'
import type { TextItem } from './types'

/*
 * Taken from the catalog, not hand-listed. The list used to name five banks,
 * so a bank added later sat outside every invariant below until someone
 * remembered to add it here — which is the one moment nobody is thinking about
 * this file. `allBankItems` is what `sourceBanks` and `gojuonBank` produce, so
 * a new bank joins these checks by existing.
 */
const BANKS: [string, TextItem[]][] = [
  ...Object.entries(sourceBanks),
  ['drillFallbackBank', drillFallbackBank],
  ['gojuonBank', gojuonBank],
]

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
    const item = sourceBanks.words.find((entry) => entry.kana === 'こんにちは')
    expect(item).toBeDefined()
    expect(acceptsSpelling(compileItem(item as TextItem), 'konnichiwa')).toBe(true)
  })

  // Guards the guard: proves the bank assertion above is capable of failing.
  it('rejects a romaji that is not a spelling of its kana', () => {
    expect(compileStrict({ kana: 'し', romaji: 'xi' })).toBeNull()
    expect(compileStrict({ kana: 'し', romaji: 'shi' })).not.toBeNull()
  })

  /*
   * Compiling is not the same claim as being typeable, and until this existed
   * only the first was checked anywhere.
   *
   * `compileStrict` asks whether the kana can spell the romaji. It has no
   * opinion about whether the spelling can be pressed, so an item carrying a
   * full-width character in its *romaji* compiles into perfectly good tokens
   * whose only candidate no key produces. Every check above passes, the suite
   * passes, the build passes, it publishes — and the run cannot be finished.
   *
   * The ASCII form of the same mistake is caught already, which is exactly what
   * made this hard to notice: `hikkoshimashita.` is refused by `compileStrict`
   * because 。 cannot spell `.`, so the obvious way of writing it fails loudly
   * and the dangerous way fails not at all.
   */
  for (const [name, bank] of BANKS) {
    it(`${name} — every candidate can be typed on a real keyboard`, () => {
      const unreachable: string[] = []
      for (const item of bank) {
        const compiled = compileStrict(item)
        if (compiled === null) continue // the assertion above owns this case
        for (const token of compiled) {
          for (const candidate of token.candidates) {
            if (!isTypeableRomaji(candidate)) {
              unreachable.push(`${item.kana} — ${token.kana} wants "${candidate}"`)
            }
          }
        }
      }
      expect(unreachable).toEqual([])
    })
  }

  // Guards that guard. Both of these compile; only one of them is typeable.
  it('catches a full-width mark hiding in a romaji, which compiles clean', () => {
    const trap = { kana: 'ひっこしました。', romaji: 'hikkoshimashita。' }
    const compiled = compileStrict(trap)
    expect(compiled).not.toBeNull()
    expect(
      (compiled ?? []).flatMap((token) => token.candidates).some((c) => !isTypeableRomaji(c)),
    ).toBe(true)

    const honest = compileStrict({ kana: 'ひっこしました', romaji: 'hikkoshimashita' })
    expect(honest).not.toBeNull()
    expect(
      (honest ?? []).flatMap((token) => token.candidates).every((c) => isTypeableRomaji(c)),
    ).toBe(true)
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

  /*
   * A space in a reading may separate typing units. It may not change them.
   *
   * The word boundaries in a reading exist to line the display up with the
   * romaji, so they are free to fall anywhere — but a boundary inside a unit
   * silently teaches the wrong keys. 行って written as `いっ て` passes every
   * other check here: it compiles, its word counts agree, and nothing is
   * unsupported. It just spells itself `ixtsu te` instead of `itte`, and
   * records moras い/っ/て instead of い/って, so the stats are wrong too.
   *
   * Tokenising with and without the spaces is what tells them apart: a space
   * that only separates leaves the tokens alone, and one that cuts into a
   * sokuon, a yōon or a long vowel does not.
   */
  it('no reading is spaced in a way that changes how it is typed', () => {
    const cuts = ALL_ITEMS.filter((item) => {
      const reading = item.reading ?? item.kana
      const separated = tokenizeKana(reading).filter((token) => token.kana !== ' ')
      const continuous = tokenizeKana(reading.replaceAll(' ', ''))
      return JSON.stringify(separated) !== JSON.stringify(continuous)
    }).map((item) => `${item.kana} / ${item.reading ?? item.kana}`)
    expect(cuts).toEqual([])
  })

  /* The check above is worth nothing if it cannot fail. */
  it('catches a reading that splits a sokuon from what doubles it', () => {
    const split = (reading: string) => {
      const separated = tokenizeKana(reading).filter((token) => token.kana !== ' ')
      const continuous = tokenizeKana(reading.replaceAll(' ', ''))
      return JSON.stringify(separated) !== JSON.stringify(continuous)
    }
    expect(split('いっ て')).toBe(true)
    expect(split('がっ こう')).toBe(true)
    // The same words spaced somewhere harmless, and left alone.
    expect(split('いって')).toBe(false)
    expect(split('きょう わいい てんき です')).toBe(false)
    expect(split('コー ヒー')).toBe(false)
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
