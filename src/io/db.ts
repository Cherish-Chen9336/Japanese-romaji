/**
 * IndexedDB schema for `japanese-romaji`.
 *
 * Two stores, split by how they grow. `records` holds the small blobs — the
 * library, lifetime aggregates, the miss and confusion tables — each written
 * whole because each stays small. `runs` holds one record per completed run,
 * because history does not stay small: kept as a single blob, finishing a run
 * rewrote the entire history through structured clone, which measured 197 ms at
 * five thousand runs and 926 ms at twenty thousand, and grows without bound.
 * Appending to a keyed store measured 0.3–1 ms at every one of those sizes.
 *
 * Versioning rule: bump `DB_VERSION` when adding a store or an index. The
 * upgrade callback checks for existence first, so it is safe on a fresh install
 * and on an upgrade alike.
 */

export const DB_NAME = 'japanese-romaji'
export const DB_VERSION = 2
export const RECORDS_STORE = 'records'
export const RUNS_STORE = 'runs'

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(RECORDS_STORE)) {
    db.createObjectStore(RECORDS_STORE)
  }
  // autoIncrement gives each run a monotonically rising key, so `getAll` comes
  // back oldest-first and an append never has to read what is already there.
  if (!db.objectStoreNames.contains(RUNS_STORE)) {
    db.createObjectStore(RUNS_STORE, { autoIncrement: true })
  }
}

export function openDb(factory: IDBFactory): IDBOpenDBRequest {
  const request = factory.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => upgrade(request.result)
  return request
}

/**
 * Promise wrapper for one IDBRequest.
 *
 * IDB caveat: a transaction stays alive only while requests keep being issued
 * against it without a microtask boundary in between. Issue every request on a
 * transaction synchronously, *then* await them — awaiting one before issuing
 * the next lets the transaction auto-close underneath you.
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * Resolves when a write transaction commits, rejecting if it errors or aborts.
 *
 * Rejecting is what raises the save-failure banner. A write that failed quietly
 * would leave the app reporting a run as saved when it was not.
 */
export function settle(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB ${what} failed`))
    tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB ${what} aborted`))
  })
}
