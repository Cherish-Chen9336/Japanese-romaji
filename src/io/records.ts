import { DB_NAME, RECORDS_STORE, openDb, promisifyRequest } from './db'

/**
 * The records that outgrow localStorage: run history, the user's library, and
 * the derived counters. UI preferences deliberately stay in localStorage — they
 * are tiny, and reading them synchronously is what lets the first paint happen
 * without waiting on a database.
 */
export type RecordName = 'runs' | 'library' | 'lifetime' | 'misses' | 'confusions'

export const RECORD_NAMES: readonly RecordName[] = [
  'runs',
  'library',
  'lifetime',
  'misses',
  'confusions',
]

export interface RecordStore {
  readAll(): Promise<Partial<Record<RecordName, unknown>>>
  write(name: RecordName, value: unknown): Promise<void>
  clear(): Promise<void>
}

/** Fallback when IndexedDB is unavailable, and the store the tests drive. */
export class InMemoryRecordStore implements RecordStore {
  private data = new Map<RecordName, unknown>()

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

  clear(): Promise<void> {
    this.data.clear()
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
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })
  }

  async clear(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(RECORDS_STORE, 'readwrite')
    tx.objectStore(RECORDS_STORE).clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB clear aborted'))
    })
  }
}

/**
 * The store the app runs on: IndexedDB where it exists, memory otherwise.
 *
 * Memory means the session works but nothing survives a reload — which the
 * save-failure banner already tells the user, because every write through the
 * in-memory store still reports success while `indexedDB` being absent is what
 * put us here in the first place.
 */
export function createRecordStore(factory: IDBFactory | undefined = globalThis.indexedDB): {
  store: RecordStore
  durable: boolean
} {
  if (!factory) return { store: new InMemoryRecordStore(), durable: false }
  return { store: new IndexedDbRecordStore(factory), durable: true }
}

export { DB_NAME }
