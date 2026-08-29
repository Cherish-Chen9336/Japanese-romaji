import { For, Show } from 'solid-js'
import { chartMoras, gojuonGrids, type MasteryCell } from '../engine/mastery'
import { smoothedErrorRate } from '../engine/stats'
import type { AggregatedMoraStat } from '../engine/types'

/**
 * The 五十音 chart tinted by how well each mora is known.
 *
 * One colour channel, and accuracy gets it. Excess latency goes in the tooltip
 * rather than into a second visual encoding: a mora you have never mistyped is
 * not weak however slow it is, which is the rule `weakestKana` already follows,
 * and one shade standing for two different problems is what made the old
 * `avgMs / 600 + errorRate` keyboard tint unreadable.
 *
 * Three states, because "never met" and "met and never missed" are different
 * facts and a single opacity ramp collapses them into the same pale cell — which
 * would tell a beginner they were fine at every kana they had yet to see.
 */

const GROUP_LABEL: Record<string, string> = {
  seion: 'plain',
  dakuten: 'voiced',
  yoon: 'contracted',
}

function cellTitle(cell: MasteryCell, stat: AggregatedMoraStat | undefined): string {
  // An off-chart mora has no spelling to teach, so it contributes no field
  // rather than an empty one between two separators.
  const head = [cell.kana, cell.romaji].filter((part) => part !== '')
  if (stat === undefined || stat.attempts === 0) return [...head, 'not yet seen'].join(' · ')
  const rate = Math.round(stat.errorRate * 100)
  const timing =
    (stat.timingSamples ?? 0) > 0
      ? `${stat.avgExcessMs >= 0 ? '+' : ''}${Math.round(stat.avgExcessMs)} ms vs your cadence`
      : 'not timed'
  return [...head, `${stat.misses}/${stat.attempts} missed (${rate}%)`, timing].join(' · ')
}

export function MasteryMap(props: { stats: Map<string, AggregatedMoraStat> }) {
  const statFor = (kana: string) => props.stats.get(kana)

  /*
   * Moras that are tracked but have no cell on the chart — sokuon, in practice,
   * since っこ is a real encounter and 五十音 has no square for it. Shown rather
   * than dropped: the weakest-kana line is drawn from the same table, so hiding
   * them here would name a mora as your worst and then not show it anywhere.
   * Driven by what has actually been met, so it stays empty until it isn't.
   */
  const offChart = () => {
    const onChart = new Set(chartMoras())
    return [...props.stats.entries()]
      .filter(([kana, stat]) => !onChart.has(kana) && stat.attempts > 0)
      .map(([kana]) => ({ kana, romaji: '' }))
      .sort((a, b) => a.kana.localeCompare(b.kana))
  }

  const cellClass = (kana: string) => {
    const stat = statFor(kana)
    if (stat === undefined || stat.attempts === 0) return 'mastery-cell mastery-cell--unseen'
    if (stat.misses === 0) return 'mastery-cell mastery-cell--clean'
    return 'mastery-cell mastery-cell--weak'
  }

  // Only the weak cells carry colour, and the ramp starts well above zero so the
  // faintest weak cell still reads as different from a clean one.
  const cellStyle = (kana: string) => {
    const stat = statFor(kana)
    if (stat === undefined || stat.misses === 0) return {}
    return { '--weakness': String(0.2 + 0.8 * smoothedErrorRate(stat)) }
  }

  const renderCell = (cell: MasteryCell) => (
    <span class={cellClass(cell.kana)} style={cellStyle(cell.kana)} title={cellTitle(cell, statFor(cell.kana))}>
      <b>{cell.kana}</b>
      <Show when={cell.romaji}>
        <small>{cell.romaji}</small>
      </Show>
    </span>
  )

  return (
    <div class="mastery">
      <For each={gojuonGrids()}>
        {(grid) => (
          <div class="mastery-grid">
            <p class="mastery-grid__title">{GROUP_LABEL[grid.group] ?? grid.group}</p>
            {/* Leading spacer matches the row-label column, so the vowel
                headings sit over the cells they name rather than beside them. */}
            <div class="mastery-grid__row">
              <span class="mastery-cell mastery-cell--label" />
              <For each={grid.columns}>{(vowel) => <span class="mastery-cell mastery-cell--label">{vowel}</span>}</For>
            </div>
            <For each={grid.rows}>
              {(row) => (
                <div class="mastery-grid__row">
                  <span class="mastery-cell mastery-cell--label">{row.label || '—'}</span>
                  <For each={row.cells}>
                    {(cell) => (
                      <Show when={cell} fallback={<span class="mastery-cell mastery-cell--gap" />}>
                        {(present) => renderCell(present())}
                      </Show>
                    )}
                  </For>
                </div>
              )}
            </For>
            <Show when={grid.extras.length > 0}>
              <div class="mastery-grid__row">
                <span class="mastery-cell mastery-cell--label">n</span>
                <For each={grid.extras}>{(cell) => renderCell(cell)}</For>
              </div>
            </Show>
          </div>
        )}
      </For>
      <Show when={offChart().length > 0}>
        <div class="mastery-grid">
          <p class="mastery-grid__title">also tracked</p>
          <div class="mastery-grid__row">
            <span class="mastery-cell mastery-cell--label" />
            <For each={offChart()}>{(cell) => renderCell(cell)}</For>
          </div>
        </div>
      </Show>
    </div>
  )
}
