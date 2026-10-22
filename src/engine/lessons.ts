import { isMoraToken, tokenizeKana } from './romanization'
import { sentenceBank, sentenceTexts } from './sentences'
import { dealFrom, newDeck, pickRandom, type Deck, type RandomSource } from './rng'
import type {
  KanaGroup,
  KanaRow,
  Lesson,
  PracticeText,
  Settings,
  SourceName,
  TextItem,
} from './types'

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
  { value: 'sentences', label: 'sentences' },
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
  // Kana-only entries. A beginner meets these before they meet any kanji, and
  // the bank was entirely kanji-and-greetings without them.
  { kana: 'いぬ', romaji: 'inu' },
  { kana: 'ねこ', romaji: 'neko' },
  { kana: 'やま', romaji: 'yama' },
  { kana: 'うみ', romaji: 'umi' },
  { kana: 'そら', romaji: 'sora' },
  { kana: 'はな', romaji: 'hana' },
  { kana: 'みず', romaji: 'mizu' },
  { kana: 'ゆき', romaji: 'yuki' },
  { kana: 'あめ', romaji: 'ame' },
  { kana: 'かぜ', romaji: 'kaze' },
  { kana: '朝', reading: 'あさ', romaji: 'asa' },
  { kana: '夜', reading: 'よる', romaji: 'yoru' },
  { kana: '母', reading: 'はは', romaji: 'haha' },
  { kana: '父', reading: 'ちち', romaji: 'chichi' },
  { kana: '家', reading: 'いえ', romaji: 'ie' },
  { kana: '車', reading: 'くるま', romaji: 'kuruma' },
  { kana: '名前', reading: 'なまえ', romaji: 'namae' },
  { kana: '仕事', reading: 'しごと', romaji: 'shigoto' },
  { kana: '音楽', reading: 'おんがく', romaji: 'ongaku' },
  { kana: '公園', reading: 'こうえん', romaji: 'kouen' },
  { kana: '果物', reading: 'くだもの', romaji: 'kudamono' },
  { kana: '野菜', reading: 'やさい', romaji: 'yasai' },
  { kana: '電話', reading: 'でんわ', romaji: 'denwa' },
  { kana: '空港', reading: 'くうこう', romaji: 'kuukou' },
  { kana: '銀行', reading: 'ぎんこう', romaji: 'ginkou' },
  { kana: '大学', reading: 'だいがく', romaji: 'daigaku' },
  { kana: '教室', reading: 'きょうしつ', romaji: 'kyoushitsu' },
  { kana: '自転車', reading: 'じてんしゃ', romaji: 'jitensha' },
  { kana: '天気', reading: 'てんき', romaji: 'tenki' },
  { kana: '季節', reading: 'きせつ', romaji: 'kisetsu' },
  { kana: '約束', reading: 'やくそく', romaji: 'yakusoku' },
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
  { kana: '結果', reading: 'けっか', romaji: 'kekka' },
  { kana: '一緒', reading: 'いっしょ', romaji: 'issho' },
  { kana: '雑貨', reading: 'ざっか', romaji: 'zakka' },
  { kana: '発表', reading: 'はっぴょう', romaji: 'happyou' },
  { kana: '出発', reading: 'しゅっぱつ', romaji: 'shuppatsu' },
  { kana: '失敗', reading: 'しっぱい', romaji: 'shippai' },
  { kana: '説明', reading: 'せつめい', romaji: 'setsumei' },
  { kana: '牛乳', reading: 'ぎゅうにゅう', romaji: 'gyuunyuu' },
  { kana: '将来', reading: 'しょうらい', romaji: 'shourai' },
  { kana: '練習', reading: 'れんしゅう', romaji: 'renshuu' },
  { kana: '両親', reading: 'りょうしん', romaji: 'ryoushin' },
  { kana: '写真家', reading: 'しゃしんか', romaji: 'shashinka' },
  // ん against a following vowel or n — the boundary the matcher works hardest
  // at, and the one a typist most often fumbles.
  { kana: '運転', reading: 'うんてん', romaji: 'unten' },
  { kana: '案内', reading: 'あんない', romaji: 'annai' },
  { kana: '簡単', reading: 'かんたん', romaji: 'kantan' },
  { kana: '銀行員', reading: 'ぎんこういん', romaji: 'ginkouin' },
  { kana: '文学', reading: 'ぶんがく', romaji: 'bungaku' },
  { kana: '専門', reading: 'せんもん', romaji: 'senmon' },
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
/*
 * Proverbs. No entry may contain は or を as a *particle* alongside kanji.
 *
 * The particle is pronounced wa / o, so typing it as written teaches the wrong
 * sound — but spelling the reading phonetically breaks the furigana: `rubySegments`
 * matches the shared kana suffix to find the kanji, and けいぞくわ against 継続は
 * shares nothing, so the whole phrase gets annotated and the kana は is glossed
 * as わ. こんにちは escapes this only because it has no kanji to annotate.
 * Every original entry here avoided the combination; that was not an accident.
 */
