// @vitest-environment jsdom
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { MasteryMap } from './MasteryMap'
import type { AggregatedMoraStat } from '../engine/types'

/*
 * The one component test in this project, and it exists for one reason: the
 * cells are the only place where a reactive read is the difference between a
 * chart that tells the truth and a chart that shows the stats as they stood
 * when it was built. Nothing on the statistics route writes a run today, so
 * that failure cannot be reached through the UI — which is exactly why it
 * needs a test rather than a look.
 */

function stat(attempts: number, misses: number): AggregatedMoraStat {
  return {
    attempts,
    misses,
    totalMs: attempts * 200,
    avgMs: 200,
    errorRate: attempts === 0 ? 0 : misses / attempts,
    timingSamples: attempts,
    excessMs: 0,
    avgExcessMs: 0,
  }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function mount(stats: () => Map<string, AggregatedMoraStat>) {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => <MasteryMap stats={stats()} />, host))
  cleanups.push(() => host.remove())
  return host
}

/** The chart cell drawn for one mora, found the way a reader finds it. */
function cellFor(host: HTMLElement, kana: string): HTMLElement {
  const match = [...host.querySelectorAll('.mastery-table .mastery-cell')].find(
    (cell) => cell.querySelector('b')?.textContent === kana,
  )
  if (match === undefined) throw new Error(`no cell drawn for ${kana}`)
  return match as HTMLElement
}

describe('MasteryMap cells', () => {
  it('draws an unmet mora as unseen and a clean one as clean', () => {
    const host = mount(() => new Map([['か', stat(4, 0)]]))
    expect(cellFor(host, 'か').className).toContain('mastery-cell--clean')
    expect(cellFor(host, 'き').className).toContain('mastery-cell--unseen')
  })

  /*
   * The regression this file was written for. The cells used to read their stat
   * once, at render; `<For>` keys on the grid array and the grids are cached,
   * so nothing re-ran the callback and every cell stayed as first drawn.
   */
  it('recolours a cell when the stats change under it', () => {
    const [stats, setStats] = createSignal(new Map([['か', stat(4, 0)]]))
    const host = mount(stats)
    expect(cellFor(host, 'か').className).toContain('mastery-cell--clean')

    setStats(new Map([['か', stat(4, 3)]]))
    expect(cellFor(host, 'か').className).toContain('mastery-cell--weak')
  })

  /* Colour is not the only carrier: the dot and the screen-reader text have to
     follow the same change, or one of the three goes quietly stale. */
  it('brings the weak mark and the status text with it', () => {
    const [stats, setStats] = createSignal(new Map([['か', stat(4, 0)]]))
    const host = mount(stats)
    expect(cellFor(host, 'か').querySelector('.mastery-cell__mark')).toBeNull()
    expect(cellFor(host, 'か').querySelector('.sr-only')?.textContent).toContain('0 of 4 missed')

    setStats(new Map([['か', stat(4, 3)]]))
    expect(cellFor(host, 'か').querySelector('.mastery-cell__mark')).not.toBeNull()
    expect(cellFor(host, 'か').querySelector('.sr-only')?.textContent).toContain('3 of 4 missed')
  })

  /* A mora that becomes weak has to take its depth with it, or every weak cell
     draws at whatever weight the first one happened to have. */
  it('updates the weakness depth a cell is tinted by', () => {
    const [stats, setStats] = createSignal(new Map([['か', stat(10, 1)]]))
    const host = mount(stats)
    const shallow = cellFor(host, 'か').style.getPropertyValue('--weakness')

    setStats(new Map([['か', stat(10, 9)]]))
    const deep = cellFor(host, 'か').style.getPropertyValue('--weakness')
    expect(Number(deep)).toBeGreaterThan(Number(shallow))
  })

  /* The "also tracked" strip is drawn from the same `cellParts`, so it has the
     same failure mode — and it is the list that appears and disappears. */
  it('adds an off-chart mora to the strip when it is first met', () => {
    const [stats, setStats] = createSignal(new Map([['か', stat(4, 0)]]))
    const host = mount(stats)
    expect(host.querySelector('.mastery-extras')).toBeNull()

    setStats(new Map([['か', stat(4, 0)], ['っこ', stat(2, 1)]]))
    const strip = [...host.querySelectorAll('.mastery-extras__list > li b')].map((b) => b.textContent)
    expect(strip).toEqual(['っこ'])
  })
})
