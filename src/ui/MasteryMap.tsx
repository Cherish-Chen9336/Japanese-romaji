import { For, Show, children, createMemo, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import {
  cellState,
  chartCoverage,
  chartReach,
  gojuonGrids,
  KANA_SCRIPTS,
  offChartMoras,
  romajiFor,
  type CellState,
  type KanaScript,
  type MasteryCell,
} from "../engine/mastery";
import { smoothedErrorRate } from "../engine/stats";
import { tipFor } from "./Tooltip";
import type { AggregatedMoraStat } from "../engine/types";

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
 *
 * Two syllabaries behind a toggle, rather than four tables or a fourth row of
 * cells. The selected script keeps the existing three-table geometry, which is
 * the whole reason it is a toggle: katakana doubles the chart's content without
 * being allowed to double its footprint on the page's primary surface.
 */

const GROUP_LABEL: Record<string, string> = {
  seion: "plain",
  dakuten: "voiced",
  yoon: "contracted",
};

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
const SATURATION = 0.75;

export function severity(stat: AggregatedMoraStat): number {
  return Math.min(1, smoothedErrorRate(stat) / SATURATION);
}

/*
 * Segments joined with ` · `, which is what the tooltip splits on: the mora gets
 * its own line and the numbers sit beneath it, quieter. The same string is the
 * cell's screen-reader text, where the separator reads as a pause.
 */
function statusText(
  cell: MasteryCell,
  stat: AggregatedMoraStat | undefined,
): string {
  const head = [cell.kana, cell.romaji]
    .filter((part) => part !== "")
    .join("  ");
  if (stat === undefined || stat.attempts === 0)
    return `${head} · not yet seen`;
  const rate = Math.round(stat.errorRate * 100);
  const timing =
    stat.timingSamples > 0
      ? `${Math.abs(Math.round(stat.avgExcessMs))} ms ${stat.avgExcessMs >= 0 ? "slower" : "faster"} than your cadence`
      : "not timed";
  return `${head} · ${stat.misses} of ${stat.attempts} missed (${rate}%) · ${timing}`;
}

export function MasteryMap(props: {
  stats: Map<string, AggregatedMoraStat>;
  /**
   * Content for the chart's right-hand margin, stacked under the "also
   * tracked" strip.
   *
   * The three gojuon grids have very different row counts — plain and
   * contracted run 613px while voiced runs 307 — and `.mastery` is a
   * top-aligned flex row, so the tallest column decided the panel's height and
   * the shortest left a 537px hole in the top right. The margin is that hole,
   * given something to hold. (Pixel figures measured 2026-10-26, before the
   * off-chart strip was made to wrap; the shape of the problem is what
   * matters, not the numbers.)
   */
  aside?: JSX.Element;
}) {
  /*
   * Session-local, not a preference. `Preferences` is what a backup carries so
   * that a new machine comes up with the same keyboard and the same source —
   * things that decide what you practise. Which half of the chart you last
   * looked at decides nothing, and does not belong in an export.
   */
  const [script, setScript] = createSignal<KanaScript>("hiragana");
  /*
   * Two separate facts about the chart being looked at, and they have to stay
   * separate.
   *
   * `met` counts what this typist has encountered, from every source including
   * their own uploads. `reach` counts what the *bundled* text can teach, which
   * is a property of the corpus and nothing to do with the typist. Folded into
   * one sentence they implied a shared denominator: a profile that had met all
   * 104 katakana cells through uploads was still told the rest were waiting on
   * its library. Measured rather than written into the copy, so the second
   * line narrows and disappears by itself as content arrives.
   */
  const reach = createMemo(() => chartReach(script()));
  const met = createMemo(() => chartCoverage(props.stats, script()).met);
  const statFor = (kana: string) => props.stats.get(kana);
  /*
   * Resolved once. `props.aside` is a getter, so reading it twice — in the
   * `Show` guard and again in the body — built the slot's JSX twice and left
   * one copy unattached. `children` memoizes the resolution.
   */
  const aside = children(() => props.aside);
  const offChart = createMemo(() =>
    offChartMoras(props.stats).map((kana) => ({
      kana,
      romaji: romajiFor(kana),
    })),
  );

  /*
   * The parts a cell carries wherever it is drawn. Split out because the chart
   * renders cells as `<td>` and the "also tracked" list renders the same cells
   * as `<li>`; everything except the element is identical, and two copies of
   * the weak-state mark or the hidden status text is how one of them silently
   * loses it.
   *
   * **Accessors, not values.** These used to read `stat` and `state` once, at
   * render, which made every cell a snapshot of the stats as they stood when
   * the chart was built. `<For>` keys on the grid array and the grids are
   * cached, so nothing re-ran the callback when `props.stats` changed and the
   * cells kept their original colour, their original weak-state dot and their
   * original screen-reader text.
   *
   * It was latent rather than live: the stats page is behind
   * `<Show when={route() === "stats"}>`, so the chart is rebuilt on every visit
   * and nothing on that route writes a run. That is a property of today's
   * routing, not of this component — the first control that changes data
   * without leaving the page turns a latent bug into a visible one, and a chart
   * whose whole job is to colour cells by stats should not be relying on being
   * unmounted to stay truthful.
   */
  const cellParts = (cell: MasteryCell) => {
    const stat = () => statFor(cell.kana);
    const state = (): CellState => cellState(stat());
    const text = () => statusText(cell, stat());
    const weakness = () => {
      const current = stat();
      return state() === "weak" && current
        ? { "--weakness": String(severity(current)) }
        : {};
    };
    return {
      text,
      class: () => `mastery-cell mastery-cell--${state()}`,
      style: weakness,
      body: (
        <>
          <b aria-hidden="true">{cell.kana}</b>
          <Show when={cell.romaji}>
            <small aria-hidden="true">{cell.romaji}</small>
          </Show>
          {/* Colour must not be the only thing separating weak from clean. */}
          <Show when={state() === "weak"}>
            <i class="mastery-cell__mark" aria-hidden="true" />
          </Show>
          <span class="sr-only">{text()}</span>
        </>
      ),
    };
  };

  const renderCell = (cell: MasteryCell) => {
    const p = cellParts(cell);
    return (
      <td
        class={p.class()}
        style={p.style()}
        tabindex="0"
        {...tipFor(() => p.text())}
      >
        {p.body}
      </td>
    );
  };

  const renderListCell = (cell: MasteryCell) => {
    const p = cellParts(cell);
    return (
      <li
        class={p.class()}
        style={p.style()}
        tabindex="0"
        {...tipFor(() => p.text())}
      >
        {p.body}
      </li>
    );
  };

  return (
    <>
      {/*
        A plain group of buttons, not tabs. `role="tablist"` promises arrow-key
        navigation between the tabs and a `tabpanel` to land in, neither of
        which exists here — and the thing being switched is the chart's
        content, which a pressed button already describes. `aria-pressed`
        carries the state the `.active` class carries visually.
      */}
      <div class="mastery-scripts pill-row" role="group" aria-label="Syllabary">
        <For each={KANA_SCRIPTS}>
          {(name) => (
            <button
              type="button"
              class="pill"
              classList={{ active: script() === name }}
              aria-pressed={script() === name}
              onClick={() => setScript(name)}
            >
              {name}
            </button>
          )}
        </For>
      </div>
      <p class="muted mastery-reach">
        {met()} of {reach().total} encountered.
        <Show when={reach().reachable < reach().total}>
          {" "}
          The bundled text covers {reach().reachable} of these cells; your own
          library can reach the rest.
        </Show>
      </p>
      <div class="mastery">
        {/* The three kana tables wrap among themselves, so the column beside
            them keeps its place instead of being pushed onto a line of its own. */}
        <div class="mastery-tables">
          <For each={gojuonGrids(script())}>
            {(grid) => (
              <div class="mastery-grid">
                <table class="mastery-table">
                  {/* The script belongs in the caption, not only in the
                      pressed button above. A screen reader jumping table to
                      table lands on "plain" either way, and カ and か are
                      often spoken identically — so without this the two charts
                      are indistinguishable to anyone not looking at them. */}
                  <caption>
                    {GROUP_LABEL[grid.group] ?? grid.group}
                    <span class="sr-only"> · {script()}</span>
                  </caption>
                  <thead>
                    <tr>
                      <td class="mastery-cell mastery-cell--label" />
                      <For each={grid.columns}>
                        {(vowel) => (
                          <th
                            scope="col"
                            class="mastery-cell mastery-cell--label"
                          >
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
                          <th
                            scope="row"
                            class="mastery-cell mastery-cell--label"
                          >
                            {row.label || <span class="sr-only">vowels</span>}
                          </th>
                          <For each={row.cells}>
                            {(cell) => (
                              <Show
                                when={cell}
                                fallback={
                                  <td class="mastery-cell mastery-cell--gap" />
                                }
                              >
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
        </div>
        <Show when={offChart().length > 0 || aside() !== undefined}>
          <div
            class="mastery-aside"
            // The strip is 513px wide; without it this column is the width of the
            // rankings alone. That changes the width at which the column stops
            // fitting beside the tables, and so which arrangement App.css picks.
            classList={{ "mastery-aside--strip": offChart().length > 0 }}
          >
            {/*
              A list, not a table, and that is a correction rather than a style
              choice. The three charts above are genuinely two-dimensional — a
              cell means "this consonant row, that vowel column" — and a `<table>`
              hands a screen reader both for free. This is a flat bag of moras
              with no second axis: its only row header was an empty `sr-only`
              cell, present because a `<tr>` has to start somewhere.

              Drawn as one table row it also could not reflow, because a table
              row cannot wrap. At nine moras that was invisible. At 22 it meant
              the strip demanded 504px inside a 358px panel and scrolled the
              whole stats page sideways by 130px on a phone, while from 1440 down
              a container query crushed the cells from 48px to 19px to make them
              fit. One unbounded width, failing two different ways. A wrapping
              list grows downward instead, which is what an inventory should do.

              `role="list"` because Safari drops list semantics from a `<ul>`
              whose `list-style` is `none`, which is exactly what the cells need.
            */}
            <Show when={offChart().length > 0}>
              <div class="mastery-extras">
                <h4 class="mastery-extras__title">also tracked</h4>
                <ul class="mastery-extras__list" role="list">
                  <For each={offChart()}>{(cell) => renderListCell(cell)}</For>
                </ul>
              </div>
            </Show>
            {aside()}
          </div>
        </Show>
      </div>
    </>
  );
}
