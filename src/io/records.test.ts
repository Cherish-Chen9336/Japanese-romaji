// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { DB_NAME, RECORDS_STORE, RUNS_STORE } from './db'
import {
  IndexedDbRecordStore,
  InMemoryRecordStore,
  createRecordStore,
  type RecordStore,
} from './records'

/** A fresh database per test — fake-indexeddb keys off the factory instance. */
function idbStore(): IndexedDbRecordStore {
  return new IndexedDbRecordStore(new IDBFactory())
}

/** Both implementations must behave identically; the fallback is not a stub. */
const backends: [string, () => RecordStore][] = [
  ['IndexedDbRecordStore', idbStore],
  ['InMemoryRecordStore', () => new InMemoryRecordStore()],
]

for (const [name, make] of backends) {
  describe(name, () => {
    let store: RecordStore
    beforeEach(() => {
      store = make()
    })

    it('starts empty', async () => {
      expect(await store.readAll()).toEqual({})
    })

    it('round-trips a record', async () => {
      await store.write('lifetime', { bestWpm: 40 })
      expect(await store.readAll()).toEqual({ lifetime: { bestWpm: 40 } })
    })

    it('reads every record in one pass', async () => {
      await store.write('library', [2])
      await store.write('lifetime', { bestWpm: 3 })
      await store.write('misses', { a: 4 })
      await store.write('confusions', { 'a → b': 5 })
      expect(await store.readAll()).toEqual({
        library: [2],
        lifetime: { bestWpm: 3 },
        misses: { a: 4 },
        confusions: { 'a → b': 5 },
      })
    })

    it('overwrites a record rather than appending', async () => {
      await store.write('library', [1, 2, 3])
      await store.write('library', [4])
      expect((await store.readAll()).library).toEqual([4])
    })

    it('omits records never written instead of returning undefined values', async () => {
      await store.write('library', [1])
      expect(Object.keys(await store.readAll())).toEqual(['library'])
    })

    it('clears everything, records and runs alike', async () => {
      await store.write('library', [2])
      await store.appendRun({ wpm: 1 })
      await store.clear()
      expect(await store.readAll()).toEqual({})
      expect(await store.readRuns()).toEqual([])
    })

    it('does not hand back a live reference into the store', async () => {
      const library = [{ text: 'a' }]
      await store.write('library', library)
      library[0].text = 'mutated'
      expect((await store.readAll()).library).toEqual([{ text: 'a' }])
    })

    describe('run history', () => {
      it('starts with no runs', async () => {
        expect(await store.readRuns()).toEqual([])
      })

      // The app holds and displays history newest-first; the store has to hand
      // it back in that order or "last run" shows the first run ever typed.
      it('returns appended runs newest first', async () => {
        await store.appendRun({ wpm: 1 })
        await store.appendRun({ wpm: 2 })
        await store.appendRun({ wpm: 3 })
        expect(await store.readRuns()).toEqual([{ wpm: 3 }, { wpm: 2 }, { wpm: 1 }])
      })

      it('round-trips replaceRuns through readRuns in the same order', async () => {
        await store.replaceRuns([{ wpm: 3 }, { wpm: 2 }, { wpm: 1 }])
        expect(await store.readRuns()).toEqual([{ wpm: 3 }, { wpm: 2 }, { wpm: 1 }])
      })

      it('keeps appends newest-first after a replace', async () => {
        await store.replaceRuns([{ wpm: 2 }, { wpm: 1 }])
        await store.appendRun({ wpm: 3 })
        expect(await store.readRuns()).toEqual([{ wpm: 3 }, { wpm: 2 }, { wpm: 1 }])
      })

      it('replaces the history rather than merging into it', async () => {
        await store.appendRun({ wpm: 1 })
        await store.replaceRuns([{ wpm: 9 }])
        expect(await store.readRuns()).toEqual([{ wpm: 9 }])
      })

      it('does not hand back a live reference into the run store', async () => {
        const run = { wpm: 1 }
        await store.appendRun(run)
        run.wpm = 999
        expect(await store.readRuns()).toEqual([{ wpm: 1 }])
      })

      // localStorage capped out well before this; the whole point of moving is
      // that history no longer has to be truncated to fit.
      it('holds far more history than the old 100-run cap', async () => {
        for (let i = 0; i < 500; i += 1) await store.appendRun({ wpm: i })
        const runs = await store.readRuns()
        expect(runs).toHaveLength(500)
        expect(runs[0]).toEqual({ wpm: 499 })
      })
    })
  })
}

