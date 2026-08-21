export type RouteName = 'practice' | 'result' | 'stats' | 'library' | 'settings'

export function parseRoute(hash: string): RouteName {
  const trimmed = hash.replace(/^#\/?/, '')
  if (trimmed === 'result' || trimmed === 'stats' || trimmed === 'library' || trimmed === 'settings') {
    return trimmed
  }
  return 'practice'
}

export function routeFromHash(): RouteName {
  return parseRoute(window.location.hash)
}
