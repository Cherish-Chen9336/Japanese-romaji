import {
  type Preferences,
  type StoredProfile,
  clearPreferences,
  emptyProfile,
  loadProfile,
  parseCountMap,
  parseLibrary,
  parseLifetimeStats,
  parsePreferences,
  parseRuns,
  readPreferences,
  writePreferences,
} from './persistence'
import { RECORD_NAMES, type RecordStore } from './records'

/**
 * Export / import / reset for the whole profile.
 *
 * The file is plain JSON with a format marker and a version. Refusing an
 * unrecognised version is deliberate: silently reinterpreting a file written by
 * a future release would corrupt a profile rather than decline to touch it.
 *
 * v2 adds `mode` to a run. The bump is what stops a *v1 reader* accepting a file
 * containing timed runs: it would drop the field it does not know and read every
 * timed run as a passage run, quietly polluting personal bests with a
 * measurement they were never comparable to. Refusing the file is the whole
 * point of carrying a version.
 *
 * v1 files are still read, because nothing about them is ambiguous — every run
 * in one predates time mode and so is a passage run.
 */

export const BACKUP_FORMAT = 'japanese-romaji-profile'
export const BACKUP_VERSION = 2

/** Versions this build can read. Older ones are migrated on the way in. */
const READABLE_VERSIONS = new Set([1, 2])

export type Backup = {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  records: StoredProfile
  preferences: Preferences
}

export function buildBackup(
  records: StoredProfile,
  preferences: Preferences,
  now: () => string = () => new Date().toISOString(),
): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now(),
    records,
    preferences,
  }
}

export type ParseResult =
  | { ok: true; backup: Backup }
  | { ok: false; reason: 'unreadable' | 'not-a-backup' | 'unsupported-version' }

/**
 * Validates a file's contents. Every record goes through the same parsers a
 * stored record does, so a hand-edited or truncated backup loses the bad
 * entries rather than taking the app down on the next render.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not-a-backup' }
  }
  const r = raw as Record<string, unknown>
  if (r.format !== BACKUP_FORMAT) return { ok: false, reason: 'not-a-backup' }
  if (typeof r.version !== 'number' || !READABLE_VERSIONS.has(r.version)) {
    return { ok: false, reason: 'unsupported-version' }
  }

  const source = (r.records ?? {}) as Record<string, unknown>
  const runs = parseRuns(source.runs)
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : '',
      records: {
        runs,
        library: parseLibrary(source.library),
        lifetime: parseLifetimeStats(source.lifetime, runs),
        misses: parseCountMap(source.misses),
        confusions: parseCountMap(source.confusions),
      },
      preferences: parsePreferences(r.preferences),
    },
  }
}

/** The current profile, serialised. */
export async function exportBackup(store: RecordStore): Promise<string> {
  const backup = buildBackup(await loadProfile(store), readPreferences())
  return JSON.stringify(backup, null, 2)
}

/**
 * Replaces the profile with the contents of a backup — every record, not a
 * merge. Merging two histories would double-count runs and invent streak days
 * that never happened, so restore means restore.
 */
export async function importBackup(
  store: RecordStore,
  text: string,
): Promise<ParseResult & { profile?: StoredProfile; preferences?: Preferences }> {
  const parsed = parseBackup(text)
  if (!parsed.ok) return parsed

  const { records, preferences } = parsed.backup
  await store.clear()
  await store.replaceRuns(records.runs)
  await store.write('library', records.library)
  await store.write('lifetime', records.lifetime)
  await store.write('misses', records.misses)
  await store.write('confusions', records.confusions)
  writePreferences(preferences)

  return { ...parsed, profile: records, preferences }
}

/** Wipes everything this app has stored, in both backends. */
export async function resetProfile(store: RecordStore): Promise<StoredProfile> {
  await store.clear()
  clearPreferences()
  return emptyProfile()
}

/** Suggested filename — dated, so successive exports don't overwrite silently. */
export function backupFilename(now: Date = new Date()): string {
  return `kana-type-profile-${now.toISOString().slice(0, 10)}.json`
}

/**
 * Hands the file to the browser. Kept here rather than in a component because
 * it is the one part of exporting that touches the DOM.
 */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export { RECORD_NAMES }
