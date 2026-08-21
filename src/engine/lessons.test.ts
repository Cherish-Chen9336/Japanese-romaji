import { describe, expect, it } from 'vitest'
import {
  buildParagraph,
  difficultBank,
  drillBankFromMisses,
  drillFallbackBank,
  explicitSourcesForBest,
  generateLesson,
  parseLibraryText,
  sourceUnlockAt,
  sourceUnlocked,
  stripMarkdown,
  wordBank,
} from './lessons'
import type { Settings } from './types'

const settings: Settings = { paragraphItems: 3 }

describe('stripMarkdown', () => {
  it('strips fenced code blocks entirely', () => {
    expect(stripMarkdown('before ```const x = 1``` after')).toBe('before after')
  })

  it('strips heading, emphasis, and list punctuation', () => {
    expect(stripMarkdown('# heading *em* _under_ `code` [link](url) - item ! >')).toBe('heading em under code link url item')
  })

  it('collapses whitespace and trims', () => {
    expect(stripMarkdown('  a   b\n\nc  ')).toBe('a b c')
  })
})

describe('parseLibraryText', () => {
  it('parses pipe-delimited kana|romaji lines', () => {
    expect(parseLibraryText('おはよう|ohayou\nありがとう|Arigatou')).toEqual([
      { kana: 'おはよう', romaji: 'ohayou' },
      { kana: 'ありがとう', romaji: 'arigatou' },
    ])
  })

  it('parses double-space-delimited lines when there is no pipe', () => {
    expect(parseLibraryText('きょう  kyou')).toEqual([{ kana: 'きょう', romaji: 'kyou' }])
  })

  it('splits on Japanese and Latin sentence punctuation', () => {
    expect(parseLibraryText('あ|a。い|i、う|u.え|e,お|o;')).toEqual([
      { kana: 'あ', romaji: 'a' },
      { kana: 'い', romaji: 'i' },
      { kana: 'う', romaji: 'u' },
      { kana: 'え', romaji: 'e' },
      { kana: 'お', romaji: 'o' },
    ])
  })

  it('drops lines with no discernible kana/romaji pair', () => {
    expect(parseLibraryText('just some prose\nno delimiter here')).toEqual([])
  })

  it('lowercases the romaji side but preserves kana case as-is', () => {
    expect(parseLibraryText('カナ|KANA')).toEqual([{ kana: 'カナ', romaji: 'kana' }])
  })

  it('returns an empty array for empty input', () => {
    expect(parseLibraryText('')).toEqual([])
  })
})

describe('buildParagraph', () => {
  it('joins `length` picked items with spaces, using the injected rng', () => {
    const items = [
      { kana: 'あ', romaji: 'a' },
      { kana: 'い', romaji: 'i' },
    ]
    const lesson = buildParagraph(items, 'words', 3, () => 0)
    expect(lesson).toEqual({ kana: 'あ あ あ', romaji: 'a a a', source: 'words' })
  })

  it('tags the lesson with the given source', () => {
    const lesson = buildParagraph(wordBank, 'difficult', 1, () => 0)
    expect(lesson.source).toBe('difficult')
  })

  it('produces exactly `length` picks', () => {
    const lesson = buildParagraph(wordBank, 'words', 5, () => 0.5)
    expect(lesson.kana.split(' ')).toHaveLength(5)
    expect(lesson.romaji.split(' ')).toHaveLength(5)
  })
})

describe('drillBankFromMisses', () => {
  it('falls back to the fixed drill bank when there are no misses', () => {
    expect(drillBankFromMisses({})).toBe(drillFallbackBank)
  })

  it('prefers items containing the top-missed letters', () => {
    const bank = drillBankFromMisses({ sh: 10, ch: 5 })
    expect(bank.length).toBeGreaterThan(0)
    expect(bank.every((item) => item.romaji.includes('sh') || item.romaji.includes('ch'))).toBe(true)
  })

  it('falls back to the fixed drill bank when misses exist but nothing matches', () => {
    expect(drillBankFromMisses({ zzzzz: 1 })).toBe(drillFallbackBank)
  })

  it('only uses the top 5 missed keys — a 6th key ranked below them must not expand the bank', () => {
    // 'z' scores highest (10 misses), 'y' is 6th (1 miss).
    // drillBankFromMisses must not include items that only match 'y'.
    // The letter 'y' appears in yayuyo (drillFallbackBank) but not in wordBank or difficultBank.
    // So if the bank contains items containing 'y' in their romaji, it filtered on 'y' — wrong.
    const misses = { z: 10, s: 9, h: 8, k: 7, n: 6, y: 1 }
    const bank = drillBankFromMisses(misses)
    // 'y' is 6th — must NOT have influenced the filter.
    // Every item in the bank must match at least one of the top-5 keys: z, s, h, k, n.
    const top5 = ['z', 's', 'h', 'k', 'n']
    expect(bank.every((item) => top5.some((letter) => item.romaji.includes(letter)))).toBe(true)
  })
})

