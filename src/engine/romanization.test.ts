import { describe, expect, it } from 'vitest'
import {
  MAPPED_KANA,
  expectedKana,
  initMatch,
  isMoraToken,
  isTypeableRomaji,
  legalNext,
  projectMatch,
  stepMatch,
  stepWithRecovery,
  tokenizeKana,
} from './romanization'

function typeAll(kana: string, input: string) {
  const tokens = tokenizeKana(kana)
  let state = initMatch()
  const steps = []
  for (const char of input) {
    const step = stepMatch(tokens, state, char)
    steps.push(step)
    if (!step.ok) return { steps, tokens }
    state = step.state
  }
  return { steps, tokens }
}

function completes(kana: string, input: string): boolean {
  const { steps } = typeAll(kana, input)
  return steps.length > 0 && steps.every((s) => s.ok) && steps.at(-1)?.ok === true && steps.at(-1)?.done === true
}

describe('tokenizeKana', () => {
  it('tokenizes plain single-mora kana with alternate spellings, canonical first', () => {
    expect(tokenizeKana('し')).toEqual([{ kana: 'し', candidates: ['shi', 'si', 'ci'] }])
    expect(tokenizeKana('つ')).toEqual([{ kana: 'つ', candidates: ['tsu', 'tu'] }])
    expect(tokenizeKana('ふ')).toEqual([{ kana: 'ふ', candidates: ['fu', 'hu'] }])
    expect(tokenizeKana('じ')).toEqual([{ kana: 'じ', candidates: ['ji', 'zi'] }])
  })

  it('does not split a youon digraph into its two component kana', () => {
    const tokens = tokenizeKana('きゃ')
    expect(tokens).toEqual([{ kana: 'きゃ', candidates: ['kya'] }])
  })

  it('prefers the youon digraph over the plain-kana fallback when both match', () => {
    const tokens = tokenizeKana('しゃしん')
    expect(tokens.map((t) => t.kana)).toEqual(['しゃ', 'し', 'ん'])
  })

  // Cross-checked against Google's open-source Mozc IME romaji table
  // (romanji-hiragana.tsv): "di" belongs to ぢ, not じ; "dya" belongs to
  // ぢゃ, not じゃ; "cya" is only recognized for ちゃ, not しゃ. An earlier
  // pass had these on the wrong kana based on a lower-confidence secondary
  // source — this locks in the corrected mapping and guards against
  // regressing back to the wrong one.
  it('accepts real MS-IME/Mozc alternates and rejects the ones that belong to a different kana', () => {
    expect(tokenizeKana('し')[0].candidates).toContain('ci')
    expect(tokenizeKana('じ')[0].candidates).not.toContain('di')
    expect(tokenizeKana('ぢ')[0].candidates).toContain('di')
    expect(tokenizeKana('ん')[0].candidates).toContain("n'")
    expect(tokenizeKana('ちゃ')[0].candidates).toContain('cya')
    expect(tokenizeKana('しゃ')[0].candidates).not.toContain('cya')
    expect(tokenizeKana('じゃ')[0].candidates).not.toContain('dya')
  })

  it('folds sokuon (small tsu) into a following consonant-initial mora as consonant doubling', () => {
    expect(tokenizeKana('っこ')).toEqual([{ kana: 'っこ', candidates: ['kko'] }])
    const shi = tokenizeKana('っし')[0]
    expect(shi.candidates).toEqual(['sshi', 'ssi', 'cci'])
  })

  it('special-cases sokuon before ch-spelled kana (tchi, not cchi-only)', () => {
    const tokens = tokenizeKana('っち')
    expect(tokens[0].candidates).toContain('tchi')
    expect(tokens[0].candidates).toContain('cchi')
  })

  // Independent expected values, not derived from doubledCandidates() itself —
  // a test that reuses the production doubling logic to check the production
  // doubling logic can't catch a bug in that logic.
  it('geminates every consonant row to its independently-known canonical form', () => {
    const expected: Record<string, string> = {
      っか: 'kka', っさ: 'ssa', った: 'tta', っは: 'hha', っま: 'mma',
      っや: 'yya', っら: 'rra', っわ: 'wwa', っが: 'gga', っざ: 'zza',
      っだ: 'dda', っば: 'bba', っぱ: 'ppa', っき: 'kki', っく: 'kku',
    }
    for (const [kana, expectedRomaji] of Object.entries(expected)) {
      const tokens = tokenizeKana(kana)
      expect(tokens, kana).toHaveLength(1)
      expect(tokens[0].candidates[0], kana).toBe(expectedRomaji)
    }
  })

  it('geminates を using only its consonant-initial "wo" spelling, not the vowel-only "o" alternate', () => {
    const tokens = tokenizeKana('っを')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].candidates).toEqual(['wwo'])
    expect(tokens[0].candidates).not.toContain('oo')
  })

  it('does NOT geminate a following vowel-initial mora (っあ stays a separate standalone unit)', () => {
    const tokens = tokenizeKana('っあ')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({ kana: 'っ', candidates: ['xtsu', 'ltsu', 'xtu', 'ltu'] })
    expect(tokens[1]).toEqual({ kana: 'あ', candidates: ['a'] })
  })

  it('does NOT geminate ん (っん stays a separate standalone unit)', () => {
    const tokens = tokenizeKana('っん')
    expect(tokens).toHaveLength(2)
    expect(tokens[0].candidates).toEqual(['xtsu', 'ltsu', 'xtu', 'ltu'])
    expect(tokens[1].kana).toBe('ん')
  })

  it('does NOT double a following word-break space', () => {
    const tokens = tokenizeKana('あっ もの')
    // あ, standalone っ, space, も, の — critically, the space must not be
    // folded into a doubled "  " the way a naive gemination would produce.
    expect(tokens.map((t) => t.kana)).toEqual(['あ', 'っ', ' ', 'も', 'の'])
    expect(tokens[2].candidates).toEqual([' '])
  })

  it('handles word-final standalone sokuon with all four IME fallback spellings', () => {
    expect(tokenizeKana('あっ').at(-1)?.candidates).toEqual(['xtsu', 'ltsu', 'xtu', 'ltu'])
  })

  // Whether every bundled bank item is actually typeable is checked in
  // prompt.test.ts, which runs items through `compileItem` — the layer that
  // knows about particle readings and the literal-romaji fallback. Checking it
  // here against the raw tokeniser forced こんにちは to be excluded, which hid a
  // real violation behind a passing test.

  it('every ROMAJI_MAP entry is internally walkable via each of its own candidates', () => {
    // Driven off the table's own keys rather than a hand-maintained list, so a
    // row added to the map without being added here can't slip through
    // unexercised. Most of these rows (p-row, most youon groups) have no other
    // coverage.
    for (const kana of MAPPED_KANA) {
      const tokens = tokenizeKana(kana)
      expect(tokens, kana).toHaveLength(1)
      for (const candidate of tokens[0].candidates) {
        expect(completes(kana, candidate), `${kana} via "${candidate}"`).toBe(true)
      }
    }
  })

  /*
   * Katakana used to be absent from the table, so every katakana token spelled
   * itself: `カナ` derived nothing, and `カナ|kana` was saved but compiled to
   * four Latin letters, which records no mora at all.
   */
  it('reads katakana with the hiragana spellings, keeping the script', () => {
    expect(tokenizeKana('カナ')).toEqual([
      { kana: 'カ', candidates: ['ka'] },
      { kana: 'ナ', candidates: ['na'] },
    ])
    expect(tokenizeKana('シ')).toEqual([{ kana: 'シ', candidates: ['shi', 'si', 'ci'] }])
    expect(completes('キャベツ', 'kyabetsu')).toBe(true)
    expect(completes('カット', 'katto')).toBe(true)
    expect(completes('ニホン', 'nihon')).toBe(true)
  })

  /* カ is a different character to read, so it stays a different mora. */
  it('does not fold katakana onto its hiragana twin', () => {
    expect(tokenizeKana('カ')[0].kana).toBe('カ')
    expect(tokenizeKana('ッカ')[0].kana).toBe('ッカ')
    expect(tokenizeKana('ン')[0].kana).toBe('ン')
  })

  /*
   * ー holds the vowel the mora before it ended on. A token of its own: コ is
   * still the character to recognise, and the mark is not a mora — see the
   * `isMoraToken` case below.
   */
  it('lengthens the previous mora for ー', () => {
    expect(tokenizeKana('コー')).toEqual([
      { kana: 'コ', candidates: ['ko'] },
      { kana: 'ー', candidates: ['o'] },
    ])
    expect(completes('コーヒー', 'koohii')).toBe(true)
    expect(completes('ラーメン', 'raamen')).toBe(true)
    expect(completes('らーめん', 'raamen')).toBe(true)
    expect(completes('ケーキ', 'keeki')).toBe(true)
  })

  it('leaves ー spelling itself where there is no vowel to hold', () => {
    expect(tokenizeKana('ー')).toEqual([{ kana: 'ー', candidates: ['ー'] }])
    expect(tokenizeKana('ンー').at(-1)).toEqual({ kana: 'ー', candidates: ['ー'] })
  })

  it('covers the whole gojūon plus dakuten and youon rows', () => {
    // Guards the other direction: MAPPED_KANA driving the sweep above is only
    // meaningful if the map itself hasn't lost rows.
    const mapped = new Set(MAPPED_KANA)
    const expected = [
      ...Array.from(
        'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわを' +
          'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ',
      ),
      'きゃ', 'しゃ', 'ちゃ', 'にゃ', 'ひゃ', 'みゃ', 'りゃ',
      'ぎゃ', 'じゃ', 'ぢゃ', 'びゃ', 'ぴゃ',
    ]
    expect(expected.filter((kana) => !mapped.has(kana))).toEqual([])
  })
})

