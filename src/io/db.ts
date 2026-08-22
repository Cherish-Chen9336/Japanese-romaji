/**
 * IndexedDB opener for the `japanese-romaji` database.
 *
 * One object store, keyed by record name, holding the same JSON blobs
 * localStorage used to. Keeping the shape identical is deliberate: the
 * validators in `persistence.ts` are unchanged, and migrating an existing
 * user is a copy rather than a translation.
 *
 * Versioning rule: bump `DB_VERSION` when adding a store or an index. The
 * upgrade callback checks for existence first, so it is safe on a fresh
 * install and on an upgrade alike.
 */

export const DB_NAME = 'japanese-romaji'
export const DB_VERSION = 1
export const RECORDS_STORE = 'records'

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(RECORDS_STORE)) {
    db.createObjectStore(RECORDS_STORE)
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
