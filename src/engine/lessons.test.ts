import { describe, expect, it } from 'vitest'
import {
  dealLesson,
  planRun,
  parsePastedText,
  MAX_LIBRARY_ITEM_CHARS,
  derivedRomaji,
  autoSources,
  difficultBank,
  drillBankFromWeakKana,
  drillMoras,
  itemMoras,
  drillFallbackBank,
  generateLesson,
  gojuonBank,
  kanaRows,
  katakanaBank,
  sourceOptions,
  parseLibraryText,
  quoteBank,
  wordBank,
  bundledTexts,
  lessonForText,
  libraryTexts,
  sourceBanks,
} from './lessons'
import { acceptsSpelling, compileStrict } from './prompt'
import type { RomajiToken } from './romanization'
import { mulberry32 } from './rng'
import type { KanaRow, Settings, TextItem } from './types'
import { toKatakana } from './romanization'
import { SOURCE_LABELS } from './types'

describe('kanaRows', () => {
  it('deals hiragana unless asked otherwise', () => {
    expect(kanaRows('all').map((row) => row.kana)).toEqual(gojuonBank.map((row) => row.kana))
    expect(kanaRows('all', 'hiragana')).toEqual(kanaRows('all'))
  })

  /* Mirrored from the same bank, so a row can never exist in one script and
     not the other — the same guarantee the mastery chart's grids have. */
  it('mirrors every row into katakana, keeping the spelling and the group', () => {
    expect(katakanaBank).toEqual(
      gojuonBank.map((row) => ({ ...row, kana: toKatakana(row.kana) })),
    )
    expect(kanaRows('all', 'katakana').map((row) => row.kana)).toContain('アイウエオ')
    expect(kanaRows('all', 'katakana').map((row) => row.kana)).toContain('ワヲン')
  })

  it('deals both scripts when asked for both', () => {
    expect(kanaRows('all', 'both')).toHaveLength(gojuonBank.length * 2)
  })

  /* Script and group are separate axes, and crossing them is the point: the
     voiced katakana rows are their own thing to practise. */
  it('crosses the script with the group rather than replacing it', () => {
    expect(kanaRows('yoon', 'katakana').map((row) => row.kana)).toEqual(
      gojuonBank.filter((row) => row.group === 'yoon').map((row) => toKatakana(row.kana)),
    )
    expect(kanaRows('dakuten', 'both')).toHaveLength(
      gojuonBank.filter((row) => row.group === 'dakuten').length * 2,
    )
  })

  /* Every katakana row has to be typeable, exactly as the hiragana rows are —
     `prompt.test.ts` sweeps the banks, and this bank is derived, so a mirror
     that produced an unspellable row would otherwise fail far from its cause. */
  it('compiles every katakana row to its own spelling', () => {
    const broken = katakanaBank.filter((row) => compileStrict(row) === null)
    expect(broken).toEqual([])
  })
})

describe('drills reaching katakana', () => {
  /*
   * Opened by making the 五十音 drill deal katakana: ヲ and the palatalized
   * katakana rows appear nowhere else in the corpus, so a weakness there used
   * to select nothing and fall through to the hiragana fallback — the chart
   * naming a weakness the drills could not take you to.
   */
  it('finds a drill for a mora only the katakana rows contain', () => {
    const items = drillBankFromWeakKana(['ヲ'])
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => itemMoras(item).includes('ヲ'))).toBe(true)
  })

  it('offers katakana among the moras a drill can target', () => {
    expect(drillMoras).toContain('ヲ')
    expect(drillMoras).toContain('キョ')
    expect(drillMoras).toContain('を')
  })

  /* And costs nothing to a typist who has never met katakana: the filter is on
     weak moras, so there is nothing katakana for it to select. */
  it('leaves a hiragana weakness drawing on hiragana', () => {
    const items = drillBankFromWeakKana(['き'])
    expect(items.length).toBeGreaterThan(0)
    expect(items.some((item) => /[\u30A1-\u30FA]/.test(item.kana))).toBe(false)
  })
})

