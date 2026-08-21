import { describe, expect, it } from 'vitest'
import { initMatch, stepMatch, tokenizeKana } from './romanization'
import { difficultBank, drillFallbackBank, quoteBank, wordBank } from './lessons'

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

  // Grammatical exceptions a per-kana mechanical table can't capture: the
  // topic-marker は is pronounced "wa", not the "ha" it romanizes to
  // everywhere else. There's no context-free fix — こんにちは is the only
  // static-bank item that hits it today.
  const NON_MECHANICAL_ITEMS = new Set(['こんにちは'])

  it('every existing static bank item is fully typeable via stepMatch using its canonical spelling', () => {
    const allItems = [...wordBank, ...difficultBank, ...drillFallbackBank, ...quoteBank]
    for (const item of allItems) {
      if (NON_MECHANICAL_ITEMS.has(item.kana)) continue
      const kanaWords = item.kana.split(' ')
      const romajiWords = item.romaji.split(' ')
      expect(kanaWords.length, `${item.kana} | ${item.romaji}`).toBe(romajiWords.length)
      for (let i = 0; i < kanaWords.length; i++) {
        expect(
          completes(kanaWords[i], romajiWords[i]),
          `${kanaWords[i]} could not be typed as "${romajiWords[i]}"`,
        ).toBe(true)
      }
    }
  })

  it('every existing static bank item is fully typeable as one space-joined phrase', () => {
    const allItems = [...wordBank, ...difficultBank, ...drillFallbackBank, ...quoteBank]
    for (const item of allItems) {
      if (NON_MECHANICAL_ITEMS.has(item.kana)) continue
      expect(completes(item.kana, item.romaji), `"${item.kana}" as "${item.romaji}"`).toBe(true)
    }
  })

  it('every ROMAJI_MAP entry is internally walkable via each of its own candidates', () => {
    // Sweeps every base + youon kana entry in the table, not just the words
    // that happen to appear in a bank — most of these rows (p-row, most
    // youon groups) have no other coverage.
    const singleKana = Array.from(
      'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわを' +
        'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ',
    )
    const digraphKana = [
      'きゃ', 'きゅ', 'きょ', 'しゃ', 'しゅ', 'しょ', 'ちゃ', 'ちゅ', 'ちょ',
      'にゃ', 'にゅ', 'にょ', 'ひゃ', 'ひゅ', 'ひょ', 'みゃ', 'みゅ', 'みょ',
      'りゃ', 'りゅ', 'りょ', 'ぎゃ', 'ぎゅ', 'ぎょ', 'じゃ', 'じゅ', 'じょ',
      'びゃ', 'びゅ', 'びょ', 'ぴゃ', 'ぴゅ', 'ぴょ',
    ]
    for (const kana of [...singleKana, ...digraphKana]) {
      const tokens = tokenizeKana(kana)
      expect(tokens, kana).toHaveLength(1)
      for (const candidate of tokens[0].candidates) {
        expect(completes(kana, candidate), `${kana} via "${candidate}"`).toBe(true)
      }
    }
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