describe('isMoraToken', () => {
  it('counts katakana, and does not count the length mark', () => {
    expect(isMoraToken('カ')).toBe(true)
    expect(isMoraToken('ッコ')).toBe(true)
    // A mark, not a mora: on its own it names nothing a chart could show.
    expect(isMoraToken('ー')).toBe(false)
    expect(isMoraToken('k')).toBe(false)
    expect(isMoraToken(' ')).toBe(false)
  })
})

describe('isTypeableRomaji', () => {
  it('accepts the letters, the word separator and the apostrophe', () => {
    expect(isTypeableRomaji('shashin')).toBe(true)
    expect(isTypeableRomaji('kyou wa')).toBe(true)
    // ん before a vowel: the apostrophe is the only thing telling n'a from na.
    expect(isTypeableRomaji("n'a")).toBe(true)
  })

  it('refuses a full-width mark, which is the whole point of it', () => {
    expect(isTypeableRomaji('hikkoshimashita。')).toBe(false)
    expect(isTypeableRomaji('、')).toBe(false)
    expect(isTypeableRomaji('し')).toBe(false)
  })

  it('refuses capitals, because the matcher is fed lowercase', () => {
    expect(isTypeableRomaji('Shashin')).toBe(false)
  })

  /*
   * Not "the empty string contains no bad characters, therefore it is fine".
   * A token with an empty candidate accepts nothing and can never complete,
   * which is the same failure this predicate exists to catch.
   */
  it('refuses the empty string', () => {
    expect(isTypeableRomaji('')).toBe(false)
  })
})

