// Browser-local quote database: saved quotes and per-item unit price
// overrides. IndexedDB when available, in-memory otherwise (private mode).
const NAME = 'cortex-interior', VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('quotes')) db.createObjectStore('quotes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains('prices')) db.createObjectStore('prices', { keyPath: 'code' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('IndexedDB open failed'));
  });
}
const done = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

export function createQuoteStore() {
  let dbPromise = null, memory = null;
  const db = () => (dbPromise ??= openDatabase().catch(error => { memory = { quotes: new Map(), prices: new Map() }; console.warn('Quote store falls back to memory:', error.message); return null; }));
  async function tx(store, mode, work) {
    const database = await db();
    if (!database) return work(null, memory[store]);
    const t = database.transaction(store, mode), result = await work(t.objectStore(store), null);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
    return result;
  }
  return {
    get persistent() { return memory === null; },
    async listQuotes(scope = null) {
      const all = await tx('quotes', 'readonly', (store, mem) => mem ? [...mem.values()] : done(store.getAll()));
      return all.filter(q => !scope || q.scope === scope).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    getQuote: id => tx('quotes', 'readonly', (store, mem) => mem ? mem.get(id) ?? null : done(store.get(id))),
    async saveQuote(quote) { await tx('quotes', 'readwrite', (store, mem) => mem ? mem.set(quote.id, structuredClone(quote)) : done(store.put(quote))); return quote; },
    deleteQuote: id => tx('quotes', 'readwrite', (store, mem) => mem ? mem.delete(id) : done(store.delete(id))),
    async priceOverrides() {
      const rows = await tx('prices', 'readonly', (store, mem) => mem ? [...mem.values()] : done(store.getAll()));
      return new Map(rows.map(r => [r.code, r]));
    },
    setPrice: (code, values) => tx('prices', 'readwrite', (store, mem) => { const row = { code, ...values, updatedAt: new Date().toISOString() }; return mem ? mem.set(code, row) : done(store.put(row)); }),
    resetPrice: code => tx('prices', 'readwrite', (store, mem) => mem ? mem.delete(code) : done(store.delete(code))),
    resetAllPrices: () => tx('prices', 'readwrite', (store, mem) => mem ? mem.clear() : done(store.clear())),
  };
}

export function quoteNumber(date = new Date(), serial = Math.floor(Math.random() * 9000) + 1000) {
  const pad = n => String(n).padStart(2, '0');
  return `Q-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${serial}`;
}