export const quoteBank: TextItem[] = [
  { kana: '七転び 八起き', reading: 'ななころび やおき', romaji: 'nanakorobi yaoki' },
  { kana: '急がば 回れ', reading: 'いそがば まわれ', romaji: 'isogaba maware' },
  { kana: '塵も積もれば 山となる', reading: 'ちりもつもれば やまとなる', romaji: 'chirimotsumoreba yamatonaru' },
  { kana: '好きこそ 物の上手なれ', reading: 'すきこそ もののじょうずなれ', romaji: 'sukikoso mononojouzunare' },
  { kana: '雨降って 地固まる', reading: 'あめふって じかたまる', romaji: 'amefutte jikatamaru' },
  { kana: '石の上にも 三年', reading: 'いしのうえにも さんねん', romaji: 'ishinouenimo sannen' },
  { kana: '猿も 木から 落ちる', reading: 'さるも きから おちる', romaji: 'sarumo kikara ochiru' },
  { kana: '花より 団子', reading: 'はなより だんご', romaji: 'hanayori dango' },
  { kana: '案ずるより 産むが 易し', reading: 'あんずるより うむが やすし', romaji: 'anzuruyori umuga yasushi' },
  { kana: '千里の道も 一歩から', reading: 'せんりのみちも いっぽから', romaji: 'senrinomichimo ippokara' },
  { kana: '習うより 慣れろ', reading: 'ならうより なれろ', romaji: 'narauyori narero' },
  { kana: '一期一会', reading: 'いちごいちえ', romaji: 'ichigoichie' },
  { kana: '知らぬが 仏', reading: 'しらぬが ほとけ', romaji: 'shiranuga hotoke' },
  { kana: '住めば 都', reading: 'すめば みやこ', romaji: 'sumeba miyako' },
]

/**
 * Banks whose items are one word or phrase. Several of them make a passage,
 * which is why the longest of them sets how much typing a passage may be.
 */
const phraseBanks: Record<'difficult' | 'quotes' | 'words', TextItem[]> = {
  difficult: difficultBank,
  quotes: quoteBank,
  words: wordBank,
}

/**
 * Banks whose items are longer than a phrase.
 *
 * Kept apart from `phraseBanks` for one reason only: so that adding a bank of
 * long items cannot move the passage bound. A sentence is three times the
 * longest word here, and a budget measured over everything would have quietly
 * made *library* passages half as long again for no reason connected to the
 * library.
 *
 * It buys nothing else. `dealLesson` sends every plan through the shuffled
 * `dealPassage`, so being in this group does **not** mean an item is dealt
 * whole, in order, or on its own — a sentence is shuffled in with the words
 * exactly like a word is. Ordering would be a different kind of plan.
 */
const longItemBanks: Record<'sentences', TextItem[]> = {
  sentences: sentenceBank,
}

export const sourceBanks: Record<
  Exclude<SourceName, 'auto' | 'kana' | 'drills' | 'library'>,
  TextItem[]
> = { ...phraseBanks, ...longItemBanks }

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

/*
 * Punctuation and brackets a Japanese sentence ordinarily carries. Each one
 * tokenizes to a self-spelling token, so leaving them in made `おはよう！` fail
 * as "no reading" — the paste looked unsupported when only the mark was.
 * The ideographic space joins them: it is a space that does not read as one.
 *
 * ー does **not** belong here and used to. It is a letter, not a mark: dropping
 * it turned らーめん into the saved entry `ら めん`, and コーヒー into two words
 * that no longer matched their own romaji, so a loanword was either corrupted
 * or refused. The tokenizer reads it now.
 */
