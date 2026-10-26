import type { JSX } from 'solid-js'
import { For } from 'solid-js'
import type { RouteName } from './router'

const ITEMS: readonly { route: RouteName; label: string }[] = [
  { route: 'practice', label: 'practice' },
  { route: 'stats', label: 'stats' },
  { route: 'library', label: 'library' },
  { route: 'settings', label: 'settings' },
]

export interface PrimaryNavProps {
  active: RouteName
  onNavigate: (route: RouteName) => void
}

/**
 * Primary navigation — minimal text links sitting in the middle column of the
 * top bar, between the wordmark and the live counters. Deliberately not chrome:
 * no bar, no border, no pills; the centre line of the page is what places it,
 * not a box drawn around it.
 *
 * It used to run beneath the stage, which left the top-left corner to the
 * wordmark alone. Moved up on 2026-10-26: with the brand now two lines tall the
 * header had the height to carry the links, and a reader looking for the way to
 * another screen was being asked to go past the whole typing stage first.
 */
export function PrimaryNav(props: PrimaryNavProps): JSX.Element {
  return (
    <nav class="subnav" aria-label="primary navigation">
      <For each={ITEMS}>
        {(item) => (
          <button
            type="button"
            class="subnav__item"
            classList={{ 'subnav__item--active': props.active === item.route }}
            aria-current={props.active === item.route ? 'page' : undefined}
            onClick={(event) => {
              event.stopPropagation()
              props.onNavigate(item.route)
            }}
          >
            {item.label}
          </button>
        )}
      </For>
    </nav>
  )
}
