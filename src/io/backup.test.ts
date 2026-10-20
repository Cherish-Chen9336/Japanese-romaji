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
    await store.replaceRuns([RUN])
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
      preferences: { showKeyboard: false, kanaGroup: 'nonsense', source: 'quotes' },
    })
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.preferences.showKeyboard).toBe(false)
      expect(parsed.backup.preferences.kanaGroup).toBe('all')
      expect(parsed.backup.preferences.source).toBe('quotes')
    }
  })

  /*
   * Why retiring `keyboardLayout` needed no BACKUP_VERSION bump. The bump
   * exists for a reader that would *misread* a file — the `mode` field was
   * bumped because a v1 reader would have taken every timed run for a passage
   * run and polluted personal bests with it. A retired preference carries no
   * measurement, and `parsePreferences` falls back per field, so a v2 file
   * written before the picker was removed loses only a setting that no longer
   * exists. In the other direction, an older build reading a file written now
   * finds the field absent and defaults it, exactly as it would for a profile
   * saved before the field existed. Neither reader is wrong, so the version
   * stays put.
   */
  it('imports a backup still carrying the retired keyboard layout', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      records: {},
      preferences: { keyboardLayout: 'mac', kanaGroup: 'yoon', source: 'quotes' },
    })
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.preferences.kanaGroup).toBe('yoon')
      expect(parsed.backup.preferences.source).toBe('quotes')
      expect('keyboardLayout' in parsed.backup.preferences).toBe(false)
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
    localStorage.setItem('japanese-romaji:show-keyboard', JSON.stringify(false))
    localStorage.setItem('japanese-romaji:kana-group', JSON.stringify('yoon'))
    const text = await exportBackup(new InMemoryRecordStore())

    localStorage.clear()
    await importBackup(new InMemoryRecordStore(), text)
    expect(readPreferences().showKeyboard).toBe(false)
    expect(readPreferences().kanaGroup).toBe('yoon')
  })

  /*
   * Restore replaces, it does not merge. Merging two histories would
   * double-count runs and invent streak days that never happened.
   */
  it('replaces an existing profile rather than merging into it', async () => {
    const text = await exportBackup(await seeded())

    const target = new InMemoryRecordStore()
    await target.replaceRuns([RUN, RUN, RUN])
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
    localStorage.setItem('japanese-romaji:kana-group', JSON.stringify('yoon'))

    expect(await resetProfile(store)).toEqual(emptyProfile())
    expect(await store.readAll()).toEqual({})
    expect(readPreferences().kanaGroup).toBe('all')
  })

  /*
   * The retired keyboard-layout key is still in ALL_PREFERENCE_KEYS, and this
   * is why. Nothing reads or writes it now, so dropping it from that list looks
   * like tidying — but a profile that already holds the value would then keep
   * it through the one action whose whole job is to erase everything.
   */
  it('sweeps up the retired keyboard-layout key', async () => {
    localStorage.setItem('japanese-romaji:keyboard-layout', JSON.stringify('mac'))
    await resetProfile(await seeded())
    expect(localStorage.getItem('japanese-romaji:keyboard-layout')).toBeNull()
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

describe('backup version 2', () => {
  const file = (version: number, runs: unknown[] = []) =>
    JSON.stringify({
      format: BACKUP_FORMAT,
      version,
      exportedAt: '2026-08-01T00:00:00.000Z',
      records: { runs },
      preferences: {},
    })

  it('exports the current version', () => {
    expect(BACKUP_VERSION).toBe(2)
  })

  /*
   * v1 is still readable because nothing in one is ambiguous: every run it can
   * contain predates time mode, and so is a passage run.
   */
  it('still reads a version 1 file, reading its runs as passage runs', () => {
    const v1 = file(1, [
      {
        source: 'words',
        chars: 40,
        mistakes: 0,
        accuracy: 100,
        wpm: 30,
        elapsedMs: 5000,
        date: '2026-08-01T00:00:00.000Z',
      },
    ])
    const parsed = parseBackup(v1)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.records.runs[0].mode).toEqual({ kind: 'passage' })
  })

  /*
   * The reason the version was bumped at all. A v1 *reader* given a file with
   * timed runs would drop the field it does not know and read every timed run as
   * a passage run, polluting personal bests with a measurement never comparable
   * to them. Refusing what it cannot interpret is the point of the version.
   */
  it('refuses a version it does not know', () => {
    expect(parseBackup(file(3))).toEqual({ ok: false, reason: 'unsupported-version' })
    expect(parseBackup(file(0))).toEqual({ ok: false, reason: 'unsupported-version' })
  })

  it('refuses a version that is not a number at all', () => {
    const bad = JSON.stringify({ format: BACKUP_FORMAT, version: '2', records: {}, preferences: {} })
    expect(parseBackup(bad)).toEqual({ ok: false, reason: 'unsupported-version' })
  })
})
