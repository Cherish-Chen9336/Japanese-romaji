import { describe, expect, it } from 'vitest'
import { chartMoras, gojuonGrids } from './mastery'
import { difficultBank, gojuonBank, quoteBank, wordBank } from './lessons'
import { isMoraToken, tokenizeKana } from './romanization'

describe('gojuonGrids', () => {
  const grids = gojuonGrids()
  const byGroup = (group: string) => grids.find((g) => g.group === group)!

  it('lays the plain and voiced rows out on the five vowel columns', () => {
    expect(byGroup('seion').columns).toEqual(['a', 'i', 'u', 'e', 'o'])
    expect(byGroup('dakuten').columns).toEqual(['a', 'i', 'u', 'e', 'o'])
  })

  /*
   * Contracted rows spell only や, ゆ and よ, so they carry three columns. Sharing
   * the five-column grid would leave every yōon row with two empty cells under
   * `i` and `e`, reading as gaps in the chart rather than as its shape.
   */
  it('gives the contracted rows their own three columns', () => {
    expect(byGroup('yoon').columns).toEqual(['a', 'u', 'o'])
  })

  /*
   * The alignment that a hardcoded five-per-row layout gets wrong. や ゆ よ are
   * three moras on a five-column row, and they belong under a, u and o — not
   * under a, i and u, which is where filling left-to-right would put them.
   */
  it('aligns a short row by vowel, not by position', () => {
    const ya = byGroup('seion').rows.find((row) => row.label === 'y')!
    expect(ya.cells.map((cell) => cell?.kana ?? null)).toEqual(['や', null, 'ゆ', null, 'よ'])
  })

  it('aligns わ and を by vowel, leaving the middle of the row empty', () => {
    const wa = byGroup('seion').rows.find((row) => row.label === 'w')!
    expect(wa.cells.map((cell) => cell?.kana ?? null)).toEqual(['わ', null, null, null, 'を'])
  })

  /*
   * ん is the one mora that is not consonant plus vowel. Forced into a column it
   * would file under わ's row at `a`, which is where left-to-right filling puts
   * it and where a learner would read it as a form of わ.
   */
  it('sets ん apart rather than filing it under a vowel', () => {
    expect(byGroup('seion').extras.map((cell) => cell.kana)).toEqual(['ん'])
    expect(chartMoras().filter((kana) => kana === 'ん')).toHaveLength(1)
  })

  /*
   * The chart teaches the spelling the row is written with. だ ぢ づ で ど has to
   * read `di`/`du`, because `ji`/`zu` are the keystrokes that produce じ and ず —
   * the same reason `compileStrict` promotes an item's own spelling.
   */
  it('teaches each row its own spelling', () => {
    const da = byGroup('dakuten').rows.find((row) => row.label === 'd')!
    expect(da.cells.map((cell) => cell?.romaji ?? null)).toEqual(['da', 'di', 'du', 'de', 'do'])
  })

  it('names every row for its consonant', () => {
    expect(byGroup('seion').rows.map((row) => row.label)).toEqual(
      ['', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w'],
    )
  })

  /* Every mora in the bank reaches the chart — a dropped row would be a kana the
   * map silently never shows, and so a weakness it could never report. */
  it('displays every mora the bank holds, and each exactly once', () => {
    const fromBank = gojuonBank.flatMap((row) => tokenizeKana(row.kana).map((t) => t.kana))
    const displayed = chartMoras()
    expect([...displayed].sort()).toEqual([...fromBank].sort())
    expect(new Set(displayed).size).toBe(displayed.length)
  })

  it('displays only real moras', () => {
    expect(chartMoras().filter((kana) => !isMoraToken(kana))).toEqual([])
  })

  /*
   * What the chart cannot show. Sokuon are a real part of the corpus and have no
   * cell, so a weakness in っこ can never appear on the map — worth knowing when
   * reading it, and worth failing here if the gap ever widens.
   */
  it('covers all but the sokuon of what the corpus actually tracks', () => {
    const corpus = new Set(
      [...wordBank, ...difficultBank, ...quoteBank, ...gojuonBank]
        .flatMap((item) => tokenizeKana(item.reading ?? item.kana))
        .map((token) => token.kana)
        .filter(isMoraToken),
    )
    const chart = new Set(chartMoras())
    const missing = [...corpus].filter((kana) => !chart.has(kana))
    expect(missing.every((kana) => kana.startsWith('っ'))).toBe(true)
  })
})
