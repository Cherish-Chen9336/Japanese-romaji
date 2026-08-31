import { Show } from 'solid-js'

/**
 * Speed over recent runs: raw points, a smoothed line, and accuracy beneath.
 *
 * A histogram of five twenty-wpm bins used to stand here. It could describe a
 * lifetime spread but never a direction — going 20 → 40 and going 40 → 20 drew
 * the same picture — and "am I improving" is the only question this part of the
 * page exists to answer.
 *
 * The heavy line is a five-run rolling median, with the raw runs as faint dots
 * behind it. A raw line alone reads as violent, because a single bad run swings
 * it far enough to look like a trend that is not there.
 */

const W = 320
const H = 96
const PAD = 6

export function Sparkline(props: {
  points: { wpm: number; accuracy: number; median: number }[]
}) {
  const scale = () => {
    const values = props.points.flatMap((p) => [p.wpm, p.median])
    const max = Math.max(1, ...values)
    // Floor at zero rather than at the minimum: a line that always fills the box
    // makes a two-wpm wobble look like a transformation.
    const x = (i: number) =>
      props.points.length < 2 ? W / 2 : PAD + (i / (props.points.length - 1)) * (W - PAD * 2)
    const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
    return { x, y, max }
  }

  const line = () => {
    const { x, y } = scale()
    return props.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.median)}`).join(' ')
  }

  return (
    <Show
      when={props.points.length > 1}
      fallback={<p class="muted">Two runs and the trend appears here.</p>}
    >
      <figure class="spark">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel(props.points)}>
          {/* Raw runs, behind the smoothed line they are the evidence for. */}
          {props.points.map((p, i) => (
            <circle class="spark__dot" cx={scale().x(i)} cy={scale().y(p.wpm)} r="2" />
          ))}
          <path class="spark__line" d={line()} />
        </svg>
        <figcaption>
          <span>
            <b>{props.points[props.points.length - 1].median}</b> wpm
          </span>
          <span class="muted">
            {props.points.length} runs · peak {Math.round(scale().max)} wpm
          </span>
        </figcaption>
      </figure>
    </Show>
  )
}

/** The chart in one sentence, for anyone who cannot see it. */
function ariaLabel(points: { median: number }[]): string {
  const first = points[0]?.median ?? 0
  const last = points[points.length - 1]?.median ?? 0
  const direction = last > first ? 'up from' : last < first ? 'down from' : 'unchanged from'
  return `Typing speed over the last ${points.length} runs: ${last} wpm, ${direction} ${first}.`
}
