// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readJson, writeJson } from './storage'

beforeEach(() => {
  localStorage.clear()
})

describe('readJson', () => {
  it('returns the fallback when the key is absent', () => {
    expect(readJson('missing', { a: 1 })).toEqual({ a: 1 })
  })

  it('returns the parsed value when the key is present', () => {
    localStorage.setItem('present', JSON.stringify({ b: 2 }))
    expect(readJson('present', { b: 0 })).toEqual({ b: 2 })
  })

  it('returns the fallback rather than throwing on corrupt JSON', () => {
    localStorage.setItem('corrupt', '{not json')
    expect(readJson('corrupt', 'fallback')).toBe('fallback')
  })
})

describe('writeJson', () => {
  it('stores the value as JSON under the given key and returns true', () => {
    expect(writeJson('key', { c: 3 })).toBe(true)
    expect(localStorage.getItem('key')).toBe('{"c":3}')
  })

  it('round-trips through readJson', () => {
    const value = { list: [1, 2, 3], nested: { ok: true } }
    writeJson('roundtrip', value)
    expect(readJson('roundtrip', null)).toEqual(value)
  })

  it('returns false and does not throw when localStorage is full', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(writeJson('key', 'value')).toBe(false)
    spy.mockRestore()
  })
})
