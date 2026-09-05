import { describe, expect, it } from 'vitest'
import { hasKanji, rubySegments } from './furigana'
import { allBankItems } from './lessons'

describe('hasKanji', () => {
  it('detects kanji', () => {
    expect(hasKanji('学校')).toBe(true)
    expect(hasKanji('食べ物')).toBe(true)
  })

  it('detects kanji beyond the BMP', () => {
    // U+20B9F, a CJK Extension B ideograph — a surrogate pair, which a
    // non-unicode character class silently never matches.
    expect(hasKanji('\u{20B9F}')).toBe(true)
  })

  it('does not treat kana as kanji', () => {
    expect(hasKanji('こんにちは')).toBe(false)
    expect(hasKanji('きゃきゅきょ')).toBe(false)
    expect(hasKanji('カタカナ')).toBe(false)
    expect(hasKanji('')).toBe(false)
    expect(hasKanji('abc123')).toBe(false)
    expect(hasKanji('ー')).toBe(false)
  })

  // Unicode puts the iteration mark in Han, and for furigana that is right:
  // 人々 needs a reading and the 々 belongs to the word carrying it. The
  // hand-written ranges this replaced excluded it.
  it('treats the iteration mark as part of a kanji word', () => {
    expect(hasKanji('人々')).toBe(true)
  })
})

describe('rubySegments', () => {
  it('leaves text alone when there is no reading', () => {
    expect(rubySegments('えき')).toEqual([{ text: 'えき' }])
  })

  it('annotates a whole word with nothing to peel', () => {
    expect(rubySegments('学校', 'がっこう')).toEqual([{ text: '学校', ruby: 'がっこう' }])
  })

  it('peels okurigana off the end', () => {
    expect(rubySegments('好きこそ', 'すきこそ')).toEqual([
      { text: '好', ruby: 'す' },
      { text: 'きこそ' },
    ])
  })

  it('peels kana off the front', () => {
    expect(rubySegments('お茶', 'おちゃ')).toEqual([
      { text: 'お' },
      { text: '茶', ruby: 'ちゃ' },
    ])
  })

  it('peels both ends', () => {
    expect(rubySegments('ご飯です', 'ごはんです')).toEqual([
      { text: 'ご' },
      { text: '飯', ruby: 'はん' },
      { text: 'です' },
    ])
  })

  // The particle case: こんにちは carries a reading because は is read `wa`
  // there, which is a spelling difference and not something to print overhead.
  it('never annotates kana, even when a reading differs', () => {
    expect(rubySegments('こんにちは', 'こんにちわ')).toEqual([{ text: 'こんにちは' }])
  })

  it('leaves text alone when the reading matches it exactly', () => {
    expect(rubySegments('学校', '学校')).toEqual([{ text: '学校' }])
  })

  // Interior kana pins the reading down on both sides, so each kanji can carry
  // its own gloss instead of one block covering the lot.
  it('splits at interior kana that appears exactly once in the reading', () => {
    expect(rubySegments('石の上にも', 'いしのうえにも')).toEqual([
      { text: '石', ruby: 'いし' },
      { text: 'の' },
      { text: '上', ruby: 'うえ' },
      { text: 'にも' },
    ])
    expect(rubySegments('塵も積もれば', 'ちりもつもれば')).toEqual([
      { text: '塵', ruby: 'ちり' },
      { text: 'も' },
      { text: '積', ruby: 'つ' },
      { text: 'もれば' },
    ])
  })

  // Two の in もののじょうず, no way to know which pins 物の上手 — annotate as one
  // block rather than guess and mislabel a character.
  it('keeps a group annotation when the interior kana is ambiguous', () => {
    expect(rubySegments('物の上手なれ', 'もののじょうずなれ')).toEqual([
      { text: '物の上手', ruby: 'もののじょうず' },
      { text: 'なれ' },
    ])
  })

  it('reassembles into the original text whatever the split', () => {
    const cases: [string, string][] = [
      ['学校', 'がっこう'],
      ['好きこそ', 'すきこそ'],
      ['お茶', 'おちゃ'],
      ['雨降って', 'あめふって'],
      ['石の上にも', 'いしのうえにも'],
      ['七転び', 'ななころび'],
      ['塵も積もれば', 'ちりもつもれば'],
      ['物の上手なれ', 'もののじょうずなれ'],
    ]
    for (const [display, reading] of cases) {
      expect(rubySegments(display, reading).map((s) => s.text).join('')).toBe(display)
    }
  })

  // The peeling must not eat the whole word and leave nothing to annotate.
  it('always annotates something when kanji and reading differ', () => {
    for (const [display, reading] of [
      ['学校', 'がっこう'],
      ['好きこそ', 'すきこそ'],
      ['八起き', 'やおき'],
    ] as [string, string][]) {
      expect(rubySegments(display, reading).some((s) => s.ruby)).toBe(true)
    }
  })
})

describe('rubySegments — edges', () => {
  // Peeling can consume the whole reading, leaving nothing to put overhead.
  it('gives up rather than annotate with an empty reading', () => {
    expect(rubySegments('漢あ', 'あ')).toEqual([{ text: '漢あ' }])
  })

  it('leaves a kana run at the edge of the core alone', () => {
    // The trailing ぁ/ぃ differ, so nothing is peeled and the kana sits at the
    // core's edge — not an interior split point.
    expect(rubySegments('漢ぁ', 'かんぃ')).toEqual([{ text: '漢ぁ', ruby: 'かんぃ' }])
  })

  it('returns the text unchanged when the reading is empty', () => {
    expect(rubySegments('学校', '')).toEqual([{ text: '学校' }])
  })
})

// Peeling can strip the kanji off both ends and leave a kana-only core. Nothing
// there needs a reading printed over it, even though the word as a whole has
// kanji in it.
it('does not annotate a core left with no kanji after peeling', () => {
  expect(rubySegments('漢あ', '漢い')).toEqual([{ text: '漢' }, { text: 'あ' }])
})

describe('no bundled item glosses kana', () => {
  /*
   * The rule above `quoteBank`, enforced rather than described. A particle は or
   * を beside kanji tempts an author to spell the reading phonetically — けいぞくわ
   * for 継続は — and `rubySegments` then finds no shared suffix, annotates the
   * whole phrase, and the kana は is presented as though it were pronounced わ.
   * Two proverbs were added that way and had to be replaced; a comment would not
   * have stopped the third.
   */
  it('annotates only spans that contain kanji', () => {
    for (const item of allBankItems()) {
      if (item.reading === undefined) continue
      const words = item.kana.split(' ')
      const readings = item.reading.split(' ')
      words.forEach((word, index) => {
        for (const segment of rubySegments(word, readings[index])) {
          if (segment.ruby === undefined) continue
          expect(segment.text, `${item.kana}: [${segment.text}|${segment.ruby}]`).toMatch(/[一-龯]/)
          // A span that still ends in kana means the shared tail was not matched
          // off, which is the same failure seen from the other side.
          expect(segment.text, `${item.kana}: [${segment.text}|${segment.ruby}]`).not.toMatch(/[぀-ゟ]$/)
        }
      })
    }
  })
})