describe('SOURCE_LABELS', () => {
  it('gives every source in the picker a label', () => {
    const unlabelled = sourceOptions.filter((option) => !SOURCE_LABELS[option.value])
    expect(unlabelled).toEqual([])
  })

  /*
   * The label may differ from the name; the name may not move. `quotes` is
   * written into the stored source preference and into `RunResult.source` on
   * every run ever recorded, so renaming the value would strand that history
   * in a cohort nothing matches. The bank holds proverbs, so the *label* says
   * proverbs and the value stays put.
   */
  it('shows the proverb bank as proverbs while keeping its stored name', () => {
    expect(SOURCE_LABELS.quotes).toBe('proverbs')
    expect(sourceOptions.map((option) => option.value)).toContain('quotes')
  })

  /* None of the fourteen is a quotation, and none carries a quotation mark —
     which is what made the old label wrong rather than merely loose. */
  it('has no quotation marks in the bank that used to be called quotes', () => {
    const quoted = quoteBank.filter((item) => /[「」『』"']/.test(item.kana))
    expect(quoted).toEqual([])
  })
})

const settings: Settings = { paragraphItems: 3, stopOnError: true, confidenceMode: false, whitespaceMarkers: true, timedMode: false }

describe('parseLibraryText', () => {
  it('parses pipe-delimited kana|romaji lines', () => {
    expect(parseLibraryText('おはよう|ohayou\nありがとう|Arigatou')).toEqual([
      { kana: 'おはよう', romaji: 'ohayou' },
      { kana: 'ありがとう', romaji: 'arigatou' },
    ])
  })

  /*
   * The double space used to delimit the pair. It cannot: a gap between two
   * Japanese words is a word break far more often than it is a separator, and
   * reading `ねこ  いぬ` as kana-plus-romaji saved an entry nobody could type.
   */
  it('no longer treats a double space as a delimiter', () => {
    expect(parseLibraryText('きょう  kyou')).toEqual([])
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

describe('generateLesson', () => {
  it('gives the requested source, whatever the typist\'s speed', () => {
    expect(generateLesson('quotes', settings, [], [], () => 0).source).toBe('quotes')
  })

  it('falls back to words when library is requested but empty', () => {
    const lesson = generateLesson('library', settings, [], [], () => 0)
    expect(lesson.source).toBe('words')
  })

  it('uses the user library when requested and non-empty', () => {
    const library = [{ kana: 'てすと', romaji: 'tesuto' }]
    const lesson = generateLesson('library', settings, [], library, () => 0)
    expect(lesson.source).toBe('library')
    expect(lesson.kana.split(' ').every((part) => part === 'てすと')).toBe(true)
  })

  it('drills source pulls from the miss-weighted bank', () => {
    const lesson = generateLesson('drills', settings, [], [], () => 0)
    expect(lesson.source).toBe('drills')
  })

  it('auto picks among the explicit sources via the injected rng', () => {
    // rng() = 0 always selects the first entry, deterministic given the fixed
    // `sourceOptions` order.
    const expectedFirst = autoSources().filter((s) => s !== 'library')[0]
    const lesson = generateLesson('auto', settings, [], [], () => 0)
    expect(lesson.source).toBe(expectedFirst)
  })

  it('requesting a source unlocked at the given wpm uses that source directly', () => {
    const lesson = generateLesson('difficult', settings, [], [], () => 0)
    expect(lesson.source).toBe('difficult')
    expect(difficultBank.map((i) => i.kana)).toContain(lesson.kana.split(' ')[0])
  })

  it('respects settings.paragraphItems for word count', () => {
    // Uses `difficult`, not `quotes` — quote-bank kana strings contain
    // internal spaces, which would make a naive split(' ') length check lie.
    const lesson = generateLesson('difficult', { paragraphItems: 2, stopOnError: true, confidenceMode: false, whitespaceMarkers: true, timedMode: false }, [], [], () => 0)
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
    const lesson = generateLesson('kana', settings, [], [], mulberry32(1), 'all')
    expect(lesson.source).toBe('kana')
    expect(lesson.items.every((item) => gojuonBank.includes(item as KanaRow))).toBe(true)
  })

  it('honours the requested group', () => {
    const lesson = generateLesson('kana', settings, [], [], mulberry32(2), 'yoon')
    expect(lesson.items.every((item) => (item as KanaRow).group === 'yoon')).toBe(true)
  })

  it('is available on request', () => {
    expect(generateLesson('kana', settings, [], [], mulberry32(3), 'all').source).toBe('kana')
  })

  // The chart is a drill you choose, not something to be handed unasked.
  it('is never chosen by auto', () => {
    expect(autoSources()).not.toContain('kana')
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
  it('appears in a source the typist can actually reach', () => {
    const openAtZero = sourceOptions
      .filter((option) => option.value !== 'auto')
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
      for (const item of generateLesson('auto', settings, [], [], rng).items) {
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
    const plan = planRun('auto', [], [], mulberry32(3))
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
    const plan = planRun('words', [], [], mulberry32(5))
    const first = dealLesson(plan, settings, mulberry32(1))
    const second = dealLesson(first.plan, settings, mulberry32(1))
    expect(first.plan.deck.remaining.length).not.toBe(plan.deck.remaining.length)
    // Same rng, but a carried deck, so the second passage is not the first again.
    expect(second.lesson.romaji).not.toBe(first.lesson.romaji)
  })

  /*
   * A library of one entry used to be dealt as that entry eight times over,
   * because `paragraphItems` counts items and nothing said a passage may not
   * repeat itself. Saved text is a thing someone chose, not padding.
   */
  it('does not repeat an entry inside one passage', () => {
    const paragraph = {
      kana: '今日 はいい 天気 です',
      reading: 'きょう わいい てんき です',
      romaji: 'kyou waii tenki desu',
    }
    const plan = planRun('library', [], [paragraph], mulberry32(1))
    const { lesson } = dealLesson(plan, settings, mulberry32(2))
    expect(lesson.items).toEqual([paragraph])
    expect(lesson.romaji).toBe('kyou waii tenki desu')
  })

  /* Short entries still group: the bound is on typing, not on being saved. */
  it('still fills a passage from short saved entries', () => {
    const words = ['ねこ', 'いぬ', 'とり', 'さかな', 'うま', 'ひつじ'].map((kana) => ({
      kana,
      romaji: derivedRomaji(kana) as string,
    }))
    const plan = planRun('library', [], words, mulberry32(1))
    const { lesson } = dealLesson(plan, settings, mulberry32(2))
    expect(lesson.items).toHaveLength(4)
    expect(new Set(lesson.items.map((i) => i.kana)).size).toBe(4)
  })

  /* One paragraph is already a passage; a second would be a second text. */
  it('stops a passage once it holds enough typing', () => {
    const paragraphs = Array.from({ length: 5 }, (_, n) => ({
      kana: `ね${'こ'.repeat(120)}${n}`,
      romaji: `ne${'ko'.repeat(120)}`,
    }))
    const plan = planRun('library', [], paragraphs, mulberry32(1))
    const { lesson } = dealLesson(plan, settings, mulberry32(2))
    expect(lesson.items).toHaveLength(1)
  })

  /*
   * The bound is the longest bundled item times the count asked for, so no
   * bundled bank can reach it — the eight longest quotes come to 180 against a
   * bound of 216. Guards that in both directions.
   */
  it('leaves every bundled bank dealing the full count', () => {
    const eight = { ...settings, paragraphItems: 8 }
    for (const source of ['words', 'quotes', 'difficult', 'kana'] as const) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const plan = planRun(source, [], [], mulberry32(seed), 'all')
        expect(dealLesson(plan, eight, mulberry32(seed)).lesson.items, source).toHaveLength(8)
      }
    }
  })

  it('leaves the plan it was given untouched', () => {
    const plan = planRun('words', [], [], mulberry32(9))
    const before = plan.deck.remaining.length
    dealLesson(plan, settings, mulberry32(2))
    expect(plan.deck.remaining.length).toBe(before)
  })
})

describe('every source is available from the first run', () => {

  /*
   * `difficult`, `quotes` and `library` used to unlock at 30, 50 and 70 wpm.
   * Nothing is withheld now — least of all `library`, which is the typist's own
   * upload and was being kept from them until they were fast enough.
   */
  it('honours a request for a source that used to be gated', () => {
    for (const source of ['difficult', 'quotes'] as const) {
      expect(planRun(source, [], [], mulberry32(1)).source).toBe(source)
    }
  })

  it('gives a typist their own library at any speed', () => {
    const mine = [{ kana: 'ねこ', romaji: 'neko' }]
    expect(planRun('library', [], mine, mulberry32(1)).source).toBe('library')
  })

  /* The one fallback left is real emptiness, not a permission. */
  it('falls back to words only when the library is actually empty', () => {
    expect(planRun('library', [], [], mulberry32(1)).source).toBe('words')
  })

  it('lets auto reach the formerly gated banks', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i += 1) seen.add(planRun('auto', [], [], mulberry32(i)).source)
    expect(seen.has('difficult')).toBe(true)
    expect(seen.has('quotes')).toBe(true)
  })
})

describe('library text without an explicit reading', () => {
  /*
   * Requiring `かな|romaji` made the obvious thing — pasting Japanese — produce
   * nothing at all, silently. The kana can supply its own reading, so it does.
   */
  it('works out the romaji for kana', () => {
    expect(derivedRomaji('おはよう')).toBe('ohayou')
    expect(derivedRomaji('きょうはいいてんきです')).toBe('kyouhaiitenkidesu')
  })

  it('keeps word breaks so the display and the cursor agree', () => {
    expect(derivedRomaji('ねこ いぬ')).toBe('neko inu')
  })

  /* Kanji has no reading to derive — that is why it still needs one given. */
  /* A double space splits into an empty word, which has no spelling at all. */
  it('gives up when a word segment is empty', () => {
    expect(derivedRomaji('ねこ  いぬ')).toBeNull()
    expect(derivedRomaji('')).toBeNull()
  })

  it('gives up on anything that is not kana', () => {
    expect(derivedRomaji('学校')).toBeNull()
    expect(derivedRomaji('ねこ cat')).toBeNull()
  })

  /* Katakana is kana, and used to be refused as though it were not. */
  it('works out the romaji for katakana too', () => {
    expect(derivedRomaji('カナ')).toBe('kana')
    expect(derivedRomaji('キャベツ')).toBe('kyabetsu')
    expect(derivedRomaji('ニホンゴ')).toBe('nihongo')
  })

  it('holds the vowel across ー', () => {
    expect(derivedRomaji('コーヒー')).toBe('koohii')
    expect(derivedRomaji('ラーメン')).toBe('raamen')
    expect(derivedRomaji('らーめん')).toBe('raamen')
  })

  /* No vowel to hold is no reading, said rather than guessed at. */
  it('gives up where ー follows nothing it can lengthen', () => {
    expect(derivedRomaji('ンー')).toBeNull()
    expect(derivedRomaji('ー')).toBeNull()
  })

  it('accepts a bare kana line', () => {
    const { items, rejected } = parsePastedText('おはよう')
    expect(items).toEqual([{ kana: 'おはよう', romaji: 'ohayou' }])
    expect(rejected).toEqual([])
  })

  /*
   * ー was in the punctuation list and came out as a space. らーめん was saved
   * as the two words `ら めん`, and コーヒー as `コ ヒ`, which no longer matched
   * its own romaji — so a loanword was either corrupted or refused outright.
   */
  it('keeps the length mark instead of deleting it', () => {
    expect(parsePastedText('らーめん').items).toEqual([
      { kana: 'らーめん', romaji: 'raamen' },
    ])
    expect(parsePastedText('コーヒー').items).toEqual([
      { kana: 'コーヒー', romaji: 'koohii' },
    ])
    expect(parsePastedText('コーヒー|koohii').items).toEqual([
      { kana: 'コーヒー', romaji: 'koohii' },
    ])
  })

  it('still takes an explicit reading, and prefers it', () => {
    expect(parsePastedText('こんにちは|konnichiwa').items).toEqual([
      { kana: 'こんにちは', romaji: 'konnichiwa' },
    ])
  })

  /* The reasons exist so the page can say *why*, not merely that it failed. */
  it('reports why a line was refused', () => {
    expect(parsePastedText('学校').rejected).toEqual([{ line: '学校', reason: 'no-reading' }])
    expect(parsePastedText('ねこ いぬ|neko').rejected[0].reason).toBe('word-mismatch')
  })

  /*
   * The parser and storage have to agree on what fits. They did not: a longer
   * line was accepted, saved, practised once, and then silently dropped the next
   * time the profile loaded.
   */
  /*
   * A double space used to split the pair, so a second Japanese word was read as
   * the romaji for the first — saved, and impossible to type. `|` only now.
   */
  it('treats a wide gap as a word break, not a delimiter', () => {
    expect(parsePastedText('ねこ  いぬ').items).toEqual([{ kana: 'ねこ いぬ', romaji: 'neko inu' }])
  })

  /* Ordinary sentence punctuation is not an unsupported character. */
  it('drops Japanese punctuation rather than failing on it', () => {
    for (const line of ['おはよう！', 'おはよう？', '「おはよう」', 'おはよう　']) {
      expect(parsePastedText(line).items, line).toEqual([{ kana: 'おはよう', romaji: 'ohayou' }])
    }
  })

  it('refuses a line longer than storage will read back', () => {
    const long = 'あ'.repeat(MAX_LIBRARY_ITEM_CHARS + 1)
    expect(parsePastedText(long).items).toEqual([])
    expect(parsePastedText(long).rejected[0].reason).toBe('too-long')
  })

  it('accepts a line exactly at the limit', () => {
    expect(parsePastedText('あ'.repeat(MAX_LIBRARY_ITEM_CHARS)).items).toHaveLength(1)
  })

  it('takes the good lines and reports the rest', () => {
    const { items, rejected } = parsePastedText('おはよう\n学校\nねこ')
    expect(items.map((item) => item.kana)).toEqual(['おはよう', 'ねこ'])
    expect(rejected).toHaveLength(1)
  })
})

describe('lessonForText', () => {
  it('keeps the items in the order they were written', () => {
    const text = {
      id: 'walk',
      title: 'A morning walk',
      source: 'sentences' as const,
      items: [
        { kana: '朝 です', reading: 'あさ です', romaji: 'asa desu' },
        { kana: '犬 と 歩きます', reading: 'いぬ と あるきます', romaji: 'inu to arukimasu' },
      ],
    }
    expect(lessonForText(text)).toEqual({
      kana: '朝 です 犬 と 歩きます',
      romaji: 'asa desu inu to arukimasu',
      source: 'sentences',
      items: text.items,
    })
  })

  /* One sentence is a text too — that is what the library list practises. */
  it('builds a lesson from a single item', () => {
    const text = {
      id: 'one',
      source: 'sentences' as const,
      items: [{ kana: 'ねこ', romaji: 'neko' }],
    }
    expect(lessonForText(text)).toEqual({
      kana: 'ねこ',
      romaji: 'neko',
      source: 'sentences',
      items: text.items,
    })
  })
})

describe('bundledTexts', () => {
  it('offers every sentence under an id of its own', () => {
    const texts = bundledTexts()
    expect(texts.length).toBeGreaterThan(0)
    expect(new Set(texts.map((t) => t.id)).size).toBe(texts.length)
    // The pool and the choosable texts are the same Japanese, not two copies.
    expect(texts.flatMap((t) => t.items)).toEqual(sourceBanks.sentences)
  })

  /*
   * The display and the romaji have to break into the same words, or the cursor
   * highlights one word while the typist is on another. Each *item* is checked
   * against the four content rules in `prompt.test.ts`; this is about what
   * joining them produces.
   */
  it('builds a lesson whose kana and romaji agree about the words', () => {
    for (const text of bundledTexts()) {
      const lesson = lessonForText(text)
      expect(lesson.kana.split(' ')).toHaveLength(lesson.romaji.split(' ').length)
    }
  })
})

describe('libraryTexts', () => {
  it('offers each saved entry on its own, and nothing for an empty library', () => {
    const saved = [
      { kana: 'ねこ', romaji: 'neko' },
      { kana: '学校', reading: 'がっこう', romaji: 'gakkou' },
    ]
    expect(libraryTexts(saved)).toEqual([
      { id: 'library-0', source: 'library', items: [saved[0]] },
      { id: 'library-1', source: 'library', items: [saved[1]] },
    ])
    expect(libraryTexts([])).toEqual([])
  })
})
