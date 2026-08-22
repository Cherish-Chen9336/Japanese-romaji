// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
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
      await store.write('runs', [{ wpm: 40 }])
      expect(await store.readAll()).toEqual({ runs: [{ wpm: 40 }] })
    })

    it('reads every record in one pass', async () => {
      await store.write('runs', [1])
      await store.write('library', [2])
      await store.write('lifetime', { bestWpm: 3 })
      await store.write('misses', { a: 4 })
      await store.write('confusions', { 'a → b': 5 })
      expect(await store.readAll()).toEqual({
        runs: [1],
        library: [2],
        lifetime: { bestWpm: 3 },
        misses: { a: 4 },
        confusions: { 'a → b': 5 },
      })
    })

    it('overwrites a record rather than appending', async () => {
      await store.write('runs', [1, 2, 3])
      await store.write('runs', [4])
      expect((await store.readAll()).runs).toEqual([4])
    })

    it('omits records never written instead of returning undefined values', async () => {
      await store.write('runs', [1])
      expect(Object.keys(await store.readAll())).toEqual(['runs'])
    })

    it('clears everything', async () => {
      await store.write('runs', [1])
      await store.write('library', [2])
      await store.clear()
      expect(await store.readAll()).toEqual({})
    })

    // localStorage caps out well before this; the whole point of moving is that
    // history no longer has to be truncated to fit.
    it('holds far more history than the old 100-run cap', async () => {
      const runs = Array.from({ length: 5000 }, (_, i) => ({ wpm: i, date: `run-${i}` }))
      await store.write('runs', runs)
      expect((await store.readAll()).runs).toHaveLength(5000)
    })

    it('does not hand back a live reference into the store', async () => {
      const runs = [{ wpm: 1 }]
      await store.write('runs', runs)
      runs[0].wpm = 999
      expect((await store.readAll()).runs).toEqual([{ wpm: 1 }])
    })
  })
}

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
    await store.write('runs', [1])
    await store.readAll()
    await store.readAll()
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
    await store.write('runs', [1])
    expect((await store.readAll()).runs).toEqual([1])
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
