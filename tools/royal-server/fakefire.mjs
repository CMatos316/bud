// a pretend Firestore, just enough for lib/royal.js
export const store = new Map();   // path -> data
let n = 0;
const clone = (v) => (Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' && !v.toMillis ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
class Snap { constructor(ref, d) { this.ref = ref; this.id = ref.id; this._d = d; this.exists = d !== undefined; } data() { return clone(this._d); } get(k) { return this._d?.[k]; } }
class Doc {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new Col(`${this.path}/${name}`); }
  async get() { return new Snap(this, store.get(this.path)); }
  async set(d, o) { store.set(this.path, o?.merge ? { ...(store.get(this.path) || {}), ...clone(d) } : clone(d)); }
  async update(d) { if (!store.has(this.path)) throw new Error('no doc'); store.set(this.path, { ...store.get(this.path), ...clone(d) }); }
}
class Query {
  constructor(path, filters = [], lim = 1e9) { this.path = path; this.filters = filters; this.lim = lim; }
  where(k, op, v) { return new Query(this.path, [...this.filters, [k, v]], this.lim); }
  select() { return this; } limit(l) { return new Query(this.path, this.filters, l); }
  async get() { const docs = []; for (const [p, d] of store) { if (!p.startsWith(this.path + '/') || p.slice(this.path.length + 1).includes('/')) continue; if (this.filters.every(([k, v]) => d[k] === v)) docs.push(new Snap(new Doc(p), d)); } return { docs: docs.slice(0, this.lim) }; }
}
class Col extends Query { doc(id) { return new Doc(`${this.path}/${id || 'auto' + String(++n).padStart(12, '0')}`); } }
const root = { collection: (name) => new Col(name), async runTransaction(fn) { const tx = { get: (ref) => ref.get(), set: (ref, d, o) => { ref.set(d, o); }, update: (ref, d) => { ref.update(d); } }; return fn(tx); } };
export const db = () => root;
export const refs = { user: (id) => new Doc(`guilds/G/users/${id}`) };
export const Timestamp = { now: () => ({ ms: Date.now(), toMillis() { return this.ms; } }) };
export const adminAuth = async () => ({ createCustomToken: async (uid, claims) => `token:${uid}:${JSON.stringify(claims)}` });
export const projectId = () => 'test';
export const FieldValue = { delete: () => undefined, increment: (n) => n, serverTimestamp: () => Date.now() };
