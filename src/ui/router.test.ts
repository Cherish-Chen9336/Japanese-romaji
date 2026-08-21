// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseRoute, routeFromHash } from './router'

describe('parseRoute', () => {
  it('defaults to practice for an empty or unrecognized hash', () => {
    expect(parseRoute('')).toBe('practice')
    expect(parseRoute('#/')).toBe('practice')
    expect(parseRoute('#/nonsense')).toBe('practice')
  })

  it('recognizes each known route', () => {
    expect(parseRoute('#/result')).toBe('result')
    expect(parseRoute('#/stats')).toBe('stats')
    expect(parseRoute('#/library')).toBe('library')
    expect(parseRoute('#/settings')).toBe('settings')
  })

  it('tolerates a hash with no leading slash', () => {
    expect(parseRoute('#stats')).toBe('stats')
  })
})

describe('routeFromHash', () => {
  it('reads window.location.hash through parseRoute', () => {
    window.location.hash = '#/library'
    expect(routeFromHash()).toBe('library')
  })
})
