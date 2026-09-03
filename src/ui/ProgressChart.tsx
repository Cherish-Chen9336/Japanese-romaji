import { For, Show, createMemo, createSignal } from 'solid-js'
import { accuracyFloor, type Cohort, type ProgressPoint } from '../engine/stats'

/**
 * Speed and accuracy over recent runs, as two plots side by side.
 *
 * Deliberately **not** one plot with two y-scales. 0–120 wpm and 88–100% have no
 * honest common axis, and pinning them against each other invents a correlation
 * out of where the two scales happen to sit. Two plots over the same run order
 * give the reader the relationship — "faster without getting sloppier?" — while
 * each measure keeps a scale that suits it.
 *
 * The speed axis starts at zero. The accuracy axis cannot: a competent typist
 * lives in a twelve-point band, and on 0–100 that is a flat line saying nothing.
 * It is truncated and always drawn with its ticks, which is what separates an
 * honest truncated scale from a misleading one.
 */

/*
 * Side by side, and small. Stacked they shared an x-axis, which made "faster
 * without getting sloppier" a straight vertical read; side by side that has to
 * be carried by the shared hover instead — one `hover` signal drives the
 * crosshair, the marker and the readout in both plots, and the readout names the
 * run. Still two plots and never one plot with two y-scales, which is the part
 * that would actually mislead.
 */
const W = 360
const H = 132
const PAD_L = 38
const PAD_R = 12
const PAD_T = 12
const PAD_B = 18

type Plot = { height: number; min: number; max: number; ticks: number[] }

function niceMax(value: number): number {
  const step = value > 80 ? 20 : 10
  return Math.max(step, Math.ceil(value / step) * step)
}

export function ProgressChart(props: {
  points: ProgressPoint[]
  cohorts: Cohort[]
  cohort: string | null
  onCohort: (key: string) => void
}) {
  const [hover, setHover] = createSignal<number | null>(null)

  const wpmPlot = createMemo<Plot>(() => {
    const max = niceMax(Math.max(1, ...props.points.map((p) => Math.max(p.wpm, p.wpmMedian))))
    return { height: H, min: 0, max, ticks: [0, max / 2, max] }
  })

  const accPlot = createMemo<Plot>(() => {
    const min = accuracyFloor(props.points)
    return { height: H, min, max: 100, ticks: [min, Math.round((min + 100) / 2), 100] }
  })

  const x = (i: number) =>
    props.points.length < 2
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + (i / (props.points.length - 1)) * (W - PAD_L - PAD_R)

  const y = (plot: Plot, value: number) => {
    const span = plot.max - plot.min || 1
    const clamped = Math.min(plot.max, Math.max(plot.min, value))
    return PAD_T + (1 - (clamped - plot.min) / span) * (plot.height - PAD_T - PAD_B)
  }

  const path = (plot: Plot, pick: (p: ProgressPoint) => number) =>
    props.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(plot, pick(p))}`).join(' ')

  const active = () => {
    const i = hover()
    return i === null ? null : props.points[i]
  }

  /* Nearest-point on the whole band: the reader aims at a run, not at a 2px line. */
  const track = (event: PointerEvent, height: number) => {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * W
    let best = 0
    props.points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    })
    setHover(props.points.length === 0 ? null : best)
    void height
  }

  const plotSvg = (plot: () => Plot, pick: (p: ProgressPoint) => number, trend: (p: ProgressPoint) => number, label: string, unit: string) => (
    <svg
      class="chart__plot"
      viewBox={`0 0 ${W} ${plot().height}`}
      role="img"
      aria-label={summary(props.points, label, pick)}
      onPointerMove={(e) => track(e, plot().height)}
      onPointerLeave={() => setHover(null)}
    >
      <For each={plot().ticks}>
        {(tick) => (
          <>
            <line class="chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(plot(), tick)} y2={y(plot(), tick)} />
            <text class="chart__tick" x={PAD_L - 8} y={y(plot(), tick) + 4} text-anchor="end">
              {Math.round(tick)}
              {unit}
            </text>
          </>
        )}
      </For>
      <Show when={hover() !== null}>
        <line class="chart__crosshair" x1={x(hover()!)} x2={x(hover()!)} y1={PAD_T} y2={plot().height - PAD_B} />
      </Show>
      {/* Raw runs behind the trend they are the evidence for. */}
      <For each={props.points}>
        {(p, i) => <circle class="chart__dot" cx={x(i())} cy={y(plot(), pick(p))} r="3" />}
      </For>
      <Show when={props.points.length > 1}>
        <path class="chart__line" d={path(plot(), trend)} />
      </Show>
      <Show when={hover() !== null}>
        <circle class="chart__marker" cx={x(hover()!)} cy={y(plot(), pick(props.points[hover()!]))} r="4.5" />
      </Show>
    </svg>
  )

  return (
    <div class="chart">
      <Show when={props.cohorts.length > 1}>
        <div class="chart__cohorts" role="group" aria-label="Practice type">
          <For each={props.cohorts}>
            {(c) => (
              <button
                type="button"
                class="chart__cohort"
                classList={{ 'is-active': c.key === props.cohort }}
                aria-pressed={c.key === props.cohort}
                onClick={() => props.onCohort(c.key)}
              >
                {c.label} <small>{c.count}</small>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={props.points.length > 0}
        fallback={<p class="muted">No runs of this kind yet.</p>}
      >
        <div class="chart__readout">
          <span>
            <b>{active()?.wpm ?? props.points[props.points.length - 1].wpm}</b> wpm
          </span>
          <span>
            <b>{active()?.accuracy ?? props.points[props.points.length - 1].accuracy}%</b> accuracy
          </span>
          {/* Names the run both plots are showing. Side by side they no longer
              share an x-axis, so the correspondence has to be said rather than
              seen — hovering either plot marks the same run in both. */}
          <span class="muted">
            {active()
              ? `run ${hover()! + 1} of ${props.points.length} · ${dateLabel(active()!.date)}`
              : `${props.points.length} runs, oldest to newest`}
          </span>
        </div>
        <div class="chart__plots">
          <figure>
            <figcaption class="chart__axis-label">speed</figcaption>
            {plotSvg(wpmPlot, (p) => p.wpm, (p) => p.wpmMedian, 'Speed', '')}
          </figure>
          <figure>
            <figcaption class="chart__axis-label">accuracy</figcaption>
            {plotSvg(accPlot, (p) => p.accuracy, (p) => p.accuracyMedian, 'Accuracy', '%')}
          </figure>
        </div>
      </Show>
    </div>
  )
}

function dateLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** The plot in one sentence, for anyone who cannot see it. */
function summary(points: ProgressPoint[], label: string, pick: (p: ProgressPoint) => number): string {
  if (points.length === 0) return `${label}: no runs yet.`
  const first = pick(points[0])
  const last = pick(points[points.length - 1])
  const direction = last > first ? 'up from' : last < first ? 'down from' : 'level with'
  return `${label} over the last ${points.length} runs: ${last}, ${direction} ${first}.`
}
