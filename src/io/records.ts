import {
  DB_NAME,
  RECORDS_STORE,
  RUNS_STORE,
  openDb,
  promisifyRequest,
  settle,
} from './db'

/**
 * The small records: written whole because they stay small. Run history is not
 * among them — it has its own store and its own append path, because rewriting
 * a growing history on every save is what this split exists to stop.
 *
 * UI preferences deliberately stay in localStorage. They are tiny, and reading
 * them synchronously is what lets the first paint happen without a database.
 */
export type RecordName = 'library' | 'lifetime' | 'misses' | 'confusions'

export const RECORD_NAMES: readonly RecordName[] = [
  'library',
  'lifetime',
  'misses',
  'confusions',
]

/** Where the whole run history used to live, before it got its own store. */
const LEGACY_RUNS_KEY = 'runs'

export interface RecordStore {
  readAll(): Promise<Partial<Record<RecordName, unknown>>>
  write(name: RecordName, value: unknown): Promise<void>
  /** Newest first, matching how the app holds them. */
  readRuns(): Promise<unknown[]>
  /** O(1) — the whole point of the separate store. */
  appendRun(run: unknown): Promise<void>
  /**
   * The run and the lifetime aggregate in one transaction, or neither. Written
   * separately they could disagree: a run no total counted, or totals claiming a
   * run whose record was never written.
   */
  commitRun(run: unknown, lifetime: unknown): Promise<void>
  /** Wholesale replacement, for importing a backup. */
  replaceRuns(runs: readonly unknown[]): Promise<void>
  clear(): Promise<void>
}

/** Fallback when IndexedDB is unavailable, and the store the tests drive. */
export class InMemoryRecordStore implements RecordStore {
  private data = new Map<RecordName, unknown>()
  private runs: unknown[] = []

  readAll(): Promise<Partial<Record<RecordName, unknown>>> {
    const out: Partial<Record<RecordName, unknown>> = {}
    for (const [name, value] of this.data) out[name] = value
    return Promise.resolve(out)
  }

  write(name: RecordName, value: unknown): Promise<void> {
    // Round-trip through JSON so callers can't hold a live reference into the
    // store, matching what a real structured clone would do.
    this.data.set(name, JSON.parse(JSON.stringify(value)))
    return Promise.resolve()
  }

  readRuns(): Promise<unknown[]> {
    return Promise.resolve([...this.runs].reverse())
  }

  appendRun(run: unknown): Promise<void> {
    this.runs.push(JSON.parse(JSON.stringify(run)))
    return Promise.resolve()
  }

  commitRun(run: unknown, lifetime: unknown): Promise<void> {
    this.runs.push(JSON.parse(JSON.stringify(run)))
    this.data.set('lifetime', JSON.parse(JSON.stringify(lifetime)))
    return Promise.resolve()
  }

  replaceRuns(runs: readonly unknown[]): Promise<void> {
    // Stored oldest-first, mirroring the ascending keys IndexedDB assigns.
    this.runs = [...runs].reverse().map((run) => JSON.parse(JSON.stringify(run)))
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.data.clear()
    this.runs = []
    return Promise.resolve()
  }
}

export class IndexedDbRecordStore implements RecordStore {
  private connection: Promise<IDBDatabase> | null = null
  private readonly factory: IDBFactory

  constructor(factory: IDBFactory) {
    this.factory = factory
  }

