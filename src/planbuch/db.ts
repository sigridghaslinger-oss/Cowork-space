import { load, type Store } from "@tauri-apps/plugin-store";

// Lokaler Speicher für das Planbuch. Das Planbuch wurde als Claude-Artifact gebaut und
// spricht eine kleine Datenbank an (doc/collection/onSnapshot). Diese Datei bildet genau
// diesen Teil nach und legt alles in planbuch.json im App-Ordner des Macs ab.

type Data = Record<string, unknown>;
type DocSnap = { id: string; exists: boolean; data: () => Data | undefined };
type QuerySnap = { docs: DocSnap[] };
type Filter = { field: string; op: string; value: unknown };
type Listener = { matches: (path: string) => boolean; fire: () => void; timer?: number };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const isObj = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x);

function merge(target: Data, patch: Data): Data {
  const out: Data = { ...target };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Data, v) : v;
  return out;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  const x = a as string | number;
  const y = b as string | number;
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return x < y;
    case "<=": return x <= y;
    case ">": return x > y;
    case ">=": return x >= y;
    default: throw Object.assign(new Error(`Unbekannter Vergleich ${op}`), { code: "invalid_argument" });
  }
}

const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const inCollection = (path: string, name: string) => path.startsWith(name + "/") && !path.slice(name.length + 1).includes("/");

export class PlanbuchDb {
  private docs = new Map<string, Data>();
  private listeners = new Set<Listener>();

  constructor(private store: Store) {}

  static async open(): Promise<PlanbuchDb> {
    const store = await load("planbuch.json", { autoSave: 500, defaults: {} });
    const db = new PlanbuchDb(store);
    for (const [path, value] of await store.entries<Data>()) db.docs.set(path, value);
    return db;
  }

  /** Alle Dokumente einer Sammlung, z. B. für die Klassenbuch-Woche. */
  all(name: string): { id: string; data: Data }[] {
    return [...this.docs].filter(([p]) => inCollection(p, name)).map(([p, d]) => ({ id: idOf(p), data: clone(d) }));
  }

  get(path: string): Data | undefined {
    const d = this.docs.get(path);
    return d && clone(d);
  }

  private snap(path: string): DocSnap {
    const d = this.docs.get(path);
    return { id: idOf(path), exists: !!d, data: () => (d ? clone(d) : undefined) };
  }

  private async write(path: string, value: Data | null) {
    if (value) {
      this.docs.set(path, value);
      await this.store.set(path, value);
    } else {
      this.docs.delete(path);
      await this.store.delete(path);
    }
    // Viele Änderungen kurz hintereinander (z. B. beim Einspielen) lösen nur ein Neuzeichnen aus.
    for (const l of this.listeners) {
      if (!l.matches(path) || l.timer !== undefined) continue;
      l.timer = window.setTimeout(() => {
        l.timer = undefined;
        if (this.listeners.has(l)) l.fire();
      }, 30);
    }
  }

  private listen(matches: (p: string) => boolean, fire: () => void) {
    const l: Listener = { matches, fire };
    this.listeners.add(l);
    queueMicrotask(() => this.listeners.has(l) && fire());
    return () => {
      this.listeners.delete(l);
      if (l.timer !== undefined) clearTimeout(l.timer);
    };
  }

  doc(path: string) {
    return {
      get: async () => this.snap(path),
      set: async (data: Data) => this.write(path, clone(data)),
      update: async (data: Data) => this.write(path, merge(this.docs.get(path) ?? {}, clone(data))),
      delete: async () => this.write(path, null),
      onSnapshot: (cb: (s: DocSnap) => void) => this.listen((p) => p === path, () => cb(this.snap(path))),
    };
  }

  collection(name: string) {
    return this.query(name, [], null, Infinity);
  }

  private query(name: string, filters: Filter[], order: { field: string; dir: string } | null, max: number) {
    const run = (): QuerySnap => {
      let rows = [...this.docs].filter(
        ([p, d]) => inCollection(p, name) && filters.every((f) => compare(d[f.field], f.op, f.value)),
      );
      if (order) {
        const sign = order.dir === "desc" ? -1 : 1;
        rows.sort(([, a], [, b]) => {
          const x = a[order.field] as string;
          const y = b[order.field] as string;
          return x === y ? 0 : x < y ? -sign : sign;
        });
      }
      rows = rows.slice(0, max);
      return { docs: rows.map(([p]) => this.snap(p)) };
    };
    return {
      where: (field: string, op: string, value: unknown) => this.query(name, [...filters, { field, op, value }], order, max),
      orderBy: (field: string, dir = "asc") => this.query(name, filters, { field, dir }, max),
      limit: (n: number) => this.query(name, filters, order, n),
      get: async () => run(),
      onSnapshot: (cb: (s: QuerySnap) => void) => this.listen((p) => inCollection(p, name), () => cb(run())),
    };
  }
}

let opening: Promise<PlanbuchDb> | null = null;
export const openPlanbuch = () => (opening ??= PlanbuchDb.open());