describe('IndexedDbRecordStore — appending is O(1)', () => {
  /**
   * The regression this guards: history used to be one blob, so saving a run
   * rewrote every run ever typed. An append that quietly degrades into a
   * rewrite would still pass every behavioural test above — only the number of
   * records it writes tells the two apart.
   */
  it('writes exactly one record however long the history is', async () => {
    const store = idbStore()
    for (let i = 0; i < 50; i += 1) await store.appendRun({ wpm: i })

    const proto = IDBObjectStore.prototype
    const realAdd = proto.add
    const realPut = proto.put
    let written = 0
    proto.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === RUNS_STORE) written += 1
      return realAdd.apply(this, args)
    }
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === RUNS_STORE) written += 1
      return realPut.apply(this, args)
    }

    try {
      await store.appendRun({ wpm: 50 })
    } finally {
      proto.add = realAdd
      proto.put = realPut
    }

    expect(written).toBe(1)
    expect(await store.readRuns()).toHaveLength(51)
  })
})

describe('IndexedDbRecordStore — upgrading from the v1 single-blob schema', () => {
  /** Builds the pre-v2 database: one `records` store, history as one blob. */
  async function seedV1(factory: IDBFactory, runs: unknown): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(RECORDS_STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RECORDS_STORE, 'readwrite')
      tx.objectStore(RECORDS_STORE).put(runs, 'runs')
      tx.objectStore(RECORDS_STORE).put([{ text: 'kept' }], 'library')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }

  it('carries an existing history across the upgrade, order intact', async () => {
    const factory = new IDBFactory()
    await seedV1(factory, [{ wpm: 3 }, { wpm: 2 }, { wpm: 1 }])

    const store = new IndexedDbRecordStore(factory)
    expect(await store.readRuns()).toEqual([{ wpm: 3 }, { wpm: 2 }, { wpm: 1 }])
    expect((await store.readAll()).library).toEqual([{ text: 'kept' }])
  })

  /** Reads a key straight out of the records store, past the abstraction. */
  async function rawRecord(factory: IDBFactory, key: string): Promise<unknown> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const value = await new Promise<unknown>((resolve, reject) => {
      const get = db.transaction(RECORDS_STORE, 'readonly').objectStore(RECORDS_STORE).get(key)
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return value
  }

  // Moved, not copied: the blob is the entire history, so leaving it behind
  // doubles what the profile costs on disk forever.
  it('deletes the blob once its contents are in the run store', async () => {
    const factory = new IDBFactory()
    await seedV1(factory, [{ wpm: 1 }])

    const store = new IndexedDbRecordStore(factory)
    await store.readRuns()

    expect(await rawRecord(factory, 'runs')).toBeUndefined()
    expect(await rawRecord(factory, 'library')).toEqual([{ text: 'kept' }])
  })

  it('deletes a stale blob too, instead of carrying it forever', async () => {
    const factory = new IDBFactory()
    await seedV1(factory, [{ wpm: 1 }])

    const store = new IndexedDbRecordStore(factory)
    await store.appendRun({ wpm: 2 })
    await store.readRuns()

    expect(await rawRecord(factory, 'runs')).toBeUndefined()
  })

  it('discards a stale blob rather than merging it into real history', async () => {
    const factory = new IDBFactory()
    await seedV1(factory, [{ wpm: 1 }])

    const store = new IndexedDbRecordStore(factory)
    await store.appendRun({ wpm: 2 })
    expect(await store.readRuns()).toEqual([{ wpm: 2 }])
  })

  it('ignores a blob that is not an array', async () => {
    const factory = new IDBFactory()
    await seedV1(factory, 'not an array')
    expect(await new IndexedDbRecordStore(factory).readRuns()).toEqual([])
  })
})

