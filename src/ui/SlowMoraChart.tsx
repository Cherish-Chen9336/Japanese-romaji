import { For, Show, createMemo, createSignal } from 'solid-js'
import type { AggregatedMoraStat } from '../engine/types'

/**
 * The moras that cost the most time beyond what their spelling explains.
 *
 * Columns, because the job is comparing magnitudes across a handful of named
 * things, and one hue, because there is one series — colouring each column by
 * its own height would spend the free channel restating what the height already
 * says.
 *
 * The values are excess milliseconds, already baseline-adjusted, so this ranks
 * hesitation rather than spelling length. It answers what the mastery chart
 * deliberately does not: the chart says what you get *wrong*, this says what you
 * have to *think about*.
 */

const H = 168
const PAD_T = 22
const PAD_B = 34
const MAX_BAR = 34

export function SlowMoraChart(props: { moras: [string, AggregatedMoraStat][] }) {
  const [hover, setHover] = createSignal<number | null>(null)

  const max = createMemo(() => Math.max(1, ...props.moras.map(([, s]) => s.avgExcessMs)))

  /* Honest zero baseline: columns grow from one line, so height is the value. */
  const height = (value: number) => ((value / max()) * (H - PAD_T - PAD_B))

  return (
    <Show
      when={props.moras.length > 0}
      fallback={<p class="muted">Nothing is slowing you down yet.</p>}
    >
      <div class="slow-chart" style={{ '--slow-h': `${H}px`, '--slow-bar': `${MAX_BAR}px` }}>
        <For each={props.moras}>
          {([kana, stat], i) => (
            <button
              type="button"
              class="slow-chart__col"
              classList={{ 'is-active': hover() === i() }}
              onPointerEnter={() => setHover(i())}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i())}
              onBlur={() => setHover(null)}
            >
              <span class="slow-chart__value">+{Math.round(stat.avgExcessMs)}</span>
              <span class="slow-chart__bar" style={{ height: `${height(stat.avgExcessMs)}px` }} />
              <span class="slow-chart__kana">{kana}</span>
              <span class="sr-only">
                {`${kana}: ${Math.round(stat.avgExcessMs)} ms slower than your cadence, over ${stat.timingSamples} timed encounters`}
              </span>
            </button>
          )}
        </For>
      </div>
      <p class="muted slow-chart__note">
        Milliseconds beyond what each spelling costs at your own cadence.
      </p>
    </Show>
  )
}