describe('sourceUnlockAt / sourceUnlocked', () => {
  it('drills, words, and auto are unlocked at 0 wpm', () => {
    expect(sourceUnlockAt('drills')).toBe(0)
    expect(sourceUnlockAt('words')).toBe(0)
    expect(sourceUnlockAt('auto')).toBe(0)
  })

  it('difficult/quotes/library gate on increasing wpm thresholds', () => {
    expect(sourceUnlockAt('difficult')).toBe(30)
    expect(sourceUnlockAt('quotes')).toBe(50)
    expect(sourceUnlockAt('library')).toBe(70)
  })

  it('sourceUnlocked is true only once best wpm reaches the threshold', () => {
    expect(sourceUnlocked('quotes', 49)).toBe(false)
    expect(sourceUnlocked('quotes', 50)).toBe(true)
  })
})

describe('explicitSourcesForBest', () => {
  it('excludes auto and library, always includes drills/words at 0 wpm', () => {
    const sources = explicitSourcesForBest(0)
    expect(sources).not.toContain('auto')
    expect(sources).not.toContain('library')
    expect(sources).toEqual(expect.arrayContaining(['drills', 'words']))
    expect(sources).not.toContain('difficult')
  })

  it('adds difficult and quotes as wpm crosses their thresholds', () => {
    expect(explicitSourcesForBest(30)).toContain('difficult')
    expect(explicitSourcesForBest(50)).toEqual(expect.arrayContaining(['difficult', 'quotes']))
  })
})

describe('generateLesson', () => {
  it('falls back to words when the requested source is locked', () => {
    const lesson = generateLesson('quotes', settings, {}, [], 0, () => 0)
    expect(lesson.source).toBe('words')
  })

  it('falls back to words when library is requested but empty', () => {
    const lesson = generateLesson('library', settings, {}, [], 70, () => 0)
    expect(lesson.source).toBe('words')
  })

  it('uses the user library when requested and non-empty', () => {
    const library = [{ kana: 'てすと', romaji: 'tesuto' }]
    const lesson = generateLesson('library', settings, {}, library, 70, () => 0)
    expect(lesson.source).toBe('library')
    expect(lesson.kana.split(' ').every((part) => part === 'てすと')).toBe(true)
  })

  it('drills source pulls from the miss-weighted bank', () => {
    const lesson = generateLesson('drills', settings, {}, [], 0, () => 0)
    expect(lesson.source).toBe('drills')
  })

  it('auto picks among currently-unlocked explicit sources via the injected rng', () => {
    // rng() = 0 always selects the first entry of explicitSourcesForBest(0),
    // which is deterministic given the fixed sourceOptions order.
    const expectedFirst = explicitSourcesForBest(0).filter((s) => s !== 'library')[0]
    const lesson = generateLesson('auto', settings, {}, [], 0, () => 0)
    expect(lesson.source).toBe(expectedFirst)
  })

  it('requesting a source unlocked at the given wpm uses that source directly', () => {
    const lesson = generateLesson('difficult', settings, {}, [], 30, () => 0)
    expect(lesson.source).toBe('difficult')
    expect(difficultBank.map((i) => i.kana)).toContain(lesson.kana.split(' ')[0])
  })

  it('respects settings.paragraphItems for word count', () => {
    // Uses `difficult`, not `quotes` — quote-bank kana strings contain
    // internal spaces, which would make a naive split(' ') length check lie.
    const lesson = generateLesson('difficult', { paragraphItems: 2 }, {}, [], 30, () => 0)
    expect(lesson.kana.split(' ')).toHaveLength(2)
    expect(difficultBank.map((i) => i.kana)).toContain(lesson.kana.split(' ')[0])
  })
})
