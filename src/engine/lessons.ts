import { dealRandom, pickRandom, type RandomSource } from './rng'
import type { KanaGroup, KanaRow, Lesson, Settings, SourceName, TextItem } from './types'

export const sourceOptions: { value: SourceName; label: string; unlockAt: number }[] = [
  { value: 'auto', label: 'auto', unlockAt: 0 },
  // First in the explicit list and never gated: the syllabary chart is what a
  // beginner needs most, so locking it behind a speed threshold would be exactly
  // backwards.
  { value: 'kana', label: 'kana', unlockAt: 0 },
  { value: 'drills', label: 'drills', unlockAt: 0 },
  { value: 'words', label: 'words', unlockAt: 0 },
  { value: 'difficult', label: 'difficult', unlockAt: 30 },
  { value: 'quotes', label: 'quotes', unlockAt: 50 },
  { value: 'library', label: 'library', unlockAt: 70 },
]

/**
 * Everyday vocabulary, written the way it is actually written. Words normally
 * set in kanji carry a `reading`; the greetings stay kana because that is how
 * they are written, not because they are easier.
 *
 * The kanji is display only — you still type the reading, and the furigana above
 * it means a beginner can read the word without knowing the characters. Which is
 * the point: this is the source someone meets first, so it is where kanji has to
 * appear if it is going to appear at all.
 */
export const wordBank: TextItem[] = [
  { kana: 'おはよう', romaji: 'ohayou' },
  // は here is the topic particle, read `wa`. Displayed as written, typed as spoken.
  { kana: 'こんにちは', romaji: 'konnichiwa', reading: 'こんにちわ' },
  { kana: 'ありがとう', romaji: 'arigatou' },
  { kana: 'すみません', romaji: 'sumimasen' },
  { kana: '友達', reading: 'ともだち', romaji: 'tomodachi' },
  { kana: '先生', reading: 'せんせい', romaji: 'sensei' },
  { kana: '学生', reading: 'がくせい', romaji: 'gakusei' },
  { kana: '電車', reading: 'でんしゃ', romaji: 'densha' },
  { kana: '時間', reading: 'じかん', romaji: 'jikan' },
  { kana: '日本語', reading: 'にほんご', romaji: 'nihongo' },
  { kana: '食べ物', reading: 'たべもの', romaji: 'tabemono' },
  { kana: '飲み物', reading: 'のみもの', romaji: 'nomimono' },
  { kana: '明日', reading: 'あした', romaji: 'ashita' },
  { kana: '今日', reading: 'きょう', romaji: 'kyou' },
  { kana: '昨日', reading: 'きのう', romaji: 'kinou' },
  { kana: '駅', reading: 'えき', romaji: 'eki' },
  { kana: '町', reading: 'まち', romaji: 'machi' },
  { kana: '本', reading: 'ほん', romaji: 'hon' },
  { kana: '飛行機', reading: 'ひこうき', romaji: 'hikouki' },
  { kana: '会社', reading: 'かいしゃ', romaji: 'kaisha' },
  { kana: '写真', reading: 'しゃしん', romaji: 'shashin' },
  { kana: '料理', reading: 'りょうり', romaji: 'ryouri' },
  { kana: '映画', reading: 'えいが', romaji: 'eiga' },
  { kana: '手紙', reading: 'てがみ', romaji: 'tegami' },
]

/** Words chosen for the typing, not the reading: sokuon and yōon throughout. */
export const difficultBank: TextItem[] = [
  { kana: '学校', reading: 'がっこう', romaji: 'gakkou' },
  { kana: '切手', reading: 'きって', romaji: 'kitte' },
  { kana: '雑誌', reading: 'ざっし', romaji: 'zasshi' },
  { kana: '宿題', reading: 'しゅくだい', romaji: 'shukudai' },
  { kana: '授業', reading: 'じゅぎょう', romaji: 'jugyou' },
  { kana: '病院', reading: 'びょういん', romaji: 'byouin' },
  { kana: '旅行', reading: 'りょこう', romaji: 'ryokou' },
  { kana: '客', reading: 'きゃく', romaji: 'kyaku' },
  { kana: 'ちょっと', romaji: 'chotto' },
  { kana: '新聞', reading: 'しんぶん', romaji: 'shinbun' },
  { kana: '本屋', reading: 'ほんや', romaji: 'honya' },
  { kana: '今夜', reading: 'こんや', romaji: 'konya' },
  { kana: '茶碗', reading: 'ちゃわん', romaji: 'chawan' },
  { kana: '注射', reading: 'ちゅうしゃ', romaji: 'chuusha' },
  { kana: '貯金', reading: 'ちょきん', romaji: 'chokin' },
]