describe('stepMatch', () => {
  it('accepts the canonical spelling end to end', () => {
    expect(completes('しゃしん', 'shashin')).toBe(true)
  })

  it('accepts an alternate spelling end to end', () => {
    expect(completes('しゃしん', 'syasin')).toBe(true)
  })

  it('rejects a keystroke that continues no candidate', () => {
    expect(completes('しゃしん', 'shq')).toBe(false)
  })

  it('supports switching spelling mid-word (shi -> si) without desync', () => {
    expect(completes('しん', 'sin')).toBe(true)
  })

  describe('ん boundary ambiguity (んな)', () => {
    it('accepts "nna" — single n for ん, "na" starts な', () => {
      expect(completes('んな', 'nna')).toBe(true)
    })

    it('accepts "nnna" — double n for ん, then "na"', () => {
      expect(completes('んな', 'nnna')).toBe(true)
    })

    it("accepts \"n'na\" — apostrophe-disambiguated ん, then \"na\"", () => {
      expect(completes('んな', "n'na")).toBe(true)
    })
  })

  it('handles the real quoteBank boundary case さんねん as "sannen"', () => {
    expect(completes('さんねん', 'sannen')).toBe(true)
  })

  it('completes ん on n, nn, or n\' when it is the final mora', () => {
    expect(completes('ん', 'n')).toBe(true)
    expect(completes('ん', 'nn')).toBe(true)
    expect(completes('ん', "n'")).toBe(true)
  })

  it('handles sokuon doubling end to end (kitte)', () => {
    expect(completes('きって', 'kitte')).toBe(true)
  })

  it('handles sokuon + alternate spelling end to end (zasshi / zassi)', () => {
    expect(completes('ざっし', 'zasshi')).toBe(true)
    expect(completes('ざっし', 'zassi')).toBe(true)
  })

  it('rejects further input once the sequence is already complete', () => {
    const tokens = tokenizeKana('ほん')
    let state = initMatch()
    for (const char of 'hon') {
      const step = stepMatch(tokens, state, char)
      if (!step.ok) throw new Error('expected step to be ok')
      state = step.state
    }
    const extra = stepMatch(tokens, state, 'x')
    expect(extra.ok).toBe(false)
  })
})

