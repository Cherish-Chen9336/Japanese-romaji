// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFilename,
  buildBackup,
  exportBackup,
  importBackup,
  parseBackup,
  resetProfile,
} from './backup'
import { emptyProfile, loadProfile, readPreferences } from './persistence'
import { InMemoryRecordStore } from './records'

const RUN = {
  source: 'kana' as const,
  chars: 20,
  mistakes: 1,
  accuracy: 95,
  wpm: 42,
  elapsedMs: 6000,
  date: '2026-08-01T00:00:00.000Z',
}

function seeded() {
  const store = new InMemoryRecordStore()
  return (async () => {
    await store.write('runs', [RUN])
    await store.write('library', [{ kana: 'えき', romaji: 'eki' }])
    await store.write('misses', { k: 3 })
    await store.write('confusions', { 'a → b': 2 })
    return store
  })()
}

beforeEach(() => {
  localStorage.clear()
})

describe('buildBackup', () => {
  it('stamps the format and version so a reader knows what it has', () => {
    const backup = buildBackup(emptyProfile(), readPreferences(), () => '2026-08-22T00:00:00.000Z')
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.exportedAt).toBe('2026-08-22T00:00:00.000Z')
  })
})

describe('parseBackup', () => {
  it('accepts what exportBackup produces', async () => {
    const text = await exportBackup(await seeded())
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.records.runs).toHaveLength(1)
      expect(parsed.backup.records.library).toEqual([{ kana: 'えき', romaji: 'eki' }])
      expect(parsed.backup.records.misses).toEqual({ k: 3 })
    }
  })

  it('rejects a file that is not JSON', () => {
    expect(parseBackup('not json at all')).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('rejects JSON that is not one of our backups', () => {
    expect(parseBackup('{"hello":"world"}')).toEqual({ ok: false, reason: 'not-a-backup' })
    expect(parseBackup('[1,2,3]')).toEqual({ ok: false, reason: 'not-a-backup' })
    expect(parseBackup('null')).toEqual({ ok: false, reason: 'not-a-backup' })
  })

  /*
   * Refusing an unknown version rather than doing our best with it: a file from
   * a future release has fields we don't understand, and guessing at them would
   * corrupt a profile instead of declining to touch it.
   */
  it('refuses a version it does not know', () => {
    const future = JSON.stringify({ format: BACKUP_FORMAT, version: 99, records: {} })
    expect(parseBackup(future)).toEqual({ ok: false, reason: 'unsupported-version' })
  })

  it('drops corrupt records rather than failing the whole file', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      records: {
        runs: [RUN, { source: 'nonsense' }, null],
        library: 'not an array',
        misses: { a: 1, b: 'lots' },
      },
    })
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.records.runs).toHaveLength(1)
      expect(parsed.backup.records.library).toEqual([])
      expect(parsed.backup.records.misses).toEqual({ a: 1 })
    }
  })

  it('falls back per preference rather than discarding the whole set', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      records: {},
      preferences: { keyboardLayout: 'mac', kanaGroup: 'nonsense', source: 'quotes' },
    })
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.preferences.keyboardLayout).toBe('mac')
      expect(parsed.backup.preferences.kanaGroup).toBe('all')
      expect(parsed.backup.preferences.source).toBe('quotes')
    }
  })
})

describe('export then import', () => {
  it('round-trips a profile into a fresh store', async () => {
    const text = await exportBackup(await seeded())

    const restored = new InMemoryRecordStore()
    const result = await importBackup(restored, text)
    expect(result.ok).toBe(true)

    const profile = await loadProfile(restored)
    expect(profile.runs).toHaveLength(1)
    expect(profile.runs[0].wpm).toBe(42)
    expect(profile.library).toEqual([{ kana: 'えき', romaji: 'eki' }])
    expect(profile.misses).toEqual({ k: 3 })
    expect(profile.confusions).toEqual({ 'a → b': 2 })
  })

  it('carries preferences across too, not just history', async () => {
    localStorage.setItem('japanese-romaji:keyboard-layout', JSON.stringify('mac'))
    localStorage.setItem('japanese-romaji:kana-group', JSON.stringify('yoon'))
    const text = await exportBackup(new InMemoryRecordStore())

    localStorage.clear()
    await importBackup(new InMemoryRecordStore(), text)
    expect(readPreferences().keyboardLayout).toBe('mac')
    expect(readPreferences().kanaGroup).toBe('yoon')
  })

  /*
   * Restore replaces, it does not merge. Merging two histories would
   * double-count runs and invent streak days that never happened.
   */
  it('replaces an existing profile rather than merging into it', async () => {
    const text = await exportBackup(await seeded())

    const target = new InMemoryRecordStore()
    await target.write('runs', [RUN, RUN, RUN])
    await target.write('confusions', { 'x → y': 9 })
    await importBackup(target, text)

    const profile = await loadProfile(target)
    expect(profile.runs).toHaveLength(1)
    expect(profile.confusions).toEqual({ 'a → b': 2 })
  })

  it('leaves the store untouched when the file is rejected', async () => {
    const store = await seeded()
    const result = await importBackup(store, 'not a backup')
    expect(result.ok).toBe(false)
    expect((await loadProfile(store)).runs).toHaveLength(1)
  })
})

describe('resetProfile', () => {
  it('empties the store and the preferences together', async () => {
    const store = await seeded()
    localStorage.setItem('japanese-romaji:keyboard-layout', JSON.stringify('mac'))

    expect(await resetProfile(store)).toEqual(emptyProfile())
    expect(await store.readAll()).toEqual({})
    expect(readPreferences().keyboardLayout).toBe('windows')
  })

  /*
   * The pre-IndexedDB keys have to go too. They survive migration on purpose —
   * they are the only copy until the first write lands — but leaving them
   * behind means the next load migrates the wiped profile straight back in.
   */
  it('removes the legacy localStorage records so a reset cannot undo itself', async () => {
    localStorage.setItem('japanese-romaji:runs', JSON.stringify([RUN]))
    await resetProfile(new InMemoryRecordStore())
    expect(localStorage.getItem('japanese-romaji:runs')).toBeNull()
  })
})

describe('backupFilename', () => {
  it('dates the file so successive exports do not silently overwrite', () => {
    expect(backupFilename(new Date('2026-08-22T13:00:00Z'))).toBe('kana-type-profile-2026-08-22.json')
  })
})
