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

export type RecoveryStep = {
  state: MatchState
  /** False when the keystroke extended no candidate — shown red, still advances. */
  correct: boolean
  /**
   * The characters that would have been accepted. Empty on a correct step.
   * Kept as a set rather than a single character because after `s` on し the
   * legal continuations are genuinely both `h` and `i`; picking one to blame
   * would make the stats depend on display policy rather than on typing.
   */
  legal: string[]
  done: boolean
}

/** What the display needs from a live match: where the cursor is, and what's left. */
export type MatchProjection = {
  /** Index of the token the cursor sits in. */
  tokenIndex: number
  /** Remaining letters of the current token, for the spelling the typist is on. */
  hint: string
  /** Canonical spellings of every token after the current one. */
  rest: string
}

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
  ぢゃ: ['ja', 'dya', 'zya'], ぢゅ: ['ju', 'dyu', 'zyu'], ぢょ: ['jo', 'dyo', 'zyo'],
  びゃ: ['bya'], びゅ: ['byu'], びょ: ['byo'],
  ぴゃ: ['pya'], ぴゅ: ['pyu'], ぴょ: ['pyo'],
}

/**
 * Every kana the table knows. Exported so tests can sweep the real contents
 * rather than a parallel list that silently falls behind the map.
 */
export const MAPPED_KANA: readonly string[] = Object.keys(ROMAJI_MAP)

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
  // One keystroke per call. A multi-character string would be compared against
  // candidate prefixes wholesale and could match by accident.
  if (rawChar.length !== 1) return { ok: false }

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

  return { ok: true, done: isDone(tokens, positions), state: { positions } }
}

function isDone(tokens: RomajiToken[], positions: Position[]): boolean {
  return positions.some(
    (p) => p.tokenIndex === tokens.length - 1 && tokens[p.tokenIndex].candidates.includes(p.typedInToken),
  )
}

/**
 * Every character that would be accepted next, across all live positions —
 * the outgoing edge set of the current matcher configuration.
 *
 * Two sources, mirroring stepMatch: characters that extend the current token,
 * and (when what's typed already completes the current token) characters that
 * open the following one.
 */
export function legalNext(tokens: RomajiToken[], state: MatchState): string[] {
  const chars = new Set<string>()
  for (const pos of state.positions) {
    // Positions always index a real token when the state came from this module;
    // the check is for callers passing one in from elsewhere.
    const token = tokens[pos.tokenIndex]
    if (token === undefined) continue

    for (const candidate of token.candidates) {
      if (candidate.length > pos.typedInToken.length && candidate.startsWith(pos.typedInToken)) {
        chars.add(candidate[pos.typedInToken.length])
      }
    }

    const hasNextToken = pos.tokenIndex < tokens.length - 1
    if (hasNextToken && token.candidates.includes(pos.typedInToken)) {
      for (const candidate of tokens[pos.tokenIndex + 1].candidates) {
        if (candidate.length > 0) chars.add(candidate[0])
      }
    }
  }
  return [...chars].sort()
}

/**
 * Which kana the currently-legal keystrokes would advance.
 *
 * This is what makes per-kana mastery possible where per-key mastery isn't.
 * After `s` on し the legal letters are `h` and `i` — ambiguous, so no single
 * key can be blamed for a miss there, and the miss used to be discarded. But
 * both of those letters belong to the same kana, so the kana *can* be blamed.
 * Ambiguity in the spelling is not ambiguity in the mora.
 *
 * Genuinely ambiguous cases stay ambiguous: at a ん/な boundary the next key
 * could advance either, and this returns both.
 */
export function expectedTokens(tokens: RomajiToken[], state: MatchState): number[] {
  const indices = new Set<number>()
  for (const pos of state.positions) {
    const token = tokens[pos.tokenIndex]
    if (token === undefined) continue

    const continues = token.candidates.some(
      (candidate) =>
        candidate.length > pos.typedInToken.length && candidate.startsWith(pos.typedInToken),
    )
    if (continues) indices.add(pos.tokenIndex)

    const hasNextToken = pos.tokenIndex < tokens.length - 1
    if (hasNextToken && token.candidates.includes(pos.typedInToken)) {
      const next = tokens[pos.tokenIndex + 1]
      if (next.candidates.some((candidate) => candidate.length > 0)) indices.add(pos.tokenIndex + 1)
    }
  }
  return [...indices]
}

/**
 * The one mora being typed, or null where that is genuinely undecided.
 *
 * Identified by token index rather than by the kana itself: ここ is two separate
 * encounters with こ, and comparing names would merge them into one.
 */
export function expectedToken(
  tokens: RomajiToken[],
  state: MatchState,
): { index: number; kana: string } | null {
  const indices = expectedTokens(tokens, state)
  if (indices.length !== 1) return null
  return { index: indices[0], kana: tokens[indices[0]].kana }
}

