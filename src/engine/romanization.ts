export type RomajiToken = {
  kana: string
  candidates: string[]
}

export type Position = {
  tokenIndex: number
  typedInToken: string
}

export type MatchState = {
  positions: Position[]
}

export type MatchStep =
  | { ok: true; done: boolean; state: MatchState }
  | { ok: false }

/**
 * Covers hiragana seion/dakuten/handakuten, youon, sokuon, and ん — the
 * full range used by the current word banks. Not yet covered: katakana
 * (untested rows would need their own table entries), the chōonpu long-vowel
 * mark ー, loanword extended combos (ふぁ/fa, てぃ/thi, ゔ/vu, etc.), and
 * explicit mid-word small-tsu spellings (typing "kixtute" instead of
 * "kitte") — none of these appear in any bank today, so they're
 * deliberately left out rather than built speculatively.
 */

/**
 * Canonical spelling first (matches the Hepburn romaji already used in the
 * static word banks), alternates after. Cross-checked against Google's
 * open-source Mozc IME romaji table (romanji-hiragana.tsv): "di" belongs to
 * ぢ (not じ) and "dya"/"cya" belong to ぢゃ/ちゃ (not じゃ/しゃ) — an
 * earlier pass had those on the wrong kana.
 */
const ROMAJI_MAP: Record<string, string[]> = {
  あ: ['a'], い: ['i'], う: ['u'], え: ['e'], お: ['o'],
  か: ['ka'], き: ['ki'], く: ['ku'], け: ['ke'], こ: ['ko'],
  さ: ['sa'], し: ['shi', 'si', 'ci'], す: ['su'], せ: ['se'], そ: ['so'],
  た: ['ta'], ち: ['chi', 'ti'], つ: ['tsu', 'tu'], て: ['te'], と: ['to'],
  な: ['na'], に: ['ni'], ぬ: ['nu'], ね: ['ne'], の: ['no'],
  は: ['ha'], ひ: ['hi'], ふ: ['fu', 'hu'], へ: ['he'], ほ: ['ho'],
  ま: ['ma'], み: ['mi'], む: ['mu'], め: ['me'], も: ['mo'],
  や: ['ya'], ゆ: ['yu'], よ: ['yo'],
  ら: ['ra'], り: ['ri'], る: ['ru'], れ: ['re'], ろ: ['ro'],
  わ: ['wa'], を: ['wo', 'o'],

  が: ['ga'], ぎ: ['gi'], ぐ: ['gu'], げ: ['ge'], ご: ['go'],
  ざ: ['za'], じ: ['ji', 'zi'], ず: ['zu'], ぜ: ['ze'], ぞ: ['zo'],
  だ: ['da'], ぢ: ['ji', 'zi', 'di'], づ: ['zu', 'du'], で: ['de'], ど: ['do'],
  ば: ['ba'], び: ['bi'], ぶ: ['bu'], べ: ['be'], ぼ: ['bo'],
  ぱ: ['pa'], ぴ: ['pi'], ぷ: ['pu'], ぺ: ['pe'], ぽ: ['po'],

  きゃ: ['kya'], きゅ: ['kyu'], きょ: ['kyo'],
  しゃ: ['sha', 'sya'], しゅ: ['shu', 'syu'], しょ: ['sho', 'syo'],
  ちゃ: ['cha', 'tya', 'cya'], ちゅ: ['chu', 'tyu', 'cyu'], ちょ: ['cho', 'tyo', 'cyo'],
  にゃ: ['nya'], にゅ: ['nyu'], にょ: ['nyo'],
  ひゃ: ['hya'], ひゅ: ['hyu'], ひょ: ['hyo'],
  みゃ: ['mya'], みゅ: ['myu'], みょ: ['myo'],
  りゃ: ['rya'], りゅ: ['ryu'], りょ: ['ryo'],
  ぎゃ: ['gya'], ぎゅ: ['gyu'], ぎょ: ['gyo'],
  じゃ: ['ja', 'zya', 'jya'], じゅ: ['ju', 'zyu', 'jyu'], じょ: ['jo', 'zyo', 'jyo'],
  びゃ: ['bya'], びゅ: ['byu'], びょ: ['byo'],
  ぴゃ: ['pya'], ぴゅ: ['pyu'], ぴょ: ['pyo'],
}

const VOWEL_INITIAL = /^[aiueo]/

/**
 * っ only geminates (doubles the following consonant) when the following
 * mora is a real, mapped kana with at least one consonant-initial spelling.
 * ん and anything not in the table (spaces, punctuation, unknown chars)
 * can't be geminated — folding っ into those produced nonsense like "aa"
 * for っあ or a doubled space for っ followed by a word break. Checked
 * per-candidate, not just the canonical first one: を is ['wo', 'o'], and
 * only the 'wo' spelling is actually geminatable — doubling the vowel-only
 * 'o' alternate would produce "oo", which reads as おお, not っを.
 */
function isGeminatable(next: RomajiToken | undefined): next is RomajiToken {
  if (!next) return false
  if (next.kana === 'ん') return false
  const isMapped = ROMAJI_MAP[next.kana] !== undefined || next.kana.startsWith('っ')
  if (!isMapped) return false
  return next.candidates.some((candidate) => !VOWEL_INITIAL.test(candidate))
}

