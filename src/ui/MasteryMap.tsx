import { For, Show, createMemo } from 'solid-js'
import type { JSX } from 'solid-js'
import {
  cellState,
  gojuonGrids,
  offChartMoras,
  romajiFor,
  type CellState,
  type MasteryCell,
} from '../engine/mastery'
import { smoothedErrorRate } from '../engine/stats'
import { tipFor } from './Tooltip'
import type { AggregatedMoraStat } from '../engine/types'

/**
 * The 五十音 chart tinted by how well each mora is known.
 *
 * One colour channel, and weakness gets it. Excess latency is a separate panel
 * rather than a second visual encoding here: a mora you have never mistyped is
 * not weak however slow it is, which is the rule `weakestKana` already follows,
 * and one shade standing for two different problems is what made the old
 * `avgMs / 600 + errorRate` keyboard tint unreadable.
 *
 * Real tables, not styled divs. This is static tabular data, so `<table>` with
 * scoped headers gives a screen reader the row and column of every cell for
 * free; `role="grid"` would promise arrow-key navigation this does not
 * implement. Each cell also carries its full status as visually-hidden text,
 * because the stats used to live only in `title` — invisible to a screen reader
 * and unreachable on a touch screen, which is most of the timing model gone.
 */

const GROUP_LABEL: Record<string, string> = {
  seion: 'plain',
  dakuten: 'voiced',
  yoon: 'contracted',
}

/**
 * Weakness as the palette should draw it, which is not weakness as the ranking
 * computes it.
 *
 * `smoothedErrorRate` is right for ordering — it distrusts a single miss on a
 * single attempt — but its own caution compressed the display: pulled toward the
 * prior, a mora missed on all four attempts scores 0.75, and even ten from ten
 * only reaches 0.875, so the top of the tint was unreachable at any realistic
 * count. Saturating at that 0.75 spends the whole ramp on the range that
 * actually occurs, and keeps the scale absolute — a kana must not change colour
 * because some other kana entered the table.
 */
const SATURATION = 0.75

export function severity(stat: AggregatedMoraStat): number {
  return Math.min(1, smoothedErrorRate(stat) / SATURATION)
}

/*
 * Segments joined with ` · `, which is what the tooltip splits on: the mora gets
 * its own line and the numbers sit beneath it, quieter. The same string is the
 * cell's screen-reader text, where the separator reads as a pause.
 */
function statusText(cell: MasteryCell, stat: AggregatedMoraStat | undefined): string {
  const head = [cell.kana, cell.romaji].filter((part) => part !== '').join('  ')
  if (stat === undefined || stat.attempts === 0) return `${head} · not yet seen`
  const rate = Math.round(stat.errorRate * 100)
  const timing =
    stat.timingSamples > 0
      ? `${Math.abs(Math.round(stat.avgExcessMs))} ms ${stat.avgExcessMs >= 0 ? 'slower' : 'faster'} than your cadence`
      : 'not timed'
  return `${head} · ${stat.misses} of ${stat.attempts} missed (${rate}%) · ${timing}`
}

export function MasteryMap(props: {
  stats: Map<string, AggregatedMoraStat>
  /**
   * Content for the chart's right-hand margin, stacked under the "also
   * tracked" strip.
   *
   * The three gojuon grids have very different row counts — plain and
   * contracted run 613px while voiced runs 307 and the off-chart strip 76 — and
   * `.mastery` is a top-aligned flex row, so the tallest column decided the
   * panel's height and the shortest left a 537px hole in the top right. The
   * margin is that hole, given something to hold.
   */
  aside?: JSX.Element
}) {
  const statFor = (kana: string) => props.stats.get(kana)
  const offChart = createMemo(() =>
    offChartMoras(props.stats).map((kana) => ({ kana, romaji: romajiFor(kana) })),
  )

  const renderCell = (cell: MasteryCell) => {
    const stat = statFor(cell.kana)
    const state: CellState = cellState(stat)
    return (
      <td
        class={`mastery-cell mastery-cell--${state}`}
        style={state === 'weak' && stat ? { '--weakness': String(severity(stat)) } : {}}
        tabindex="0"
        {...tipFor(() => statusText(cell, stat))}
      >
        <b aria-hidden="true">{cell.kana}</b>
        <Show when={cell.romaji}>
          <small aria-hidden="true">{cell.romaji}</small>
        </Show>
        {/* Colour must not be the only thing separating weak from clean. */}
        <Show when={state === 'weak'}>
          <i class="mastery-cell__mark" aria-hidden="true" />
        </Show>
        <span class="sr-only">{statusText(cell, stat)}</span>
      </td>
    )
  }

  return (
    <div class="mastery">
      <For each={gojuonGrids()}>
        {(grid) => (
          <div class="mastery-grid">
            <table class="mastery-table">
              <caption>{GROUP_LABEL[grid.group] ?? grid.group}</caption>
              <thead>
                <tr>
                  <td class="mastery-cell mastery-cell--label" />
                  <For each={grid.columns}>
                    {(vowel) => (
                      <th scope="col" class="mastery-cell mastery-cell--label">
                        {vowel}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={grid.rows}>
                  {(row) => (
                    <tr>
                      <th scope="row" class="mastery-cell mastery-cell--label">
                        {row.label || <span class="sr-only">vowels</span>}
                      </th>
                      <For each={row.cells}>
                        {(cell) => (
                          <Show when={cell} fallback={<td class="mastery-cell mastery-cell--gap" />}>
                            {(present) => renderCell(present())}
                          </Show>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
                <Show when={grid.extras.length > 0}>
                  <tr>
                    <th scope="row" class="mastery-cell mastery-cell--label">
                      n
                    </th>
                    <For each={grid.extras}>{(cell) => renderCell(cell)}</For>
                  </tr>
                </Show>
              </tbody>
            </table>
          </div>
        )}
      </For>
      <Show when={offChart().length > 0 || props.aside !== undefined}>
        <div class="mastery-aside">
          <Show when={offChart().length > 0}>
            <div class="mastery-grid">
              <table class="mastery-table">
                <caption>also tracked</caption>
                <tbody>
                  <tr>
                    <th scope="row" class="mastery-cell mastery-cell--label">
                      <span class="sr-only">off-chart moras</span>
                    </th>
                    <For each={offChart()}>{(cell) => renderCell(cell)}</For>
                  </tr>
                </tbody>
              </table>
            </div>
          </Show>
          {props.aside}
        </div>
      </Show>
    </div>
  )
}
