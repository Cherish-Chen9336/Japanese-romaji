import { describe, expect, it } from 'vitest'
import {
  isReviewReady,
  mayHideParticle,
  reviewItem,
  reviewPaste,
  reviewReject,
  reviewRomaji,
  segmentLine,
  withReading,
} from './review'
import { compileStrict, compilePrompt } from './prompt'
import { itemMoras } from './lessons'
import { MAX_LIBRARY_ITEM_CHARS } from './lessons'

describe('segmentLine', () => {
  it('splits where kanji meets kana, and nowhere else', () => {
    expect(segmentLine('今日はいい天気です')).toEqual([
      { text: '今日', reading: '', needsReading: true },
      { text: 'はいい', reading: 'はいい', needsReading: false },
      { text: '天気', reading: '', needsReading: true },
      { text: 'です', reading: 'です', needsReading: false },
    ])
  })

  it('lets kana spell itself, in either script', () => {
    expect(segmentLine('コーヒー')).toEqual([
      { text: 'コーヒー', reading: 'コーヒー', needsReading: false },
    ])
  })

  /* 人々 repeats the character before it; asking for the reading of 人 alone
     would be asking the wrong question. */
  it('keeps the iteration mark with the kanji it repeats', () => {
    expect(segmentLine('人々')).toEqual([{ text: '人々', reading: '', needsReading: true }])
    expect(segmentLine('〇番')).toEqual([{ text: '〇番', reading: '', needsReading: true }])
  })

  it('drops a run that is only spaces rather than emitting an empty segment', () => {
    expect(segmentLine('今日 は 天気')).toEqual([
      { text: '今日', reading: '', needsReading: true },
      { text: 'は', reading: 'は', needsReading: false },
      { text: '天気', reading: '', needsReading: true },
    ])
    expect(segmentLine('   ')).toEqual([])
    expect(segmentLine('')).toEqual([])
  })
})

describe('reviewPaste', () => {
  it('splits a paste into lines the way the parser does', () => {
    const reviews = reviewPaste('今日はいい天気です。\nおはよう')
    expect(reviews.map((r) => r.source)).toEqual(['今日はいい天気です', 'おはよう'])
    expect(reviews[1].segments).toEqual([
      { text: 'おはよう', reading: 'おはよう', needsReading: false },
    ])
  })
})

describe('withReading', () => {
  it('replaces one segment without touching the others or the original', () => {
    const before = reviewPaste('今日は')[0]
    const after = withReading(before, 0, 'きょう')
    expect(after.segments[0].reading).toBe('きょう')
    expect(after.segments[1]).toEqual(before.segments[1])
    expect(before.segments[0].reading).toBe('')
  })
})

describe('mayHideParticle', () => {
  it('marks kana that could be a particle, and nothing else', () => {
    expect(mayHideParticle({ text: 'はいい', reading: 'はいい', needsReading: false })).toBe(true)
    expect(mayHideParticle({ text: 'へいく', reading: 'へいく', needsReading: false })).toBe(true)
    expect(mayHideParticle({ text: 'です', reading: 'です', needsReading: false })).toBe(false)
    // A kanji segment is being asked for its reading already.
    expect(mayHideParticle({ text: '歯', reading: '', needsReading: true })).toBe(false)
  })
})

describe('isReviewReady', () => {
  it('waits for every reading, and counts whitespace as missing', () => {
    const review = reviewPaste('今日は')[0]
    expect(isReviewReady(review)).toBe(false)
    expect(isReviewReady(withReading(review, 0, '  '))).toBe(false)
    expect(isReviewReady(withReading(review, 0, 'きょう'))).toBe(true)
    expect(isReviewReady({ source: '', segments: [] })).toBe(false)
  })
})

describe('reviewItem', () => {
  it('builds nothing while a reading is still owed', () => {
    expect(reviewItem(reviewPaste('学校')[0])).toBeNull()
    expect(reviewRomaji(reviewPaste('学校')[0])).toBeNull()
  })

  it('derives the romaji rather than asking for it', () => {
    const review = withReading(reviewPaste('学校')[0], 0, 'がっこう')
    expect(reviewItem(review)).toEqual({
      kana: '学校',
      reading: 'がっこう',
      romaji: 'gakkou',
    })
    expect(reviewRomaji(review)).toBe('gakkou')
  })

  /* An identical reading would claim a difference that is not there. */
  it('omits the reading where it would only repeat the kana', () => {
    expect(reviewItem(reviewPaste('おはよう')[0])).toEqual({
      kana: 'おはよう',
      romaji: 'ohayou',
    })
  })

  it('refuses a reading that is not kana, rather than typing it literally', () => {
    expect(reviewItem(withReading(reviewPaste('学校')[0], 0, 'gakkou'))).toBeNull()
    expect(reviewItem(withReading(reviewPaste('学校')[0], 0, '学校'))).toBeNull()
  })

  /*
   * A space typed into a reading box would break the display into a different
   * number of words from the romaji, putting one word's gloss over another
   * word's characters.
   */
  it('refuses a reading that does not break into the same words', () => {
    expect(reviewItem(withReading(reviewPaste('学校')[0], 0, 'がっ こう'))).toBeNull()
  })

  it('refuses a line too long for storage to read back', () => {
    const long = 'あ'.repeat(MAX_LIBRARY_ITEM_CHARS + 1)
    expect(reviewItem(reviewPaste(long)[0])).toBeNull()
  })
})

describe('reviewReject', () => {
  it('names the rule a confirmed review broke, and waits quietly before that', () => {
    expect(reviewReject(reviewPaste('学校')[0])).toBe('no-reading')
    expect(reviewReject(withReading(reviewPaste('学校')[0], 0, 'がっこう'))).toBeNull()
    expect(reviewReject(withReading(reviewPaste('学校')[0], 0, 'がっ こう'))).toBe(
      'word-mismatch',
    )
    expect(reviewReject(reviewPaste('あ'.repeat(MAX_LIBRARY_ITEM_CHARS + 1))[0])).toBe('too-long')
  })

  /*
   * The point of the whole exercise: a confirmed paragraph has to compile from
   * its kana — not fall back to typing the romaji letter by letter, which is
   * what `学校|gakkou` does and why such an entry records no moras at all.
   */
  it('produces an item that compiles from kana, tracks moras and keeps its ruby', () => {
    let review = reviewPaste('今日はいい天気です')[0]
    review = withReading(review, 0, 'きょう')
    review = withReading(review, 1, 'わいい')
    review = withReading(review, 2, 'てんき')
    const item = reviewItem(review)
    expect(item).toEqual({
      kana: '今日 はいい 天気 です',
      reading: 'きょう わいい てんき です',
      romaji: 'kyou waii tenki desu',
    })

    expect(compileStrict(item!)).not.toBeNull()
    expect(itemMoras(item!)).toEqual([
      'きょ', 'う', 'わ', 'い', 'い', 'て', 'ん', 'き', 'で', 'す',
    ])

    // Ruby over the kanji, and the particle shown as it is written.
    expect(
      compilePrompt([item!]).words.map((word) =>
        word.segments.map((s) => (s.ruby === undefined ? s.text : `${s.text}[${s.ruby}]`)).join(''),
      ),
    ).toEqual(['今日[きょう]', 'はいい', '天気[てんき]', 'です'])
  })
})
