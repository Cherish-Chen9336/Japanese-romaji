import { isMoraToken, tokenizeKana } from './romanization'
import { dealFrom, newDeck, pickRandom, type Deck, type RandomSource } from './rng'
import type { KanaGroup, KanaRow, Lesson, Settings, SourceName, TextItem } from './types'

/*
 * Every source, available from the first run.
 *
 * `difficult`, `quotes` and `library` used to unlock at 30, 50 and 70 wpm. The
 * gate is gone: a learner who wants harder material, or their own text, should
 * not have to earn it at a speed they are not there to chase. `library` made the
 * case plainest — it is the typist's own upload, withheld until they were fast
 * enough to read back what they had already given the app.
 */
export const sourceOptions: { value: SourceName; label: string }[] = [
  { value: 'auto', label: 'auto' },
  // First in the explicit list and never gated: the syllabary chart is what a
  // beginner needs most, so locking it behind a speed threshold would be exactly
  // backwards.
  { value: 'kana', label: 'kana' },
  { value: 'drills', label: 'drills' },
  { value: 'words', label: 'words' },
  { value: 'difficult', label: 'difficult' },
  { value: 'quotes', label: 'quotes' },
  { value: 'library', label: 'library' },
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

/**
 * Every bundled item, from one place.
 *
 * Invariants over "the whole corpus" — that each item is typeable, that the
 * mastery chart covers what is actually tracked — were each written against a
 * hand-listed set of banks, so a bank added later was simply outside them until
 * someone remembered. Deriving the list from `sourceBanks` plus the chart makes
 * a new bank join those invariants by existing.
 */
export function allBankItems(): TextItem[] {
  return [...Object.values(sourceBanks).flat(), ...gojuonBank]
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

/** The moras an item is actually made of, as the matcher and the stats see it. */
export function itemMoras(item: TextItem): string[] {
  return tokenizeKana(item.reading ?? item.kana)
    .map((token) => token.kana)
    .filter(isMoraToken)
}

/** Every mora the drill corpus can actually teach. */
export const drillMoras: readonly string[] = [
  ...new Set([...gojuonBank, ...wordBank, ...difficultBank].flatMap(itemMoras)),
]

/**
 * Practice material for the moras a typist is weakest at.
 *
 * Matched against the item's **tokens**, not against its text. A substring test
 * disagrees with the model that produced the weakness: し appears inside しゃ,
 * so weak し selected でんしゃ, かいしゃ and しゃしゅしょ — none of which contain
 * a standalone し at all. Those drills spent encounters without ever touching
 * the weakness that chose them, which quietly breaks the feedback loop. Same for
 * こ inside っこ, which the stats record as one mora.
 *
 * Selecting on moras rather than Latin letters was the earlier half of this:
 * letter selection over-picked wildly, because a miss on any vowel matched
 * nearly every item in every bank.
 */
export function drillBankFromWeakKana(weak: readonly string[]): TextItem[] {
  if (weak.length === 0) return drillFallbackBank

  const wanted = new Set(weak)
  const candidates = [...gojuonBank, ...wordBank, ...difficultBank].filter((item) =>
    itemMoras(item).some((mora) => wanted.has(mora)),
  )
  return candidates.length > 0 ? candidates : drillFallbackBank
}

/**
 * What `auto` rotates through. `kana` is excluded deliberately: the syllabary
 * chart is a drill you choose, not something to be handed unasked in the middle
 * of word practice. `drills` already covers wanting syllabary work automatically.
 */
export function autoSources(): Exclude<SourceName, 'auto'>[] {
  return sourceOptions
    .filter(
      (option) =>
        option.value !== 'auto' && option.value !== 'library' && option.value !== 'kana',
    )
    .map((option) => option.value as Exclude<SourceName, 'auto'>)
}

/**
 * The material a run is committed to, fixed at the moment it starts.
 *
 * A run that outlives its passage cannot re-resolve its source each time it
 * deals: `auto` picks a bank per call, so one timed run would wander across
 * words, drills and quotes while `RunResult` records a single source. The deck
 * travels with the plan for the same reason dealing carries one at all — two
 * deals from a fresh deck can repeat an item across the boundary.
 */
export type RunPlan = {
  source: Exclude<SourceName, 'auto'>
  deck: Deck<TextItem>
}

/** Resolves the source once — unlock gating, empty library, `auto` — and no more. */
export function planRun(
  requestedSource: SourceName,
  weakKana: readonly string[],
  library: TextItem[],
  rng: RandomSource,
  kanaGroup: KanaGroup = 'all',
): RunPlan {
  // The only fallback left is a library with nothing in it, which is a real
  // emptiness rather than a permission.
  const usableSource: Exclude<SourceName, 'auto'> =
    requestedSource === 'library' && library.length === 0
      ? 'words'
      : requestedSource === 'auto'
        ? pickRandom<Exclude<SourceName, 'auto' | 'library'>>(
            autoSources().filter(
              (item): item is Exclude<SourceName, 'auto' | 'library'> => item !== 'library',
            ),
            rng,
          )
        : requestedSource

  const items =
    usableSource === 'kana'
      ? kanaRows(kanaGroup)
      : usableSource === 'drills'
        ? drillBankFromWeakKana(weakKana)
        : usableSource === 'library'
          ? library
          : sourceBanks[usableSource]

  return { source: usableSource, deck: newDeck(items) }
}

/** One passage from the plan, and the plan to deal the next one from. */
export function dealLesson(
  plan: RunPlan,
  settings: Settings,
  rng: RandomSource,
): { lesson: Lesson; plan: RunPlan } {
  const { dealt, deck } = dealFrom(plan.deck, settings.paragraphItems, rng)
  return {
    lesson: {
      kana: dealt.map((item) => item.kana).join(' '),
      romaji: dealt.map((item) => item.romaji).join(' '),
      source: plan.source,
      items: dealt,
    },
    plan: { ...plan, deck },
  }
}

export function generateLesson(
  requestedSource: SourceName,
  settings: Settings,
  weakKana: readonly string[],
  library: TextItem[],
  rng: RandomSource,
  kanaGroup: KanaGroup = 'all',
): Lesson {
  return dealLesson(planRun(requestedSource, weakKana, library, rng, kanaGroup), settings, rng).lesson
}