/** Walks `input` through the recovery matcher, returning the final state and misses. */
function recover(kana: string, input: string) {
  const tokens = tokenizeKana(kana)
  let state = initMatch()
  const wrong: string[] = []
  let done = false
  for (const char of input) {
    const step = stepWithRecovery(tokens, state, char)
    if (!step.correct) wrong.push(char)
    state = step.state
    done = step.done
  }
  return { tokens, state, wrong, done }
}

describe('legalNext', () => {
  it('lists the characters that open a token', () => {
    expect(legalNext(tokenizeKana('し'), initMatch())).toEqual(['c', 's'])
  })

  it('narrows as a token is typed into', () => {
    const tokens = tokenizeKana('し')
    const afterS = stepMatch(tokens, initMatch(), 's')
    expect(afterS.ok && legalNext(tokens, afterS.state)).toEqual(['h', 'i'])
  })

  // Once ん is satisfied by `n`, both "keep going for nn" and "start な" are open.
  it('includes the next token once the current one is complete', () => {
    const tokens = tokenizeKana('んな')
    const afterN = stepMatch(tokens, initMatch(), 'n')
    expect(afterN.ok && legalNext(tokens, afterN.state)).toEqual(["'", 'n'])
  })

  it('is empty at the end of the text', () => {
    const tokens = tokenizeKana('あ')
    const done = stepMatch(tokens, initMatch(), 'a')
    expect(done.ok && legalNext(tokens, done.state)).toEqual([])
  })
})

describe('stepWithRecovery', () => {
  it('passes a correct keystroke straight through', () => {
    const tokens = tokenizeKana('し')
    const step = stepWithRecovery(tokens, initMatch(), 's')
    expect(step.correct).toBe(true)
    expect(step.legal).toEqual([])
  })

  // The property that makes a wrong key behave like an ordinary key: it costs
  // one keystroke, rather than leaving the mora still owed in full.
  it('consumes one edge on a wrong keystroke', () => {
    const { done, wrong } = recover('し', 'xhi')
    expect(wrong).toEqual(['x'])
    expect(done).toBe(true)
  })

  it('reports what would have been accepted', () => {
    const tokens = tokenizeKana('し')
    const afterS = stepWithRecovery(tokens, initMatch(), 's')
    const step = stepWithRecovery(tokens, afterS.state, 'q')
    expect(step.correct).toBe(false)
    expect(step.legal).toEqual(['h', 'i'])
  })

  it('keeps every branch that was legal alive after a substitution', () => {
    // `x` stands in for either `s` (→ shi/si) or `c` (→ ci), so both `h` and
    // `i` must still be reachable afterwards.
    expect(recover('し', 'xhi').done).toBe(true)
    expect(recover('し', 'xi').done).toBe(true)
  })

  // If a substitution were preferred over an exact match, the third `n` here
  // would be scored as an error against `a` instead of legitimately opening な.
  it('prefers an exact transition over a substitution', () => {
    expect(recover('んな', 'nnna').wrong).toEqual([])
    expect(recover('んな', 'nnna').done).toBe(true)
  })

  it('holds rather than inventing a transition past the end', () => {
    const tokens = tokenizeKana('あ')
    const done = stepWithRecovery(tokens, initMatch(), 'a')
    const past = stepWithRecovery(tokens, done.state, 'x')
    expect(past.correct).toBe(false)
    expect(past.state).toBe(done.state)
  })
})

