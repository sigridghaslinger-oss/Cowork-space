import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";

// Cowork Space läuft als Mac-App (Tauri) oder als Web-App im Browser, z. B. auf dem iPad.
// Nur die Mac-App kommt an Mail, Kalender und Erinnerungen heran.
export const isMac = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Kleiner Schlüssel-Wert-Speicher: am Mac eine Datei im App-Ordner, im Browser IndexedDB. */
export type KeyValueStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  entries<T>(): Promise<[string, T][]>;
  /** Ersetzt den ganzen Inhalt, z. B. beim Laden einer Sicherung. */
  replace(data: Record<string, unknown>): Promise<void>;
};

const opened = new Map<string, Promise<KeyValueStore>>();

export function openStore(name: string): Promise<KeyValueStore> {
  let store = opened.get(name);
  if (!store) {
    store = isMac ? openMacStore(name) : openBrowserStore(name);
    opened.set(name, store);
  }
  return store;
}

async function openMacStore(name: string): Promise<KeyValueStore> {
  const store = await load(name, { autoSave: 500, defaults: {} });
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: async (key) => void (await store.delete(key)),
    entries: () => store.entries(),
    async replace(data) {
      await store.clear();
      for (const [k, v] of Object.entries(data)) await store.set(k, v);
      await store.save();
    },
  };
}

// Im Browser liegt jede Datei als eigener Bereich in einer IndexedDB-Datenbank.
// Alles wird beim Öffnen in den Speicher gelesen, Schreiben geht direkt durch.
let idb: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!idb) {
    idb = new Promise((resolve, reject) => {
      const req = indexedDB.open("cowork-space", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Safari soll die Daten nicht nach ein paar Wochen ohne Besuch wegräumen.
    navigator.storage?.persist?.().catch(() => {});
  }
  return idb;
}

function tx(db: IDBDatabase, run: (s: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction("kv", "readwrite");
    run(t.objectStore("kv"));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function openBrowserStore(name: string): Promise<KeyValueStore> {
  const db = await database();
  const prefix = name + "\u0000";
  const cache = new Map<string, unknown>();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").openCursor(IDBKeyRange.bound(prefix, prefix + "￿"));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      cache.set((cur.key as string).slice(prefix.length), cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return {
    get: async <T,>(key: string) => cache.get(key) as T | undefined,
    async set(key, value) {
      cache.set(key, value);
      await tx(db, (s) => s.put(value, prefix + key));
    },
    async delete(key) {
      cache.delete(key);
      await tx(db, (s) => s.delete(prefix + key));
    },
    entries: async <T,>() => [...cache] as [string, T][],
    async replace(data) {
      await tx(db, (s) => {
        s.delete(IDBKeyRange.bound(prefix, prefix + "￿"));
        for (const [k, v] of Object.entries(data)) s.put(v, prefix + k);
      });
      cache.clear();
      for (const [k, v] of Object.entries(data)) cache.set(k, v);
    },
  };
}

export async function openLink(url: string): Promise<void> {
  if (isMac) await openUrl(url);
  else window.open(url, "_blank", "noopener");
}

/** Speichert eine Datei: am Mac im Ordner „Downloads“, im Browser als normaler Download. */
export async function saveFile(filename: string, data: string, type = "application/octet-stream"): Promise<string> {
  if (isMac) return invoke<string>("save_download", { filename, data });
  const url = URL.createObjectURL(new Blob([data], { type: filename.endsWith(".html") ? "text/html" : type }));
  // Ausdrucke öffnen sich in einem neuen Tab, damit man sie gleich drucken kann.
  if (filename.endsWith(".html")) {
    window.open(url, "_blank");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}