  private open(): Promise<IDBDatabase> {
    if (this.connection !== null) return this.connection

    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = openDb(this.factory)
      request.onsuccess = () => {
        const db = request.result
        // Another tab upgrading the schema blocks on open connections; close so
        // it can proceed, and drop the cache so the next call re-opens.
        db.onversionchange = () => {
          db.close()
          if (this.connection === pending) this.connection = null
        }
        // Closed out from under us (eviction, browser memory pressure) — the
        // cached handle is dead, so make the next call open a fresh one.
        db.onclose = () => {
          if (this.connection === pending) this.connection = null
        }
        resolve(db)
      }
      request.onerror = () => reject(request.error ?? new Error('failed to open IndexedDB'))
      request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'))
    })

    this.connection = pending
    // Never cache a rejection: one transient failure to open must not poison
    // every read and write for the rest of the page's life.
    pending.catch(() => {
      if (this.connection === pending) this.connection = null
    })
    return pending
  }

  async readAll(): Promise<Partial<Record<RecordName, unknown>>> {
    const db = await this.open()
    const tx = db.transaction(RECORDS_STORE, 'readonly')
    const store = tx.objectStore(RECORDS_STORE)
    // Every request issued before the first await — see promisifyRequest.
    const pending = RECORD_NAMES.map((name) => promisifyRequest(store.get(name)))
    const values = await Promise.all(pending)

    const out: Partial<Record<RecordName, unknown>> = {}
    RECORD_NAMES.forEach((name, index) => {
      if (values[index] !== undefined) out[name] = values[index]
    })
    return out
  }

  async write(name: RecordName, value: unknown): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(RECORDS_STORE, 'readwrite')
    tx.objectStore(RECORDS_STORE).put(value, name)
    await settle(tx, 'write')
  }

  /**
   * Reads the run store, and folds in a pre-v2 history the first time it sees
   * one. The old blob is moved rather than copied — left in place it would be
   * re-imported on every load, and a history the user had since cleared would
   * come back from the dead.
   */
  async readRuns(): Promise<unknown[]> {
    const db = await this.open()
    const tx = db.transaction([RUNS_STORE, RECORDS_STORE], 'readonly')
    const stored = promisifyRequest(tx.objectStore(RUNS_STORE).getAll())
    const legacy = promisifyRequest(tx.objectStore(RECORDS_STORE).get(LEGACY_RUNS_KEY))
    const [runs, blob] = await Promise.all([stored, legacy])

    if (blob !== undefined) {
      // Only adopt the old blob into an empty store. Adopting unconditionally
      // would resurrect a history the user had deliberately cleared.
      if (Array.isArray(blob) && runs.length === 0 && blob.length > 0) {
        await this.replaceRuns(blob)
        return [...blob]
      }
      await this.dropLegacyRuns()
    }

    // Ascending keys mean oldest first; the app holds them newest first.
    return runs.reverse()
  }

  private async dropLegacyRuns(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(RECORDS_STORE, 'readwrite')
    tx.objectStore(RECORDS_STORE).delete(LEGACY_RUNS_KEY)
    await settle(tx, 'legacy cleanup')
  }

  async appendRun(run: unknown): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(RUNS_STORE, 'readwrite')
    tx.objectStore(RUNS_STORE).add(run)
    await settle(tx, 'append')
  }

  /**
   * Appends the run and updates the lifetime aggregate together, or neither.
   *
   * They were two transactions. A crash, a closed tab or a failed write between
   * them left the profile disagreeing with itself: a run in the history that no
   * total counted, or totals claiming a run whose record was never written.
   * Neither is recoverable afterwards, because nothing records which of the two
   * is the truth.
   */
  async commitRun(run: unknown, lifetime: unknown): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([RUNS_STORE, RECORDS_STORE], 'readwrite')
    tx.objectStore(RUNS_STORE).add(run)
    tx.objectStore(RECORDS_STORE).put(lifetime, 'lifetime')
    await settle(tx, 'commit run')
  }

  async replaceRuns(runs: readonly unknown[]): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([RUNS_STORE, RECORDS_STORE], 'readwrite')
    const store = tx.objectStore(RUNS_STORE)
    store.clear()
    // Oldest first, so the assigned keys ascend with age.
    for (const run of [...runs].reverse()) store.add(run)
    tx.objectStore(RECORDS_STORE).delete(LEGACY_RUNS_KEY)
    await settle(tx, 'replace')
  }

  async clear(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([RECORDS_STORE, RUNS_STORE], 'readwrite')
    tx.objectStore(RECORDS_STORE).clear()
    tx.objectStore(RUNS_STORE).clear()
    await settle(tx, 'clear')
  }
}

/**
 * The store the app runs on: IndexedDB where it exists, memory otherwise.
 *
 * Memory means the session works but nothing survives a reload, which the
 * save-failure banner reports — an in-memory write reports success, so the
 * absence of `indexedDB` is what has to raise it.
 */
export function createRecordStore(factory: IDBFactory | undefined = globalThis.indexedDB): {
  store: RecordStore
  durable: boolean
} {
  if (!factory) return { store: new InMemoryRecordStore(), durable: false }
  return { store: new IndexedDbRecordStore(factory), durable: true }
}

export { DB_NAME }
