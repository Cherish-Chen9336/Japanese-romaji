import type { JSX } from 'solid-js'
import { For } from 'solid-js'
import type { RouteName } from './router'

const ITEMS: readonly { route: RouteName; label: string }[] = [
  { route: 'practice', label: 'practice' },
  { route: 'stats', label: 'stats' },
  { route: 'library', label: 'library' },
  { route: 'settings', label: 'settings' },
]

export interface BottomNavProps {
  active: RouteName
  onNavigate: (route: RouteName) => void
}

/**
 * Primary navigation — minimal text links flowing inline beneath the stage, so
 * the top-left corner is left to the wordmark alone. Not styled as chrome: no
 * bar, no border, no pills.
 */
export function BottomNav(props: BottomNavProps): JSX.Element {
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