/**
 * The 五十音図, one row per exercise item — the unit every Japanese typing site
 * drills in (`がぎぐげご` is one item, not five). Ordered as the chart is:
 * seion, then the voiced and semi-voiced rows, then the contracted rows.
 *
 * Two romanisation choices are deliberate and differ from the table's defaults:
 * ぢ is taught as `di` and づ as `du`, because `ji`/`zu` are the keystrokes that
 * produce じ/ず. Every alternate is still accepted — this only sets what the
 * hint shows (see `compileStrict`).
 */
export const gojuonBank: KanaRow[] = [
  { group: 'seion', kana: 'あいうえお', romaji: 'aiueo' },
  { group: 'seion', kana: 'かきくけこ', romaji: 'kakikukeko' },
  { group: 'seion', kana: 'さしすせそ', romaji: 'sashisuseso' },
  { group: 'seion', kana: 'たちつてと', romaji: 'tachitsuteto' },
  { group: 'seion', kana: 'なにぬねの', romaji: 'naninuneno' },
  { group: 'seion', kana: 'はひふへほ', romaji: 'hahifuheho' },
  { group: 'seion', kana: 'まみむめも', romaji: 'mamimumemo' },
  { group: 'seion', kana: 'やゆよ', romaji: 'yayuyo' },
  { group: 'seion', kana: 'らりるれろ', romaji: 'rarirurero' },
  { group: 'seion', kana: 'わをん', romaji: 'wawon' },

  { group: 'dakuten', kana: 'がぎぐげご', romaji: 'gagigugego' },
  { group: 'dakuten', kana: 'ざじずぜぞ', romaji: 'zajizuzezo' },
  { group: 'dakuten', kana: 'だぢづでど', romaji: 'dadidudedo' },
  { group: 'dakuten', kana: 'ばびぶべぼ', romaji: 'babibubebo' },
  { group: 'dakuten', kana: 'ぱぴぷぺぽ', romaji: 'papipupepo' },

  { group: 'yoon', kana: 'きゃきゅきょ', romaji: 'kyakyukyo' },
  { group: 'yoon', kana: 'しゃしゅしょ', romaji: 'shashusho' },
  { group: 'yoon', kana: 'ちゃちゅちょ', romaji: 'chachucho' },
  { group: 'yoon', kana: 'にゃにゅにょ', romaji: 'nyanyunyo' },
  { group: 'yoon', kana: 'ひゃひゅひょ', romaji: 'hyahyuhyo' },
  { group: 'yoon', kana: 'みゃみゅみょ', romaji: 'myamyumyo' },
  { group: 'yoon', kana: 'りゃりゅりょ', romaji: 'ryaryuryo' },
  { group: 'yoon', kana: 'ぎゃぎゅぎょ', romaji: 'gyagyugyo' },
  { group: 'yoon', kana: 'じゃじゅじょ', romaji: 'jajujo' },
  { group: 'yoon', kana: 'びゃびゅびょ', romaji: 'byabyubyo' },
  { group: 'yoon', kana: 'ぴゃぴゅぴょ', romaji: 'pyapyupyo' },
]

/** Rows for one group of the chart, or the whole chart. */
export function kanaRows(group: KanaGroup): TextItem[] {
  return group === 'all' ? gojuonBank : gojuonBank.filter((row) => row.group === group)
}

/**
 * What `drills` falls back to before there are any misses to target. The
 * contracted rows are held back — they're the last thing a syllabary course
 * teaches, and throwing りゃりゅりょ at someone on their first run isn't a drill,
 * it's a wall. The dedicated kana source exposes every group directly.
 */
export const drillFallbackBank: TextItem[] = gojuonBank.filter((row) => row.group !== 'yoon')

/**
 * Proverbs written the way they're actually written — with kanji — and read via
 * `reading`. You still only ever type kana: the display and the keystrokes are
 * separate concerns, which is how every Japanese typing site works.
 *
 * The reading has to mirror the display's word breaks, since the two are zipped
 * per word to place the furigana.
 */
export const quoteBank: TextItem[] = [
  { kana: '七転び 八起き', reading: 'ななころび やおき', romaji: 'nanakorobi yaoki' },
  { kana: '急がば 回れ', reading: 'いそがば まわれ', romaji: 'isogaba maware' },
  { kana: '塵も積もれば 山となる', reading: 'ちりもつもれば やまとなる', romaji: 'chirimotsumoreba yamatonaru' },
  { kana: '好きこそ 物の上手なれ', reading: 'すきこそ もののじょうずなれ', romaji: 'sukikoso mononojouzunare' },
  { kana: '雨降って 地固まる', reading: 'あめふって じかたまる', romaji: 'amefutte jikatamaru' },
  { kana: '石の上にも 三年', reading: 'いしのうえにも さんねん', romaji: 'ishinouenimo sannen' },
]

