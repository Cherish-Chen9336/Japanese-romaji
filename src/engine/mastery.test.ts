import { describe, expect, it } from 'vitest'
import {
  cellState,
  chartCoverage,
  chartMoras,
  chartReach,
  gojuonGrids,
  KANA_SCRIPTS,
  offChartMoras,
  romajiFor,
  rowCells,
} from './mastery'
import { allBankItems, gojuonBank, itemMoras } from './lessons'
import { isMoraToken, tokenizeKana, toKatakana } from './romanization'

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
   * What the two charts together cannot show, which is sokuon and nothing
   * else: 五十音 has no square for っこ, under either syllabary. Katakana used
   * to be the second category here, and the katakana chart is what closed it.
   *
   * **Both sokuon marks.** ッ as well as っ, since katakana loanwords brought
   * ック, ップ, ット and ッピ into the corpus — this test caught them on the way
   * in, naming them as a fourth category when they are the same one written in
   * the other script.
   *
   * Worth failing if a genuinely new category ever joins them unnoticed — a
   * corpus addition the map silently cannot draw is a weakness it can never
   * report.
   */
  it('covers all but the sokuon of what the corpus tracks', () => {
    const corpus = new Set(
      allBankItems()
        .flatMap((item) => tokenizeKana(item.reading ?? item.kana))
        .map((token) => token.kana)
        .filter(isMoraToken),
    )
    const charted = new Set(KANA_SCRIPTS.flatMap((script) => [...chartMoras(script)]))
    const missing = [...corpus].filter((kana) => !charted.has(kana))
    expect(missing.filter((kana) => !/^[っッ]/.test(kana))).toEqual([])
    /* And the sokuon really are there, in both scripts, so the line above
       cannot pass by the corpus having quietly stopped containing any. */
    expect(missing.some((kana) => kana.startsWith('っ'))).toBe(true)
    expect(missing.some((kana) => kana.startsWith('ッ'))).toBe(true)
  })
})

describe('the katakana chart', () => {
  /*
   * One assertion for the whole mirror, because that is the invariant: the two
   * charts are the same twenty-six rows with the same spellings, differing only
   * in glyph. Anything weaker — checking a row here, a count there — passes a
   * katakana chart that has quietly lost a row or renamed a column, which is
   * exactly what writing a second bank out by hand would eventually produce.
   */
  it('mirrors the hiragana chart row for row, keeping every spelling', () => {
    const mirrored = gojuonGrids('hiragana').map((grid) => ({
      group: grid.group,
      columns: grid.columns,
      rows: grid.rows.map((row) => ({
        label: row.label,
        cells: row.cells.map((cell) =>
          cell === null ? null : { kana: toKatakana(cell.kana), romaji: cell.romaji },
        ),
      })),
      extras: grid.extras.map((cell) => ({ kana: toKatakana(cell.kana), romaji: cell.romaji })),
    }))
    expect(gojuonGrids('katakana')).toEqual(mirrored)
  })

  /* The same spelling choice the hiragana row is taught with: `ji`/`zu` are the
     keystrokes that produce ジ and ズ, so ヂ and ヅ have to read `di`/`du`. */
  it('teaches ヂ and ヅ as di and du, as the hiragana row does', () => {
    const grid = gojuonGrids('katakana').find((g) => g.group === 'dakuten')!
    const da = grid.rows.find((row) => row.label === 'd')!
    expect(da.cells.map((cell) => cell?.kana ?? null)).toEqual(['ダ', 'ヂ', 'ヅ', 'デ', 'ド'])
    expect(da.cells.map((cell) => cell?.romaji ?? null)).toEqual(['da', 'di', 'du', 'de', 'do'])
  })

  it('sets ン apart rather than filing it under a vowel', () => {
    const grid = gojuonGrids('katakana').find((g) => g.group === 'seion')!
    expect(grid.extras.map((cell) => cell.kana)).toEqual(['ン'])
  })

  it('is the same size as the hiragana chart, and shares no cell with it', () => {
    const hiragana = chartMoras('hiragana')
    const katakana = chartMoras('katakana')
    expect(katakana).toHaveLength(hiragana.length)
    expect(katakana.filter((kana) => hiragana.includes(kana))).toEqual([])
  })

  it('draws only katakana', () => {
    expect(chartMoras('katakana').filter((kana) => !/^[ァ-ヺ]+$/.test(kana))).toEqual([])
  })

  it('displays only real moras', () => {
    expect(chartMoras('katakana').filter((kana) => !isMoraToken(kana))).toEqual([])
  })

  /* The engine's default and the toggle's first option have to be the same
     script, or the chart opens on one while the pressed pill names the other. */
  it('offers both scripts, hiragana first', () => {
    expect([...KANA_SCRIPTS]).toEqual(['hiragana', 'katakana'])
    expect(chartMoras()).toBe(chartMoras('hiragana'))
    expect(gojuonGrids()).toBe(gojuonGrids('hiragana'))
  })
})

describe('chartReach', () => {
  /*
   * The hiragana chart being reachable end to end is what lets the page print
   * "N moras seen · of 104" as a target. If a cell ever stops being reachable
   * that headline quietly becomes a number nobody can finish, which is the
   * reason `chartCoverage` stays on this one chart.
   */
  it('finds every cell of the hiragana chart reachable from the bundled text', () => {
    const total = chartMoras('hiragana').length
    expect(chartReach('hiragana')).toEqual({ reachable: total, total })
  })

  /* Recomputed independently rather than pinned to a figure: the katakana
     chart's reach is a property of the corpus, and the panel's caption appears
     and disappears with it. */
  it('counts a chart against the moras the corpus actually holds', () => {
    const corpus = new Set(allBankItems().flatMap(itemMoras))
    for (const script of KANA_SCRIPTS) {
      const cells = chartMoras(script)
      expect(chartReach(script)).toEqual({
        reachable: cells.filter((kana) => corpus.has(kana)).length,
        total: cells.length,
      })
    }
  })
})