describe('projectMatch', () => {
  it('points at the first token with the full spelling ahead of it', () => {
    const tokens = tokenizeKana('しゃしん')
    expect(projectMatch(tokens, initMatch())).toEqual({
      tokenIndex: 0,
      hint: 'sha',
      rest: 'shin',
    })
  })

  it('shrinks the hint as the current token is typed', () => {
    const tokens = tokenizeKana('しゃしん')
    const afterS = stepMatch(tokens, initMatch(), 's')
    expect(afterS.ok && projectMatch(tokens, afterS.state).hint).toBe('ha')
  })

  // Committing to `sy` must switch the hint to that spelling rather than
  // stubbornly showing the canonical one the typist has already left behind.
  it('follows the spelling the typist actually chose', () => {
    const tokens = tokenizeKana('しゃ')
    let state = initMatch()
    for (const char of 'sy') {
      const step = stepMatch(tokens, state, char)
      if (step.ok) state = step.state
    }
    expect(projectMatch(tokens, state).hint).toBe('a')
  })

  it('advances to the next token and drops it from the rest', () => {
    const tokens = tokenizeKana('あい')
    const afterA = stepMatch(tokens, initMatch(), 'a')
    expect(afterA.ok && projectMatch(tokens, afterA.state)).toEqual({
      tokenIndex: 1,
      hint: 'i',
      rest: '',
    })
  })

  /*
   * The hint must never name a continuation the matcher would reject, nor omit
   * one it would accept as the *next* thing. After a wrong key on し both the
   * `s` branch (shi/si) and the `c` branch (ci) survive; picking the `c` witness
   * displayed a remaining `i` while `h` was also accepted, so pressing `h` was
   * marked correct and the hint didn't shrink.
   */
  it('shows a hint whose first character the matcher will accept', () => {
    const tokens = tokenizeKana('し')
    const recovered = stepWithRecovery(tokens, initMatch(), 'x')
    const view = projectMatch(tokens, recovered.state)
    expect(legalNext(tokens, recovered.state)).toContain(view.hint[0])
  })

  it('shrinks the hint when the shown continuation is typed', () => {
    const tokens = tokenizeKana('し')
    const recovered = stepWithRecovery(tokens, initMatch(), 'x')
    const before = projectMatch(tokens, recovered.state)
    const next = stepWithRecovery(tokens, recovered.state, before.hint[0])
    expect(next.correct).toBe(true)
    expect(projectMatch(tokens, next.state).hint.length).toBe(before.hint.length - 1)
  })

  it('takes the furthest-along reading while a boundary is ambiguous', () => {
    const tokens = tokenizeKana('んな')
    let state = initMatch()
    for (const char of 'nn') {
      const step = stepMatch(tokens, state, char)
      if (step.ok) state = step.state
    }
    // Both "ん spelled nn" and "ん spelled n, な started" are live; showing the
    // one further through the text keeps the cursor from jumping backwards.
    expect(projectMatch(tokens, state).tokenIndex).toBe(1)
    expect(projectMatch(tokens, state).hint).toBe('a')
  })
})