export const sourceBanks: Record<
  Exclude<SourceName, 'auto' | 'kana' | 'drills' | 'library'>,
  TextItem[]
> = {
  difficult: difficultBank,
  quotes: quoteBank,
  words: wordBank,
}

function stripMarkdownChars(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()!-]/g, ' ')
}

export function parseLibraryText(text: string): TextItem[] {
  return stripMarkdownChars(text)
    .split(/\n|。|、|\.|,|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawKana, rawRomaji] = part.includes('|') ? part.split('|') : part.split(/\s{2,}/)
      if (!rawKana || !rawRomaji) return null
      const kana = rawKana.trim()
      const romaji = rawRomaji.trim().toLowerCase()
      // The display splits on the kana's spaces and the cursor counts the
      // romaji's, so a pair that disagrees about where the words are highlights
      // the wrong one. Dropping it asks the author to add the missing space.
      if (kana.split(' ').length !== romaji.split(' ').length) return null
      // Every token has to be reachable by one keypress. An astral character
      // compiles to a token that `applyTypeChar` can never accept, leaving the
      // lesson impossible to finish.
      if (romaji.length !== [...romaji].length) return null
      return { kana, romaji }
    })
    .filter((item): item is TextItem => item !== null)
}

export function buildParagraph(
  items: TextItem[],
  source: SourceName,
  length: number,
  rng: RandomSource = Math.random,
): Lesson {
  const picked = dealRandom(items, length, rng)
  return {
    kana: picked.map((item) => item.kana).join(' '),
    romaji: picked.map((item) => item.romaji).join(' '),
    source,
    items: picked,
  }
}

export function drillBankFromMisses(misses: Record<string, number>): TextItem[] {
  const weakLetters = Object.entries(misses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([letter]) => letter)

  if (weakLetters.length === 0) return drillFallbackBank

  const candidates = [...wordBank, ...difficultBank, ...drillFallbackBank].filter((item) =>
    weakLetters.some((letter) => item.romaji.includes(letter)),
  )
  return candidates.length > 0 ? candidates : drillFallbackBank
}

export function sourceUnlockAt(source: SourceName): number {
  return sourceOptions.find((option) => option.value === source)?.unlockAt ?? 0
}

export function sourceUnlocked(source: SourceName, best: number): boolean {
  return best >= sourceUnlockAt(source)
}

/**
 * What `auto` rotates through. `kana` is excluded deliberately: the syllabary
 * chart is a drill you choose, not something to be handed unasked in the middle
 * of word practice. `drills` already covers wanting syllabary work automatically.
 */
export function explicitSourcesForBest(best: number): Exclude<SourceName, 'auto'>[] {
  return sourceOptions
    .filter(
      (option) =>
        option.value !== 'auto' && option.value !== 'library' && option.value !== 'kana',
    )
    .filter((option) => sourceUnlocked(option.value, best))
    .map((option) => option.value as Exclude<SourceName, 'auto'>)
}

export function generateLesson(
  requestedSource: SourceName,
  settings: Settings,
  misses: Record<string, number>,
  library: TextItem[],
  bestWpmValue = 0,
  rng: RandomSource = Math.random,
  kanaGroup: KanaGroup = 'all',
): Lesson {
  const usableSource =
    !sourceUnlocked(requestedSource, bestWpmValue)
      ? 'words'
      : requestedSource === 'library' && library.length === 0
        ? 'words'
        : requestedSource === 'auto'
          ? pickRandom<Exclude<SourceName, 'auto' | 'library'>>(
              explicitSourcesForBest(bestWpmValue).filter(
                (item): item is Exclude<SourceName, 'auto' | 'library'> => item !== 'library',
              ),
              rng,
            )
          : requestedSource

  if (usableSource === 'kana') {
    return buildParagraph(kanaRows(kanaGroup), 'kana', settings.paragraphItems, rng)
  }
  if (usableSource === 'drills') {
    return buildParagraph(drillBankFromMisses(misses), 'drills', settings.paragraphItems, rng)
  }
  if (usableSource === 'library') {
    return buildParagraph(library, 'library', settings.paragraphItems, rng)
  }
  return buildParagraph(sourceBanks[usableSource], usableSource, settings.paragraphItems, rng)
}