describe('cellState', () => {
  /*
   * "Never met" and "met and never missed" have to be different cells. Collapsed
   * into one pale shade — which a single opacity ramp does — the chart tells a
   * beginner they are fine at every kana they have not yet seen.
   */
  it('separates a mora never met from one met and never missed', () => {
    expect(cellState(undefined)).toBe('unseen')
    expect(cellState({ attempts: 0, misses: 0 })).toBe('unseen')
    expect(cellState({ attempts: 6, misses: 0 })).toBe('clean')
  })

  it('calls a mora weak on a single miss, however many times it has been met', () => {
    expect(cellState({ attempts: 100, misses: 1 })).toBe('weak')
    expect(cellState({ attempts: 1, misses: 1 })).toBe('weak')
  })
})

describe('offChartMoras', () => {
  const stat = (attempts: number) => ({ attempts })

  /*
   * `weakestKana` reads the same table this chart is drawn from, so a mora with
   * no cell would be named as the weakest and then shown nowhere. っこ is the
   * real case: 五十音 has no square for a sokuon.
   */
  it('returns moras that have been met but have no cell', () => {
    const stats = new Map([['か', stat(4)], ['っこ', stat(3)], ['しゃ', stat(2)]])
    expect(offChartMoras(stats)).toEqual(['っこ'])
  })

  it('leaves out a mora that is on the chart, however weak', () => {
    expect(offChartMoras(new Map([['か', stat(9)]]))).toEqual([])
  })

  /*
   * カ was the whole reason this strip ever held katakana. It has a cell of its
   * own now, and a mora drawn on one chart must not also be listed as having no
   * chart — that prints it twice and calls one of the two homeless.
   */
  it('leaves out a katakana mora, now that katakana has a chart', () => {
    expect(offChartMoras(new Map([['カ', stat(4)], ['ン', stat(2)]]))).toEqual([])
    expect(offChartMoras(new Map([['カ', stat(4)], ['っこ', stat(1)]]))).toEqual(['っこ'])
  })

  /* Nothing is "also tracked" until it has actually been met once. */
  it('leaves out an off-chart mora with no attempts', () => {
    expect(offChartMoras(new Map([['っこ', stat(0)]]))).toEqual([])
  })

  it('is empty when every mora met is on the chart', () => {
    expect(offChartMoras(new Map())).toEqual([])
  })
})

describe('gojuonGrids caching', () => {
  /*
   * Built once. The map called `chartMoras` from two places and rebuilt the
   * whole chart — twenty-six `compileStrict` compilations — on each, every time
   * the stats changed.
   */
  it('returns the same object rather than rebuilding', () => {
    expect(gojuonGrids()).toBe(gojuonGrids())
    expect(chartMoras()).toBe(chartMoras())
  })

  /* Per script, so working the toggle does not rebuild a chart already built —
     and not one shared slot, which would rebuild on every single switch. */
  it('caches each script separately', () => {
    expect(gojuonGrids('katakana')).toBe(gojuonGrids('katakana'))
    expect(chartMoras('katakana')).toBe(chartMoras('katakana'))
    expect(gojuonGrids('katakana')).not.toBe(gojuonGrids('hiragana'))
  })
})

describe('rowCells', () => {
  /*
   * A row that cannot be spelled is a broken table, not a runtime condition. The
   * old `?? []` did not hide the failure so much as defer it into a
   * `cells[0].romaji` type error naming neither the row nor the reason.
   */
  it('refuses a row whose romaji its kana cannot produce', () => {
    expect(() => rowCells('あいうえお', 'zzzzz')).toThrow(/not typeable/)
  })

  it('compiles a real row to one cell per mora', () => {
    expect(rowCells('かきくけこ', 'kakikukeko').map((c) => c.kana)).toEqual(['か', 'き', 'く', 'け', 'こ'])
  })
})

describe('romajiFor', () => {
  /*
   * A folded form is exactly where a learner is least able to supply the romaji
   * themselves, and it is the one kind of mora the chart has no square for — so
   * dropping the hint left the "also tracked" strip as bare kana.
   */
  it('gives an off-chart sokuon its spelling', () => {
    expect(romajiFor('っこ')).toBe('kko')
    expect(romajiFor('って')).toBe('tte')
  })

  it('gives nothing for something that is not a single mora', () => {
    expect(romajiFor('かき')).toBe('')
  })
})

describe('chartCoverage', () => {
  it('counts only moras actually met, against the whole chart', () => {
    const total = chartMoras().length
    expect(chartCoverage(new Map())).toEqual({ met: 0, total })
    expect(chartCoverage(new Map([['か', { attempts: 3 }], ['き', { attempts: 0 }]]))).toEqual({
      met: 1,
      total,
    })
  })

  /* An off-chart mora is met, but it is not chart coverage. */
  it('does not count an off-chart mora toward coverage', () => {
    expect(chartCoverage(new Map([['っこ', { attempts: 5 }]])).met).toBe(0)
  })

  /*
   * The headline figure on the stats page calls this with no script, and has to
   * keep counting the hiragana chart alone — カ must not add to a total of 104,
   * and must not raise that total either.
   */
  it('counts the hiragana chart unless asked for the other one', () => {
    const stats = new Map([['カ', { attempts: 3 }]])
    expect(chartCoverage(stats).met).toBe(0)
    expect(chartCoverage(stats).total).toBe(chartMoras('hiragana').length)
    expect(chartCoverage(stats, 'katakana')).toEqual({
      met: 1,
      total: chartMoras('katakana').length,
    })
  })
})
