import { pickRandom, type RandomSource } from './rng'
import type { Lesson, Settings, SourceName, TextItem } from './types'

export const sourceOptions: { value: SourceName; label: string; unlockAt: number }[] = [
  { value: 'auto', label: 'auto', unlockAt: 0 },
  { value: 'drills', label: 'drills', unlockAt: 0 },
  { value: 'words', label: 'words', unlockAt: 0 },
  { value: 'difficult', label: 'difficult', unlockAt: 30 },
  { value: 'quotes', label: 'quotes', unlockAt: 50 },
  { value: 'library', label: 'library', unlockAt: 70 },
]

export const wordBank: TextItem[] = [
  { kana: 'おはよう', romaji: 'ohayou' },
  { kana: 'こんにちは', romaji: 'konnichiwa' },
  { kana: 'ありがとう', romaji: 'arigatou' },
  { kana: 'すみません', romaji: 'sumimasen' },
  { kana: 'ともだち', romaji: 'tomodachi' },
  { kana: 'せんせい', romaji: 'sensei' },
  { kana: 'がくせい', romaji: 'gakusei' },
  { kana: 'でんしゃ', romaji: 'densha' },
  { kana: 'じかん', romaji: 'jikan' },
  { kana: 'にほんご', romaji: 'nihongo' },
  { kana: 'たべもの', romaji: 'tabemono' },
  { kana: 'のみもの', romaji: 'nomimono' },
  { kana: 'あした', romaji: 'ashita' },
  { kana: 'きょう', romaji: 'kyou' },
  { kana: 'きのう', romaji: 'kinou' },
  { kana: 'えき', romaji: 'eki' },
  { kana: 'まち', romaji: 'machi' },
  { kana: 'ほん', romaji: 'hon' },
  { kana: 'ひこうき', romaji: 'hikouki' },
  { kana: 'かいしゃ', romaji: 'kaisha' },
  { kana: 'しゃしん', romaji: 'shashin' },
  { kana: 'りょうり', romaji: 'ryouri' },
  { kana: 'えいが', romaji: 'eiga' },
  { kana: 'てがみ', romaji: 'tegami' },
]

export const difficultBank: TextItem[] = [
  { kana: 'がっこう', romaji: 'gakkou' },
  { kana: 'きって', romaji: 'kitte' },
  { kana: 'ざっし', romaji: 'zasshi' },
  { kana: 'しゅくだい', romaji: 'shukudai' },
  { kana: 'じゅぎょう', romaji: 'jugyou' },
  { kana: 'びょういん', romaji: 'byouin' },
  { kana: 'りょこう', romaji: 'ryokou' },
  { kana: 'きゃく', romaji: 'kyaku' },
  { kana: 'ちょっと', romaji: 'chotto' },
  { kana: 'しんぶん', romaji: 'shinbun' },
  { kana: 'ほんや', romaji: 'honya' },
  { kana: 'こんや', romaji: 'konya' },
  { kana: 'ちゃわん', romaji: 'chawan' },
  { kana: 'ちゅうしゃ', romaji: 'chuusha' },
  { kana: 'ちょきん', romaji: 'chokin' },
]

export const drillFallbackBank: TextItem[] = [
  { kana: 'かきくけこ', romaji: 'kakikukeko' },
  { kana: 'さしすせそ', romaji: 'sashisuseso' },
  { kana: 'たちつてと', romaji: 'tachitsuteto' },
  { kana: 'なにぬねの', romaji: 'naninuneno' },
  { kana: 'はひふへほ', romaji: 'hahifuheho' },
  { kana: 'まみむめも', romaji: 'mamimumemo' },
  { kana: 'やゆよ', romaji: 'yayuyo' },
  { kana: 'らりるれろ', romaji: 'rarirurero' },
  { kana: 'わをん', romaji: 'wawon' },
  { kana: 'がぎぐげご', romaji: 'gagigugego' },
  { kana: 'ざじずぜぞ', romaji: 'zajizuzezo' },
]

export const quoteBank: TextItem[] = [
  { kana: 'ななころび やおき', romaji: 'nanakorobi yaoki' },
  { kana: 'いそがば まわれ', romaji: 'isogaba maware' },
  { kana: 'ちりもつもれば やまとなる', romaji: 'chirimotsumoreba yamatonaru' },
  { kana: 'すきこそ もののじょうずなれ', romaji: 'sukikoso mononojouzunare' },
  { kana: 'あめふって じかたまる', romaji: 'amefutte jikatamaru' },
  { kana: 'いしのうえにも さんねん', romaji: 'ishinouenimo sannen' },
]

export const sourceBanks: Record<Exclude<SourceName, 'auto' | 'drills' | 'library'>, TextItem[]> = {
  difficult: difficultBank,
  quotes: quoteBank,
  words: wordBank,
}

function stripMarkdownChars(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()!-]/g, ' ')
}

export function stripMarkdown(text: string): string {
  return stripMarkdownChars(text)
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseLibraryText(text: string): TextItem[] {
  return stripMarkdownChars(text)
    .split(/\n|。|、|\.|,|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [kana, romaji] = part.includes('|') ? part.split('|') : part.split(/\s{2,}/)
      return kana && romaji ? { kana: kana.trim(), romaji: romaji.trim().toLowerCase() } : null
    })
    .filter((item): item is TextItem => item !== null)
}

export function buildParagraph(
  items: TextItem[],
  source: SourceName,
  length: number,
  rng: RandomSource = Math.random,
): Lesson {
  const picked = Array.from({ length }, () => pickRandom(items, rng))
  return {
    kana: picked.map((item) => item.kana).join(' '),
    romaji: picked.map((item) => item.romaji).join(' '),
    source,
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

export function explicitSourcesForBest(best: number): Exclude<SourceName, 'auto'>[] {
  return sourceOptions
    .filter((option) => option.value !== 'auto' && option.value !== 'library')
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

  if (usableSource === 'drills') {
    return buildParagraph(drillBankFromMisses(misses), 'drills', settings.paragraphItems, rng)
  }
  if (usableSource === 'library') {
    return buildParagraph(library, 'library', settings.paragraphItems, rng)
  }
  return buildParagraph(sourceBanks[usableSource], usableSource, settings.paragraphItems, rng)
}