describe('IndexedDbRecordStore — failed writes', () => {
  /*
   * The save-failure banner is driven entirely by these promises rejecting. A
   * write that fails silently would leave the app claiming a run was saved
   * when it was not — the one thing the banner exists to prevent.
   */
  it('rejects when a run cannot be stored instead of reporting success', async () => {
    const store = idbStore()
    // A function is not structured-cloneable, so the store refuses it.
    await expect(store.appendRun({ wpm: 1, hack: () => 0 })).rejects.toThrow()
    expect(await store.readRuns()).toEqual([])
  })

  it('rejects when a record cannot be stored', async () => {
    const store = idbStore()
    await expect(store.write('library', [{ nope: () => 0 }])).rejects.toThrow()
  })

  it('rejects when the transaction aborts', async () => {
    const store = idbStore()
    await store.appendRun({ wpm: 1 })

    const proto = IDBObjectStore.prototype
    const realAdd = proto.add
    proto.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      const request = realAdd.apply(this, args)
      this.transaction.abort()
      return request
    }
    try {
      await expect(store.appendRun({ wpm: 2 })).rejects.toThrow()
    } finally {
      proto.add = realAdd
    }
    expect(await store.readRuns()).toEqual([{ wpm: 1 }])
  })
})

describe('IndexedDbRecordStore — connection handling', () => {
  it('reuses one connection across calls', async () => {
    const factory = new IDBFactory()
    let opens = 0
    const counted = {
      open: (...args: Parameters<IDBFactory['open']>) => {
        opens += 1
        return factory.open(...args)
      },
    } as IDBFactory
    const store = new IndexedDbRecordStore(counted)
    await store.write('library', [1])
    await store.readAll()
    await store.readRuns()
    expect(opens).toBe(1)
  })

  // A rejection must never be cached: one transient failure to open would
  // otherwise poison every read and write for the rest of the page's life.
  it('retries after a failed open instead of staying broken', async () => {
    const real = new IDBFactory()
    let attempt = 0
    const flaky = {
      open: (...args: Parameters<IDBFactory['open']>) => {
        attempt += 1
        if (attempt === 1) throw new Error('transient open failure')
        return real.open(...args)
      },
    } as IDBFactory

    const store = new IndexedDbRecordStore(flaky)
    await expect(store.readAll()).rejects.toThrow('transient open failure')
    await store.write('library', [1])
    expect((await store.readAll()).library).toEqual([1])
  })
})

describe('createRecordStore', () => {
  it('uses IndexedDB when the browser has it', () => {
    const { store, durable } = createRecordStore(new IDBFactory())
    expect(store).toBeInstanceOf(IndexedDbRecordStore)
    expect(durable).toBe(true)
  })

  // Private browsing in some browsers, or a locked-down embed.
  it('falls back to memory when it does not, and says so', () => {
    const { store, durable } = createRecordStore(undefined)
    expect(store).toBeInstanceOf(InMemoryRecordStore)
    expect(durable).toBe(false)
  })
})

describe('commitRun', () => {
  /*
   * The run and the total it feeds have to land together. As two writes, a
   * crash between them left the profile disagreeing with itself, and nothing
   * afterwards says which half was the truth.
   */
  it('stores the run and the lifetime aggregate together', async () => {
    const store = new InMemoryRecordStore()
    await store.commitRun({ wpm: 40 }, { bestWpm: 40, totalSessions: 1 })
    expect(await store.readRuns()).toEqual([{ wpm: 40 }])
    expect((await store.readAll()).lifetime).toEqual({ bestWpm: 40, totalSessions: 1 })
  })

  it('keeps runs newest-first, as the app holds them', async () => {
    const store = new InMemoryRecordStore()
    await store.commitRun({ wpm: 30 }, { bestWpm: 30 })
    await store.commitRun({ wpm: 50 }, { bestWpm: 50 })
    expect(await store.readRuns()).toEqual([{ wpm: 50 }, { wpm: 30 }])
  })

  it('does not let a caller hold a live reference into the store', async () => {
    const store = new InMemoryRecordStore()
    const lifetime = { bestWpm: 40 }
    await store.commitRun({ wpm: 40 }, lifetime)
    lifetime.bestWpm = 999
    expect((await store.readAll()).lifetime).toEqual({ bestWpm: 40 })
  })
})
