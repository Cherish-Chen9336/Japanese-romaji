import { allBankItems, gojuonBank, itemMoras } from './lessons'
import { toKatakana, tokenizeKana } from './romanization'
import { compileStrict } from './prompt'
import type { KanaGroup, KanaScript } from './types'
import { KANA_SCRIPTS } from './types'

/**
 * The 五十音 chart, laid out for display.
 *
 * The mastery surface is a kana chart rather than a keyboard because one Latin
 * key types many moras — `n` alone covers な, に, ぬ, ね, の and ん — so a keycap
 * cannot say which mora is at fault. See "Deliberately not built" in AGENTS.md.
 *
 * Two charts, one table. Hiragana and katakana are both drawn from `gojuonBank`
 * — the katakana one by mirroring each row's kana through `toKatakana` — so the
 * two can never disagree about which rows exist or how a row is spelled. What
 * the charts do and do not cover is *measured* in `mastery.test.ts` rather than
 * stated here, because a count written into a comment is a count that goes
 * quietly out of date.
 */

/*
 * Two charts rather than one grid with both glyphs in each cell, and not カ
 * folded into か either. カ and か are typed with exactly the same keystrokes,
 * `ka`, so the only thing that differs between them is whether the reader can
 * read the character — and recognition is what this app measures. Folded, a
 * few hundred fluent か encounters would paint カ clean. See AGENTS.md for why
 * the other three arrangements lost.
 *
 * `KanaScript` lives in `types.ts` because the 五十音 drill chooses one too,
 * and that choice is persisted.
 */
export type { KanaScript }
export { KANA_SCRIPTS }

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

/**
 * How much of one chart has been met at all, for a coverage read.
 *
 * Hiragana unless asked otherwise, and the page's headline figure leaves it
 * that way on purpose. Every cell of the hiragana chart is reachable from the
 * bundled text, so `met of total` is a number a typist can actually drive to
 * the end, and the headline says "hiragana seen" so that it is not read as a
 * count of everything. Summing both charts would put cells in the denominator
 * that the bundled text cannot reach, turning a target into one that cannot be
 * finished — which is what `chartReach` exists to say instead.
 */
export function chartCoverage(
  stats: Map<string, { attempts: number }>,
  script: KanaScript = 'hiragana',
): { met: number; total: number } {
  const all = chartMoras(script)
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
function buildGrids(script: KanaScript): MasteryGrid[] {
  const groups: Exclude<KanaGroup, 'all'>[] = ['seion', 'dakuten', 'yoon']
  return groups.map((group) => {
    const rows = gojuonBank
      .filter((row) => row.group === group)
      .map((row) => rowCells(script === 'katakana' ? toKatakana(row.kana) : row.kana, row.romaji))

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
 * Built once per script. `gojuonBank` is a static table, so the layout cannot
 * change between calls — but the map called this from two places and rebuilt the
 * whole chart, twenty-six `compileStrict` compilations, on each of them every
 * time the stats changed. Keyed by script rather than one slot, so working the
 * toggle does not rebuild a chart that has already been built once.
 */
const gridCache = new Map<KanaScript, readonly MasteryGrid[]>()

export function gojuonGrids(script: KanaScript = 'hiragana'): readonly MasteryGrid[] {
  const built = gridCache.get(script) ?? buildGrids(script)
  gridCache.set(script, built)
  return built
}

const moraCache = new Map<KanaScript, readonly string[]>()

/** Every mora one chart displays, for checking what it does and does not cover. */
export function chartMoras(script: KanaScript = 'hiragana'): readonly string[] {
  const built =
    moraCache.get(script) ??
    gojuonGrids(script).flatMap((grid) => [
      ...grid.rows.flatMap((row) => row.cells.filter((c): c is MasteryCell => c !== null).map((c) => c.kana)),
      ...grid.extras.map((c) => c.kana),
    ])
  moraCache.set(script, built)
  return built
}

let charted: Set<string> | null = null

/**
 * Every mora with a cell on *either* chart.
 *
 * What "off chart" had to come to mean once there were two of them. カ had no
 * cell while the only chart was hiragana, and listing it under "also tracked"
 * was the right answer then. It has one now, and listing it anyway would print
 * the same mora twice and call one of the two homeless.
 */
function chartedMoras(): Set<string> {
  charted ??= new Set(KANA_SCRIPTS.flatMap((script) => [...chartMoras(script)]))
  return charted
}

let corpus: Set<string> | null = null

/** Every mora the bundled text can teach, tokenized as the stats see it. */
function corpusMoras(): Set<string> {
  corpus ??= new Set(allBankItems().flatMap(itemMoras))
  return corpus
}

/**
 * How many of a chart's cells the bundled text can actually fill.
 *
 * The hiragana chart is reachable end to end; the katakana one is not, since
 * katakana writes loanwords and the corpus holds the loanwords it holds. Cells
 * no bundled item can reach stay blank however much a typist practises, and a
 * chart of blank cells reads as broken rather than as untouched — so the panel
 * says which it is.
 *
 * **Bundled content only, and that is the point.** An upload can reach cells
 * this does not count; what this answers is "can the app itself teach me
 * this?", which is why the caption keeps it in a sentence of its own rather
 * than mixing it with what the typist has encountered.
 *
 * Measured rather than written into the copy, because the copy goes stale: the
 * first version of this comment said the gap was a property of the script, and
 * twelve ordinary loanwords closed twelve of those cells the next hour.
 */
export function chartReach(script: KanaScript): { reachable: number; total: number } {
  const inCorpus = corpusMoras()
  const cells = chartMoras(script)
  return {
    reachable: cells.filter((kana) => inCorpus.has(kana)).length,
    total: cells.length,
  }
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
 * Moras that have been met but have no cell on either chart — sokuon in
 * practice, since 五十音 has no square for っこ, and anything an upload
 * introduces.
 *
 * Shown rather than dropped: `weakestKana` reads the same table, so hiding them
 * lets the page name っこ as your worst and then show it nowhere.
 */
export function offChartMoras(stats: Map<string, { attempts: number }>): string[] {
  const onChart = chartedMoras()
  return [...stats.entries()]
    .filter(([kana, stat]) => !onChart.has(kana) && stat.attempts > 0)
    .map(([kana]) => kana)
    .sort()
}