const JAPANESE_PUNCTUATION = /[！？!?「」『』（）()【】〔〕・…～〜:;'"]/g

function stripPunctuation(text: string): string {
  return text.replace(JAPANESE_PUNCTUATION, ' ').replace(/\u3000/g, ' ')
}

/* Runs of spaces collapse to one: a word break is a word break however wide. */
function collapseSpaces(text: string): string {
  return text.replace(/[^\S\n]{2,}/g, ' ')
}

/**
 * What a line of pasted text could not become, and why — so the page can say so.
 *
 * Rejections used to be silent: a paste that produced nothing at all returned an
 * empty list and the button simply appeared not to work. Pasting ordinary
 * Japanese is the obvious thing to try, so the obvious thing looked broken.
 */
export type LibraryReject = {
  line: string
  reason: 'no-reading' | 'word-mismatch' | 'unsupported' | 'too-long'
}

/**
 * Longest line the library accepts, matching what storage will read back.
 *
 * Without this the parser accepted a line that persistence would silently drop
 * on the next load — the entry appeared to save, practised once, and was gone
 * afterwards with nothing said. Compilation also walks one token per character,
 * so an unbounded line is unbounded recursion.
 */
export const MAX_LIBRARY_ITEM_CHARS = 400

export type LibraryParse = { items: TextItem[]; rejected: LibraryReject[] }

/**
 * Why a pair cannot become a practice item, or null when it can.
 *
 * One owner for the four rules, because there are now two ways in — a paste
 * parsed unaided, and a paste whose readings a person confirmed — and a rule
 * enforced in one of them is a rule the other can break.
 */
export function rejectReason(
  kana: string,
  romaji: string | null,
  reading?: string,
): LibraryReject['reason'] | null {
  if (kana === '' || romaji === null || romaji === '') return 'no-reading'
  if (
    kana.length > MAX_LIBRARY_ITEM_CHARS ||
    romaji.length > MAX_LIBRARY_ITEM_CHARS ||
    (reading !== undefined && reading.length > MAX_LIBRARY_ITEM_CHARS)
  )
    return 'too-long'
  // The display splits on the kana's spaces and the cursor counts the romaji's,
  // so a pair that disagrees about where the words are highlights the wrong one.
  if (kana.split(' ').length !== romaji.split(' ').length) return 'word-mismatch'
  // Every token has to be reachable by one keypress. An astral character
  // compiles to a token `applyTypeChar` can never accept, leaving the lesson
  // impossible to finish.
  if (romaji.length !== [...romaji].length) return 'unsupported'
  return null
}

/**
 * Romaji derived from the kana itself, or null where the text is not all kana.
 *
 * `tokenizeKana` falls back to one token per character for anything it cannot
 * read, and such a token spells itself — so a token whose spelling is its own
 * kana is exactly the case that has no reading. Kanji lands there, which is why
 * kanji still needs `学校|gakkou` while `おはよう` needs nothing.
 */
export function derivedRomaji(kana: string): string | null {
  const words = kana.split(' ')
  const spelled: string[] = []
  for (const word of words) {
    const tokens = tokenizeKana(word)
    if (tokens.length === 0) return null
    let out = ''
    for (const token of tokens) {
      const spelling = token.candidates[0]
      if (spelling === undefined || spelling === token.kana) return null
      out += spelling
    }
    spelled.push(out)
  }
  return spelled.join(' ')
}

/**
 * The lines a paste offers, cleaned and split, in the order they were written.
 *
 * Exported because the review screen has to split a paste the same way the
 * parser does — a preview that disagreed with what is actually saved would be
 * worse than no preview.
 */
export function pastedLines(text: string): string[] {
  return collapseSpaces(stripPunctuation(stripMarkdownChars(text)))
    .split(/\n|。|、|\.|,|;/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Parses text a person pasted or uploaded.
 *
 * Named for its input, not its destination: `io/persistence.ts` has its own
 * `parseLibrary` that validates *stored* records, and two functions of the same
 * name doing different jobs on the same data is how the wrong one eventually
 * gets called.
 */
export function parsePastedText(text: string): LibraryParse {
  const items: TextItem[] = []
  const rejected: LibraryReject[] = []

  for (const part of pastedLines(text)) {

    /*
     * `|` only. A double space used to separate the pair as well, so `ねこ  いぬ`
     * was read as kana `ねこ` with romaji `いぬ` — a second Japanese word
     * silently reinterpreted as a spelling, saved, and impossible to type.
     */
    const paired = part.split('|')
    const kana = paired[0].trim()
    // No explicit reading is not an error when the kana can supply one itself.
    const romaji = (paired[1] ?? '').trim().toLowerCase() || derivedRomaji(kana)

    const reason = rejectReason(kana, romaji)
    if (reason !== null) {
      rejected.push({ line: part, reason })
      continue
    }
    items.push({ kana, romaji: romaji as string })
  }
  return { items, rejected }
}

/** The items alone, for callers that do not report on what was dropped. */
export function parseLibraryText(text: string): TextItem[] {
  return parsePastedText(text).items
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
  /*
   * Named banks, not `sourceBanks`. A drill is meant to be short and repetitive
   * — the weak mora again and again — and most sentences contain most common
   * moras, so drawing from the catalog would turn a drill on `き` into general
   * sentence practice that happens to contain some.
   */
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

/**
 * The most typing a passage may be, per item asked for.
 *
 * Measured from the phrase banks rather than chosen: the longest curated word
 * is the longest single thing a passage is built out of, so a passage bounded
 * at `paragraphItems` of those can never be more typing than a passage of the
 * app's own material.
 *
 * `longItemBanks` is deliberately left out. Including it would raise the bound
 * for every source that uses it — `library` most of all, whose whole reason for
 * being bounded is that user text has no length of its own to be trusted.
 */
const LONGEST_PHRASE_ROMAJI = [...Object.values(phraseBanks).flat(), ...gojuonBank].reduce(
  (longest, item) => Math.max(longest, item.romaji.length),
  0,
)

/**
 * The items one passage is made of.
 *
 * `paragraphItems` counts items, which holds while every item is a curated word
 * of roughly one size. A saved library entry is not: it can be a four-hundred
 * character paragraph, so eight of them is eight unrelated texts at once — and
 * a library of one entry was dealt as **the same paragraph eight times in a
 * row**, which is what this exists to stop. Two bounds, both of them "a passage
 * should not be padding":
 *
 * - it never repeats itself, so it is at most as many items as the deck has;
 * - it stops once it holds a passage's worth of typing.
 *
 * The deck still reshuffles *between* passages, so a short bank is still
 * covered again and again across a timed run — just not within one passage.
 */
function dealPassage(
  deck: Deck<TextItem>,
  want: number,
  rng: RandomSource,
): { dealt: TextItem[]; deck: Deck<TextItem> } {
  const limit = Math.min(want, deck.items.length)
  const ceiling = want * LONGEST_PHRASE_ROMAJI
  const dealt: TextItem[] = []
  let current = deck
  let length = 0

  while (dealt.length < limit) {
    const step = dealFrom(current, 1, rng)
    const item = step.dealt[0]
    current = step.deck
    dealt.push(item)
    // Counted after the item is taken, so a passage is always at least one item
    // however long that item is.
    length += item.romaji.length + 1
    if (length >= ceiling) break
  }
  return { dealt, deck: current }
}

/**
 * The lesson for one chosen text: its items, in the order they were written.
 *
 * Deliberately not a plan and not a deck. Everything else here deals at random
 * from a pool and keeps dealing as long as a run lasts; this is the one thing
 * that is finite and ordered, so routing it through `planRun` would mean
 * building a one-text library and then hoping the shuffler left it alone.
 */
export function lessonForText(text: PracticeText): Lesson {
  return {
    kana: text.items.map((item) => item.kana).join(' '),
    romaji: text.items.map((item) => item.romaji).join(' '),
    source: text.source,
    items: text.items,
  }
}

/** Every text that ships with the app, for the library to list. */
export function bundledTexts(): PracticeText[] {
  return sentenceTexts
}

/**
 * Saved entries as choosable texts, one apiece.
 *
 * A paste is still stored as one entry per sentence, so this is a view of what
 * is there rather than a claim that a document was preserved. Grouping a paste
 * into one named text is a storage change, not a display one.
 */
export function libraryTexts(library: readonly TextItem[]): PracticeText[] {
  return library.map((item, index) => ({
    id: `library-${index}`,
    source: 'library' as const,
    items: [item],
  }))
}

/** One passage from the plan, and the plan to deal the next one from. */
export function dealLesson(
  plan: RunPlan,
  settings: Settings,
  rng: RandomSource,
): { lesson: Lesson; plan: RunPlan } {
  const { dealt, deck } = dealPassage(plan.deck, settings.paragraphItems, rng)
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