export function expectedKana(tokens: RomajiToken[], state: MatchState): string[] {
  return [...new Set(expectedTokens(tokens, state).map((index) => tokens[index].kana))]
}

/**
 * A keystroke that tolerates errors: correct keys advance as usual, and a wrong
 * key advances too — consuming one edge in every direction that was legal, and
 * letting later keystrokes kill the branches that turn out dead.
 *
 * This is what makes a mistyped key behave like an ordinary key rather than a
 * wall. The naive alternative — leave the matcher where it is and just draw the
 * wrong key in red — reads as tolerant but isn't: the typist still owes the
 * matcher every character of the mora they fumbled, so `x` before し costs four
 * keystrokes instead of three. Consuming an edge makes it a substitution, which
 * is what a character-grid matcher does and what people expect.
 *
 * Exact transitions win outright when any exist: for んな typed `n`,`n`,`n`,`a`
 * the third `n` legitimately opens な on the `nn` branch, so it must not be
 * scored as a substitution on the `n`+`na` branch.
 */
export function stepWithRecovery(
  tokens: RomajiToken[],
  state: MatchState,
  rawChar: string,
): RecoveryStep {
  const exact = stepMatch(tokens, state, rawChar)
  if (exact.ok) return { state: exact.state, correct: true, legal: [], done: exact.done }

  const legal = legalNext(tokens, state)
  const merged = new Map<string, Position>()
  for (const char of legal) {
    // Every character in `legal` was derived from these same positions, so the
    // step always succeeds — the check is what narrows the union.
    const step = stepMatch(tokens, state, char)
    if (step.ok) {
      for (const pos of step.state.positions) {
        merged.set(`${pos.tokenIndex}:${pos.typedInToken}`, pos)
      }
    }
  }

  // No outgoing edges at all — the text is already fully typed. Hold rather
  // than inventing a transition; the session finishes on `done` anyway.
  if (merged.size === 0) return { state, correct: false, legal, done: false }

  const positions = [...merged.values()]
  return { state: { positions }, correct: false, legal, done: isDone(tokens, positions) }
}

/**
 * Picks the furthest-along live position as the one to draw from. Ambiguity is
 * real while it lasts (んな after two `n`s is genuinely both "ん done, な
 * started" and "ん spelled nn"), and showing the reading that is further
 * through the text is the one that doesn't jump backwards when it resolves.
 */
export function projectMatch(tokens: RomajiToken[], state: MatchState): MatchProjection {
  // Rank of the best candidate a position is still on track for. Breaking ties
  // by this rather than by whichever branch happened to be inserted first is
  // what stops the hint contradicting the matcher: after a wrong key on し, both
  // the `s` branch (shi/si) and the `c` branch (ci) survive, and picking `c`
  // displayed a remaining `i` while `h` was also accepted — so pressing `h` was
  // marked correct without the hint shrinking.
  const rank = (pos: Position): number => {
    const candidates = tokens[pos.tokenIndex]?.candidates ?? []
    const index = candidates.findIndex((candidate) => candidate.startsWith(pos.typedInToken))
    return index === -1 ? candidates.length : index
  }

  const best = state.positions.reduce((winner, pos) => {
    if (pos.tokenIndex !== winner.tokenIndex) return pos.tokenIndex > winner.tokenIndex ? pos : winner
    if (pos.typedInToken.length !== winner.typedInToken.length) {
      return pos.typedInToken.length > winner.typedInToken.length ? pos : winner
    }
    return rank(pos) < rank(winner) ? pos : winner
  }, state.positions[0] ?? { tokenIndex: 0, typedInToken: '' })

  // stepMatch stays inside a finished mora until the next keystroke arrives —
  // it can't step out earlier without guessing which token that keystroke
  // belongs to. For display there's no such doubt: a mora that has been spelled
  // in full is done, so move the cursor onto the next one instead of leaving
  // the finished kana highlighted as current.
  const settled = tokens[best.tokenIndex]?.candidates.includes(best.typedInToken) ?? false
  const witness =
    settled && best.tokenIndex < tokens.length - 1
      ? { tokenIndex: best.tokenIndex + 1, typedInToken: '' }
      : best

  const token = tokens[witness.tokenIndex]
  const spelling =
    token?.candidates.find((candidate) => candidate.startsWith(witness.typedInToken)) ??
    token?.candidates[0] ??
    ''

  return {
    tokenIndex: witness.tokenIndex,
    hint: spelling.slice(witness.typedInToken.length),
    rest: tokens
      .slice(witness.tokenIndex + 1)
      .map((next) => next.candidates[0] ?? '')
      .join(''),
  }
}
