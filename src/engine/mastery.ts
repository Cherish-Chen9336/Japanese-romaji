import { gojuonBank } from './lessons'
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

function cellsOf(kana: string, romaji: string): MasteryCell[] {
  const tokens = compileStrict({ kana, romaji })
  // Every bundled row is typeable as written — `prompt.test.ts` pins that across
  // all four banks — so this cannot be null for the chart's own rows.
  return (tokens ?? []).map((token) => ({ kana: token.kana, romaji: token.candidates[0] }))
}

/**
 * The chart as three grids: the plain rows, the voiced rows, and the contracted
 * rows, which is how a printed chart sets them out and how the source picker
 * already groups them. Contracted rows carry only three columns, so they cannot
 * share a grid with the five-column ones without four empty columns per row.
 */
export function gojuonGrids(): MasteryGrid[] {
  const groups: Exclude<KanaGroup, 'all'>[] = ['seion', 'dakuten', 'yoon']
  return groups.map((group) => {
    const rows = gojuonBank.filter((row) => row.group === group).map((row) => cellsOf(row.kana, row.romaji))

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

/** Every mora the chart displays, for checking what it does and does not cover. */
export function chartMoras(): string[] {
  return gojuonGrids().flatMap((grid) => [
    ...grid.rows.flatMap((row) => row.cells.filter((c): c is MasteryCell => c !== null).map((c) => c.kana)),
    ...grid.extras.map((c) => c.kana),
  ])
}
