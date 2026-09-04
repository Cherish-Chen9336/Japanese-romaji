import { describe, expect, it } from 'vitest'
import {
  buildParagraph,
  dealLesson,
  planRun,
  difficultBank,
  drillBankFromWeakKana,
  drillMoras,
  itemMoras,
  drillFallbackBank,
  explicitSourcesForBest,
  generateLesson,
  gojuonBank,
  kanaRows,
  sourceOptions,
  parseLibraryText,
  quoteBank,
  sourceUnlockAt,
  sourceUnlocked,
  wordBank,
} from './lessons'
import { acceptsSpelling, compileStrict } from './prompt'
import type { RomajiToken } from './romanization'
import { mulberry32 } from './rng'
import type { KanaRow, Settings, TextItem } from './types'

const settings: Settings = { paragraphItems: 3, stopOnError: true, confidenceMode: false, whitespaceMarkers: true, timedMode: false }

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
    expect(lesson).toEqual({
      // Dealt from a shuffled deck, so both items appear before either repeats.
      kana: 'あ い あ',
      romaji: 'a i a',
      source: 'words',
      // Items are carried through so the lesson can be recompiled into matcher
      // tokens — a per-item `reading` would be lost by the joined strings alone.
      items: [items[0], items[1], items[0]],
    })
  })

  // Regression: independent draws routinely produced a lesson that was the same
  // word eight times over while leaving most of the bank unseen.
  it('shows every item once before repeating any of them', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ kana: `k${i}`, romaji: `r${i}` }))
    const rng = mulberry32(7)
    for (let trial = 0; trial < 40; trial++) {
      const picked = buildParagraph(items, 'words', 6, rng).items
      expect(new Set(picked).size).toBe(items.length)
    }
  })

  it('keeps varying past the end of the bank', () => {
    const items = [
      { kana: 'あ', romaji: 'a' },
      { kana: 'い', romaji: 'i' },
      { kana: 'う', romaji: 'u' },
    ]
    const picked = buildParagraph(items, 'words', 9, mulberry32(3)).items
    expect(picked).toHaveLength(9)
    // Three full deals — each item exactly three times, in some order.
    for (const item of items) {
      expect(picked.filter((entry) => entry === item)).toHaveLength(3)
    }
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

describe('drillBankFromWeakKana', () => {
  it('falls back to the fixed drill bank when nothing is weak yet', () => {
    expect(drillBankFromWeakKana([])).toBe(drillFallbackBank)
  })

  /*
   * Matched on tokens, not on text. Asserting against named items rather than
   * re-running the production predicate — the previous test did the latter, so
   * it agreed with the implementation no matter what the implementation was.
   *
   * し appears inside しゃ as a *character*, but tokenises as part of it. Items
   * whose only し is inside a しゃ must not be chosen to practise し, or the
   * drill spends encounters without ever touching the weakness that chose it.
   */
  it('does not select an item whose only match is inside a larger mora', () => {
    const chosen = drillBankFromWeakKana(['し']).map((item) => item.kana)
    expect(chosen).not.toContain('電車') // でんしゃ — no standalone し
    expect(chosen).not.toContain('会社') // かいしゃ
    expect(chosen).not.toContain('しゃしゅしょ')
    expect(chosen).toContain('さしすせそ') // does contain a standalone し
  })

  it('does not select こ for an item whose only こ is a geminated っこ', () => {
    const chosen = drillBankFromWeakKana(['こ']).map((item) => item.kana)
    expect(chosen).not.toContain('学校') // がっこう tokenises as が, っこ, う
    expect(chosen).toContain('かきくけこ')
  })

  it('selects the geminated mora when that is what is weak', () => {
    expect(drillBankFromWeakKana(['っこ']).map((item) => item.kana)).toContain('学校')
  })

  // Kanji items are matched on what is typed, not on what is written.
  it('matches a kanji item through its reading', () => {
    expect(drillBankFromWeakKana(['ひ']).map((item) => item.kana)).toContain('飛行機')
  })

  it('falls back when a weak mora appears in nothing', () => {
    expect(drillBankFromWeakKana(['ヷ'])).toBe(drillFallbackBank)
  })

  it('narrows far more than selecting on letters ever did', () => {
    const everything = [...gojuonBank, ...wordBank, ...difficultBank]
    const byLetter = everything.filter((item) => item.romaji.includes('i'))
    expect(drillBankFromWeakKana(['ちょ']).length).toBeLessThan(byLetter.length / 3)
  })
})

describe('itemMoras', () => {
  it('lists the moras an item is made of', () => {
    expect(itemMoras({ kana: '写真', reading: 'しゃしん', romaji: 'shashin' })).toEqual(['しゃ', 'し', 'ん'])
  })

  it('keeps a geminated pair as the single mora the stats record', () => {
    expect(itemMoras({ kana: '学校', reading: 'がっこう', romaji: 'gakkou' })).toEqual(['が', 'っこ', 'う'])
  })

  // Separators and literal-fallback characters are not moras and must not be
  // offered as drill targets.
  it('drops separators and anything that is not kana', () => {
    expect(itemMoras({ kana: 'えき まち', romaji: 'eki machi' })).toEqual(['え', 'き', 'ま', 'ち'])
    expect(itemMoras({ kana: '日本語', romaji: 'nihongo' })).toEqual([])
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
    const lesson = generateLesson('quotes', settings, [], [], 0, () => 0)
    expect(lesson.source).toBe('words')
  })

  it('falls back to words when library is requested but empty', () => {
    const lesson = generateLesson('library', settings, [], [], 70, () => 0)
    expect(lesson.source).toBe('words')
  })

  it('uses the user library when requested and non-empty', () => {
    const library = [{ kana: 'てすと', romaji: 'tesuto' }]
    const lesson = generateLesson('library', settings, [], library, 70, () => 0)
    expect(lesson.source).toBe('library')
    expect(lesson.kana.split(' ').every((part) => part === 'てすと')).toBe(true)
  })

  it('drills source pulls from the miss-weighted bank', () => {
    const lesson = generateLesson('drills', settings, [], [], 0, () => 0)
    expect(lesson.source).toBe('drills')
  })

  it('auto picks among currently-unlocked explicit sources via the injected rng', () => {
    // rng() = 0 always selects the first entry of explicitSourcesForBest(0),
    // which is deterministic given the fixed sourceOptions order.
    const expectedFirst = explicitSourcesForBest(0).filter((s) => s !== 'library')[0]
    const lesson = generateLesson('auto', settings, [], [], 0, () => 0)
    expect(lesson.source).toBe(expectedFirst)
  })

  it('requesting a source unlocked at the given wpm uses that source directly', () => {
    const lesson = generateLesson('difficult', settings, [], [], 30, () => 0)
    expect(lesson.source).toBe('difficult')
    expect(difficultBank.map((i) => i.kana)).toContain(lesson.kana.split(' ')[0])
  })

  it('respects settings.paragraphItems for word count', () => {
    // Uses `difficult`, not `quotes` — quote-bank kana strings contain
    // internal spaces, which would make a naive split(' ') length check lie.
    const lesson = generateLesson('difficult', { paragraphItems: 2, stopOnError: true, confidenceMode: false, whitespaceMarkers: true, timedMode: false }, [], [], 30, () => 0)
    expect(lesson.kana.split(' ')).toHaveLength(2)
    expect(difficultBank.map((i) => i.kana)).toContain(lesson.kana.split(' ')[0])
  })
})

describe('gojuonBank', () => {
  const groups = (name: KanaRow['group']) => gojuonBank.filter((row) => row.group === name)

  it('covers the whole chart — 10 seion, 5 voiced, 11 contracted', () => {
    expect(groups('seion')).toHaveLength(10)
    expect(groups('dakuten')).toHaveLength(5)
    expect(groups('yoon')).toHaveLength(11)
    expect(gojuonBank).toHaveLength(26)
  })

  it('includes every row the standard chart has', () => {
    const have = new Set(gojuonBank.map((row) => row.kana))
    const expected = [
      'あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの',
      'はひふへほ', 'まみむめも', 'やゆよ', 'らりるれろ', 'わをん',
      'がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ',
      'きゃきゅきょ', 'しゃしゅしょ', 'ちゃちゅちょ', 'にゃにゅにょ', 'ひゃひゅひょ',
      'みゃみゅみょ', 'りゃりゅりょ', 'ぎゃぎゅぎょ', 'じゃじゅじょ', 'びゃびゅびょ',
      'ぴゃぴゅぴょ',
    ]
    expect(expected.filter((kana) => !have.has(kana))).toEqual([])
  })

  it('lists no row twice', () => {
    expect(new Set(gojuonBank.map((row) => row.kana)).size).toBe(gojuonBank.length)
  })

  // ぢ/づ are taught as di/du because ji/zu are the keystrokes that produce じ/ず.
  it('teaches the da row with the spellings that actually produce it', () => {
    const da = gojuonBank.find((row) => row.kana === 'だぢづでど')
    expect(da?.romaji).toBe('dadidudedo')
    const tokens = compileStrict(da as TextItem)
    expect(tokens?.map((token) => token.candidates[0])).toEqual(['da', 'di', 'du', 'de', 'do'])
  })

  it('still accepts the alternate spellings of ぢ and づ', () => {
    const da = gojuonBank.find((row) => row.kana === 'だぢづでど') as TextItem
    expect(acceptsSpelling(compileStrict(da) as RomajiToken[], 'dajizudedo')).toBe(true)
  })
})

describe('kanaRows', () => {
  it('returns the whole chart for "all"', () => {
    expect(kanaRows('all')).toHaveLength(26)
  })

  it('filters to one group', () => {
    expect(kanaRows('yoon').every((row) => row.kana.includes('ゃ') || row.kana.includes('ゅ') || row.kana.includes('ょ'))).toBe(true)
    expect(kanaRows('seion')).toHaveLength(10)
    expect(kanaRows('dakuten')).toHaveLength(5)
  })
})

describe('kana source', () => {
  const settings: Settings = { paragraphItems: 4, stopOnError: true, confidenceMode: false, whitespaceMarkers: true, timedMode: false }

  it('builds a lesson from the chart', () => {
    const lesson = generateLesson('kana', settings, [], [], 0, mulberry32(1), 'all')
    expect(lesson.source).toBe('kana')
    expect(lesson.items.every((item) => gojuonBank.includes(item as KanaRow))).toBe(true)
  })

  it('honours the requested group', () => {
    const lesson = generateLesson('kana', settings, [], [], 0, mulberry32(2), 'yoon')
    expect(lesson.items.every((item) => (item as KanaRow).group === 'yoon')).toBe(true)
  })

  // Beginners need the chart most, so gating it behind a speed threshold would
  // be exactly backwards.
  it('is available from zero wpm', () => {
    expect(sourceUnlocked('kana', 0)).toBe(true)
    expect(generateLesson('kana', settings, [], [], 0, mulberry32(3), 'all').source).toBe('kana')
  })

  // The chart is a drill you choose, not something to be handed unasked.
  it('is never chosen by auto', () => {
    expect(explicitSourcesForBest(999)).not.toContain('kana')
  })
})

describe('parseLibraryText — rejected pairs', () => {
  // The display splits on the kana's spaces and the cursor counts the romaji's.
  it('drops a pair whose kana and romaji disagree about word breaks', () => {
    expect(parseLibraryText('ひとつ ふたつ|hitotsufutatsu')).toEqual([])
    expect(parseLibraryText('みっつ|mittsu yottsu')).toEqual([])
  })

  it('keeps a pair whose word breaks agree', () => {
    expect(parseLibraryText('ひとつ ふたつ|hitotsu futatsu')).toEqual([
      { kana: 'ひとつ ふたつ', romaji: 'hitotsu futatsu' },
    ])
  })

  // An astral character compiles to a token no single keypress can produce.
  it('drops a pair whose romaji cannot be typed one key at a time', () => {
    expect(parseLibraryText('えき|ek😀i')).toEqual([])
  })
})

describe('kanji is reachable, not just present', () => {
  const hasKanji = (text: string) => /\p{Script=Han}/u.test(text)

  /*
   * The bug this guards against: kanji existed only in `quoteBank`, which is
   * gated at 50 wpm, so nobody starting out ever saw a single character of it.
   * Every correctness test passed, because they all reached the content by
   * force-unlocking the source first.
   */
  it('appears in a source available from zero wpm', () => {
    const openAtZero = sourceOptions
      .filter((option) => option.unlockAt === 0 && option.value !== 'auto')
      .map((option) => option.value)

    const banks: Partial<Record<string, TextItem[]>> = {
      kana: gojuonBank,
      drills: drillFallbackBank,
      words: wordBank,
    }
    const reachable = openAtZero.flatMap((source) => banks[source] ?? [])
    expect(reachable.some((item) => hasKanji(item.kana))).toBe(true)
  })

  it('is what `auto` serves a brand-new user some of the time', () => {
    const settings: Settings = { paragraphItems: 8, stopOnError: true, confidenceMode: false, whitespaceMarkers: true, timedMode: false }
    const seen = new Set<string>()
    const rng = mulberry32(11)
    for (let i = 0; i < 30; i++) {
      for (const item of generateLesson('auto', settings, [], [], 0, rng).items) {
        if (hasKanji(item.kana)) seen.add(item.kana)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  // Display only — the keystrokes are always the reading.
  it('never asks anyone to type a kanji character', () => {
    const everything = [...wordBank, ...difficultBank, ...quoteBank]
    const typeable = everything.filter((item) => !hasKanji(item.romaji))
    expect(typeable).toHaveLength(everything.length)
  })

  it('gives every kanji item a reading to type and to print above it', () => {
    const missing = [...wordBank, ...difficultBank, ...quoteBank]
      .filter((item) => hasKanji(item.kana) && item.reading === undefined)
      .map((item) => item.kana)
    expect(missing).toEqual([])
  })
})

describe('drillMoras', () => {
  it('lists every mora the drill corpus can teach', () => {
    expect(drillMoras.length).toBeGreaterThan(80)
    expect(drillMoras).toContain('ぎゅ')
    expect(drillMoras).toContain('っこ')
  })

  it('contains only real moras — no separators or literal characters', () => {
    expect(drillMoras.filter((mora) => !/^[ぁ-ゖァ-ヺー]+$/.test(mora))).toEqual([])
  })

  it('has no duplicates', () => {
    expect(new Set(drillMoras).size).toBe(drillMoras.length)
  })

  // Exploration only works if every corpus mora is reachable from some item.
  it('can serve a drill for every mora it lists', () => {
    const unreachable = drillMoras.filter((mora) => drillBankFromWeakKana([mora]) === drillFallbackBank)
    expect(unreachable).toEqual([])
  })
})

describe('planRun and dealLesson', () => {
  const settings = {
    paragraphItems: 4,
    stopOnError: true,
    confidenceMode: false,
    whitespaceMarkers: true,
    timedMode: true,
  }

  /*
   * `auto` picks a bank per call, so a run that deals more than once would
   * wander across words, drills and quotes while `RunResult` records a single
   * source. Resolving once is what keeps the run one kind of practice.
   */
  it('resolves auto once, and every passage comes from that source', () => {
    const plan = planRun('auto', [], [], 100, mulberry32(3))
    let current = plan
    const sources: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const dealt = dealLesson(current, settings, mulberry32(i + 1))
      sources.push(dealt.lesson.source)
      current = dealt.plan
    }
    expect(new Set(sources).size).toBe(1)
    expect(sources[0]).toBe(plan.source)
  })

  /*
   * The deck travels with the plan, so a run of several passages covers its bank
   * before repeating rather than restarting the shuffle each time.
   */
  it('carries the deck between passages', () => {
    const plan = planRun('words', [], [], 100, mulberry32(5))
    const first = dealLesson(plan, settings, mulberry32(1))
    const second = dealLesson(first.plan, settings, mulberry32(1))
    expect(first.plan.deck.remaining.length).not.toBe(plan.deck.remaining.length)
    // Same rng, but a carried deck, so the second passage is not the first again.
    expect(second.lesson.romaji).not.toBe(first.lesson.romaji)
  })

  it('falls back to words when the requested source is locked', () => {
    expect(planRun('quotes', [], [], 0, mulberry32(1)).source).toBe('words')
  })

  it('falls back to words when the library is empty', () => {
    expect(planRun('library', [], [], 100, mulberry32(1)).source).toBe('words')
  })

  it('leaves the plan it was given untouched', () => {
    const plan = planRun('words', [], [], 100, mulberry32(9))
    const before = plan.deck.remaining.length
    dealLesson(plan, settings, mulberry32(2))
    expect(plan.deck.remaining.length).toBe(before)
  })
})