/**
 * Sokuon (っ) doubles the initial consonant of the following mora. ch-spelled
 * kana (ち row) doubles as "tch" in standard Hepburn, not "cch" — both are
 * offered since typing games conventionally accept either. Vowel-initial
 * candidates (e.g. を's "o" alternate) are skipped rather than doubled —
 * see isGeminatable above.
 */
function doubledCandidates(next: RomajiToken): string[] {
  const out = new Set<string>()
  for (const candidate of next.candidates) {
    if (VOWEL_INITIAL.test(candidate)) continue
    if (candidate.startsWith('ch')) out.add('t' + candidate)
    out.add(candidate[0] + candidate)
  }
  return [...out]
}

/**
 * Standalone small-tsu (word-final, or before something that can't be
 * geminated) accepts all four IME-recognized explicit spellings.
 */
const SOKUON_FALLBACK = ['xtsu', 'ltsu', 'xtu', 'ltu']

/**
 * ん accepts "n", "nn", and the apostrophe form "n'" (standard Hepburn
 * disambiguation, e.g. gen'in). A live IME needs to require "nn" before a
 * vowel/y-row mora to disambiguate what kana the romaji decodes to — but
 * this matcher is checking typed input against an already-known kana
 * target, not decoding romaji into kana, so that ambiguity doesn't apply
 * here: there's nothing to disambiguate.
 */
const N_CANDIDATES = ['n', 'nn', "n'"]

export function tokenizeKana(kana: string): RomajiToken[] {
  const tokens: RomajiToken[] = []
  let i = 0
  while (i < kana.length) {
    const char = kana[i]

    if (char === 'っ') {
      const rest = tokenizeKana(kana.slice(i + 1))
      const next = rest[0]
      if (isGeminatable(next)) {
        tokens.push({ kana: 'っ' + next.kana, candidates: doubledCandidates(next) })
        tokens.push(...rest.slice(1))
        return tokens
      }
      tokens.push({ kana: 'っ', candidates: [...SOKUON_FALLBACK] })
      i += 1
      continue
    }

    if (char === 'ん') {
      tokens.push({ kana: 'ん', candidates: [...N_CANDIDATES] })
      i += 1
      continue
    }

    const pair = kana.slice(i, i + 2)
    if (ROMAJI_MAP[pair]) {
      tokens.push({ kana: pair, candidates: [...ROMAJI_MAP[pair]] })
      i += 2
      continue
    }

    if (ROMAJI_MAP[char]) {
      tokens.push({ kana: char, candidates: [...ROMAJI_MAP[char]] })
      i += 1
      continue
    }

    tokens.push({ kana: char, candidates: [char] })
    i += 1
  }
  return tokens
}

export function initMatch(): MatchState {
  return { positions: [{ tokenIndex: 0, typedInToken: '' }] }
}

/**
 * Tracks every still-viable parse simultaneously rather than committing
 * greedily to one. A single-position matcher can't handle a boundary like
 * ん followed by な: after typing "n","n" it can't tell yet whether that's
 * a complete "nn" (ん done, next char starts な) or the first two letters
 * of "nna" — waiting to decide requires keeping both interpretations alive
 * until a following character rules one out. E.g. んな typed as "nna":
 * after "n" then "n" the state holds both {ん done via "nn"} and
 * {ん done via "n", な started with "n"}; the third char "a" only extends
 * the second, so the first branch dies and the second reaches completion.
 *
 * `done` is purely advisory, not a latch: it doesn't block further calls.
 * Reaching a valid complete spelling on the last token doesn't prevent
 * typing *further* into a longer candidate for that same token (e.g. "n"
 * then "n" again for a final ん, going for "nn" instead of stopping at
 * "n") — a genuinely wrong next keystroke is rejected anyway, naturally,
 * because it won't continue any candidate and there's no next token to
 * fall back into. The caller (session layer) decides when to stop feeding
 * characters once `done` comes back true.
 */
export function stepMatch(tokens: RomajiToken[], state: MatchState, rawChar: string): MatchStep {
  if (tokens.length === 0) return { ok: false }

  const char = rawChar.toLowerCase()
  const next = new Map<string, Position>()

  for (const pos of state.positions) {
    const token = tokens[pos.tokenIndex]
    const combined = pos.typedInToken + char

    if (token.candidates.some((candidate) => candidate.startsWith(combined))) {
      next.set(`${pos.tokenIndex}:${combined}`, { tokenIndex: pos.tokenIndex, typedInToken: combined })
    }

    const hasNextToken = pos.tokenIndex < tokens.length - 1
    if (hasNextToken && token.candidates.includes(pos.typedInToken)) {
      const nextToken = tokens[pos.tokenIndex + 1]
      if (nextToken.candidates.some((candidate) => candidate.startsWith(char))) {
        next.set(`${pos.tokenIndex + 1}:${char}`, { tokenIndex: pos.tokenIndex + 1, typedInToken: char })
      }
    }
  }

  if (next.size === 0) return { ok: false }

  const positions = [...next.values()]
  const done = positions.some(
    (p) => p.tokenIndex === tokens.length - 1 && tokens[p.tokenIndex].candidates.includes(p.typedInToken),
  )

  return { ok: true, done, state: { positions } }
}
