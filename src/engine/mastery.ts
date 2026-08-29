import { gojuonBank } from './lessons'
import { tokenizeKana } from './romanization'
import { compileStrict } from './prompt'
import type { KanaGroup } from './types'

/**
 * The 五十音 chart, laid out for display.
 *
 * The mastery surface is a kana chart rather than a keyboard because one Latin
 * key types many moras — `n` alone covers な, に, ぬ, ね, の and ん — so a keycap
 * cannot say which mora is at fault. See "Deliberately not built" in AGENTS.md.
 * The chart fits the data almost exactly: of the moras this corpus tracks, all
 * but four sokuon sit on it, and no cell is unreachable.
 */

export type MasteryCell = {
  kana: string
  /** The chart's own spelling, which is what the row teaches. */
  romaji: string
}

export type MasteryGrid = {
  group: Exclude<KanaGroup, 'all'>
  /** Vowel endings, in chart order — the columns every row is aligned to. */
  columns: readonly string[]
  rows: { label: string; cells: (MasteryCell | null)[] }[]
  /**
   * Moras with no vowel to align on, which is ん and only ん. Printed charts set
   * it apart for the same reason: it is the one mora that is not consonant plus
   * vowel, so forcing it into a vowel column would misfile it under わ's `a`.
   */
  extras: MasteryCell[]
}

const VOWELS = ['a', 'i', 'u', 'e', 'o'] as const

/**
 * Columns come from the spellings themselves rather than a hardcoded table, so
 * the chart cannot drift from the bank it is drawn from. や ゆ よ land in a, u
 * and o with gaps at i and e because `ya`, `yu` and `yo` are what they spell —
 * the same rule that puts きゃ きゅ きょ in a three-column grid.
 */
function vowelOf(romaji: string): string | null {
  const last = romaji.slice(-1)
  return (VOWELS as readonly string[]).includes(last) ? last : null
}

/** The consonant a row is named for: `ka` minus its vowel, `kya` minus its. */
function labelOf(romaji: string): string {
  const vowel = vowelOf(romaji)
  return vowel === null ? romaji : romaji.slice(0, -1)
}

/**
 * Compiles one chart row. Throws rather than falling back, because a row that
 * cannot be spelled is a broken table and not a runtime condition — and the
 * previous `?? []` did not hide the failure so much as defer it, turning it into
 * a `cells[0].romaji` type error naming neither the row nor the reason.
 */
export function rowCells(kana: string, romaji: string): MasteryCell[] {
  const tokens = compileStrict({ kana, romaji })
  if (tokens === null || tokens.length === 0) {
    throw new Error(`gojuon row is not typeable as written: ${kana}|${romaji}`)
  }
  return tokens.map((token) => ({ kana: token.kana, romaji: token.candidates[0] }))
}

/**
 * The spelling to teach for a mora with no cell on the chart.
 *
 * Sokuon reach this: 五十音 has no square for っこ, but the tokenizer knows it is
 * `kko`. Dropping the hint was backwards — a folded form is exactly where a
 * learner is least able to supply the romaji themselves.
 */
export function romajiFor(kana: string): string {
  const tokens = tokenizeKana(kana)
  return tokens.length === 1 ? (tokens[0].candidates[0] ?? '') : ''
}

/** How much of the chart has been met at all, for a coverage read. */
export function chartCoverage(stats: Map<string, { attempts: number }>): { met: number; total: number } {
  const all = chartMoras()
  return {
    met: all.filter((kana) => (stats.get(kana)?.attempts ?? 0) > 0).length,
    total: all.length,
  }
}

/**
 * The chart as three grids: the plain rows, the voiced rows, and the contracted
 * rows, which is how a printed chart sets them out and how the source picker
 * already groups them. Contracted rows carry only three columns, so they cannot
 * share a grid with the five-column ones without four empty columns per row.
 */
function buildGrids(): MasteryGrid[] {
  const groups: Exclude<KanaGroup, 'all'>[] = ['seion', 'dakuten', 'yoon']
  return groups.map((group) => {
    const rows = gojuonBank.filter((row) => row.group === group).map((row) => rowCells(row.kana, row.romaji))

    // Only the columns this group actually uses, in chart order.
    const used = new Set<string>()
    for (const cells of rows) {
      for (const cell of cells) {
        const vowel = vowelOf(cell.romaji)
        if (vowel !== null) used.add(vowel)
      }
    }
    const columns = VOWELS.filter((vowel) => used.has(vowel))

    return {
      group,
      columns,
      rows: rows.map((cells) => ({
        label: labelOf(cells[0].romaji),
        cells: columns.map((vowel) => cells.find((cell) => vowelOf(cell.romaji) === vowel) ?? null),
      })),
      extras: rows.flatMap((cells) => cells.filter((cell) => vowelOf(cell.romaji) === null)),
    }
  })
}

/*
 * Built once. `gojuonBank` is a static table, so the layout cannot change
 * between calls — but the map called this from two places and rebuilt the whole
 * chart, twenty-six `compileStrict` compilations, on each of them every time the
 * stats changed.
 */
let grids: readonly MasteryGrid[] | null = null

export function gojuonGrids(): readonly MasteryGrid[] {
  grids ??= buildGrids()
  return grids
}

let moras: readonly string[] | null = null

/** Every mora the chart displays, for checking what it does and does not cover. */
export function chartMoras(): readonly string[] {
  moras ??= gojuonGrids().flatMap((grid) => [
    ...grid.rows.flatMap((row) => row.cells.filter((c): c is MasteryCell => c !== null).map((c) => c.kana)),
    ...grid.extras.map((c) => c.kana),
  ])
  return moras
}

/**
 * How a cell should read. Three states rather than one opacity ramp, because
 * "never met" and "met and never missed" are different facts: a single ramp
 * renders both as the palest cell, telling a beginner they are fine at every
 * kana they have yet to see.
 */
export type CellState = 'unseen' | 'clean' | 'weak'

export function cellState(stat: { attempts: number; misses: number } | undefined): CellState {
  if (stat === undefined || stat.attempts === 0) return 'unseen'
  return stat.misses === 0 ? 'clean' : 'weak'
}

/**
 * Moras that have been met but have no cell on the chart — sokuon in practice,
 * since 五十音 has no square for っこ, and anything an upload introduces.
 *
 * Shown rather than dropped: `weakestKana` reads the same table, so hiding them
 * lets the page name っこ as your worst and then show it nowhere.
 */
export function offChartMoras(stats: Map<string, { attempts: number }>): string[] {
  const onChart = new Set(chartMoras())
  return [...stats.entries()]
    .filter(([kana, stat]) => !onChart.has(kana) && stat.attempts > 0)
    .map(([kana]) => kana)
    .sort()
}