describe('matcher input guards', () => {
  it('rejects a step against no tokens at all', () => {
    expect(stepMatch([], initMatch(), 'a').ok).toBe(false)
  })

  // One keystroke per call: a multi-character string would be compared against
  // candidate prefixes wholesale and could match by accident.
  it('rejects anything that is not a single character', () => {
    const tokens = tokenizeKana('し')
    expect(stepMatch(tokens, initMatch(), 'sh').ok).toBe(false)
    expect(stepMatch(tokens, initMatch(), '').ok).toBe(false)
  })

  it('ignores a position pointing past the end of the tokens', () => {
    const tokens = tokenizeKana('し')
    const bogus = { positions: [{ tokenIndex: 9, typedInToken: '' }] }
    expect(legalNext(tokens, bogus)).toEqual([])
  })
})

describe('expectedKana', () => {
  it('names the kana waiting at the start of a word', () => {
    expect(expectedKana(tokenizeKana('しゃしん'), initMatch())).toEqual(['しゃ'])
  })

  /*
   * The point of tracking kana rather than keys. After `s` on し the legal
   * letters are `h` and `i` — no single key is at fault for a miss — but both
   * belong to し, so the kana is. Ambiguity in the spelling is not ambiguity in
   * the mora.
   */
  it('stays unambiguous mid-mora even when the letters are not', () => {
    const tokens = tokenizeKana('し')
    const afterS = stepMatch(tokens, initMatch(), 's')
    expect(afterS.ok && legalNext(tokens, afterS.state)).toEqual(['h', 'i'])
    expect(afterS.ok && expectedKana(tokens, afterS.state)).toEqual(['し'])
  })

  it('reports both kana at a genuinely ambiguous boundary', () => {
    const tokens = tokenizeKana('んな')
    const afterN = stepMatch(tokens, initMatch(), 'n')
    // `n` completes ん, so the next key could extend it to `nn` or open な.
    expect(afterN.ok && expectedKana(tokens, afterN.state).sort()).toEqual(['な', 'ん'])
  })

  it('follows the cursor from one mora to the next', () => {
    const tokens = tokenizeKana('あい')
    const afterA = stepMatch(tokens, initMatch(), 'a')
    expect(afterA.ok && expectedKana(tokens, afterA.state)).toEqual(['い'])
  })

  // Same defensive guard `legalNext` carries: positions from this module always
  // index a real token, but the function is exported and can be handed anything.
  it('ignores a position pointing past the end of the tokens', () => {
    expect(expectedKana(tokenizeKana('あ'), { positions: [{ tokenIndex: 9, typedInToken: '' }] })).toEqual([])
  })

  it('is empty once there is nothing left to type', () => {
    const tokens = tokenizeKana('あ')
    const done = stepMatch(tokens, initMatch(), 'a')
    expect(done.ok && expectedKana(tokens, done.state)).toEqual([])
  })

  it('names the geminated unit, not the bare sokuon', () => {
    expect(expectedKana(tokenizeKana('っこ'), initMatch())).toEqual(['っこ'])
  })
})

describe('projectMatch witness ranking', () => {
  // Two live positions at the same token and the same typed length: the tie has
  // to break on candidate order, or the hint depends on insertion order.
  it('prefers the position on the higher-ranked spelling', () => {
    const tokens = tokenizeKana('し')
    const both = { positions: [{ tokenIndex: 0, typedInToken: 'c' }, { tokenIndex: 0, typedInToken: 's' }] }
    expect(projectMatch(tokens, both).hint).toBe('hi')
    const reversed = { positions: [...both.positions].reverse() }
    expect(projectMatch(tokens, reversed).hint).toBe('hi')
  })

  // Different lengths at the same token: the further-typed one wins, whichever
  // order they arrive in.
  it('prefers the position that has been typed into further', () => {
    const tokens = tokenizeKana('しゃ')
    const mixed = { positions: [{ tokenIndex: 0, typedInToken: 's' }, { tokenIndex: 0, typedInToken: 'sh' }] }
    expect(projectMatch(tokens, mixed).hint).toBe('a')
    const reversed = { positions: [...mixed.positions].reverse() }
    expect(projectMatch(tokens, reversed).hint).toBe('a')
  })

  it('falls back gracefully when a position matches no candidate', () => {
    const tokens = tokenizeKana('し')
    const stray = { positions: [{ tokenIndex: 0, typedInToken: 'zz' }] }
    expect(projectMatch(tokens, stray).tokenIndex).toBe(0)
  })
})
