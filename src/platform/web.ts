// Browser fallback used for development previews and demos: SQLite compiled to
// WebAssembly (sql.js), persisted in IndexedDB. The desktop app never uses this.

import type { Database, SqlJsStatic } from "sql.js";
import JSZip from "jszip";
import type { SqlDriver, SqlParam, Statement } from "../data/driver";
import type { AppInfo, InboxItem, PhoneBridge, Platform } from "./types";
import { fileFromDom, html5FileDrop } from "./dom-drop";

const DB_NAME = "maree";
const STORE = "kv";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ext(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function bind(params: SqlParam[] = []) {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
}

class SqlJsDriver implements SqlDriver {
  readonly name = "sql.js (browser)";
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private db: Database) {}

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persist(), 300);
  }

  async persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await idbPut("db", this.db.export());
  }

  async select<T>(sql: string, params?: SqlParam[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(bind(params));
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  async execute(sql: string, params?: SqlParam[]) {
    this.db.run(sql, bind(params));
    this.scheduleSave();
    return { changes: this.db.getRowsModified() };
  }

  async batch(statements: Statement[]) {
    this.db.run("BEGIN");
    try {
      for (const s of statements) this.db.run(s.sql, bind(s.params));
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    this.scheduleSave();
  }

  async snapshot(label: string) {
    await idbPut(`snapshot:${label}`, this.db.export());
    return `browser storage (${label})`;
  }
}

function pickViaInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}


function download(name: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function createWebPlatform(): Promise<Platform> {
  const [sqlModule, { default: wasmUrl }] = await Promise.all([import("sql.js"), import("sql.js/dist/sql-wasm.wasm?url")]);
  // sql.js is CommonJS; depending on bundling the init function is the default export or the module itself.
  const initSqlJs = ((sqlModule as unknown as { default?: unknown }).default ?? sqlModule) as (cfg: object) => Promise<SqlJsStatic>;
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await idbGet<Uint8Array>("db");
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  const driver = new SqlJsDriver(db);
  window.addEventListener("beforeunload", () => void driver.persist());

  const info: AppInfo = {
    kind: "web",
    version: "1.0.0",
    dataDir: "Browser storage (IndexedDB)",
    dbPath: "IndexedDB › maree › db",
    filesDir: "IndexedDB",
    backupsDir: "Downloads",
    portable: false,
    e2e: false,
    lastSnapshot: null,
  };

  const platform: Platform = {
    kind: "web",
    db: driver,
    info: async () => info,
    async pickFiles({ multiple, filters }) {
      const accept = (filters ?? []).flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
      return (await pickViaInput(accept, multiple)).map(fileFromDom);
    },
    async storeFile(kind, name, bytes) {
      const data = bytes ?? new Uint8Array();
      const hash = await sha256(data);
      const e = ext(name);
      const storedPath = `${kind}/${hash.slice(0, 2)}/${hash}${e ? `.${e}` : ""}`;
      if (!(await idbGet(`file:${storedPath}`))) await idbPut(`file:${storedPath}`, data);
      return { storedPath, hash, size: data.length };
    },
    async readStored(storedPath) {
      const v = await idbGet<Uint8Array>(`file:${storedPath}`);
      if (!v) throw new Error(`Stored file missing: ${storedPath}`);
      return v;
    },
    async saveFile({ defaultName, data }) {
      const mime = defaultName.endsWith(".json") ? "application/json" : defaultName.endsWith(".zip") ? "application/zip" : "text/plain";
      download(defaultName, data, mime);
      return defaultName;
    },
    async saveBackup(defaultName, libraryJson) {
      const zip = new JSZip();
      zip.file("library.json", libraryJson);
      const lib = JSON.parse(libraryJson) as { sources: { storedPath: string | null }[]; problems: { attachments: { storedPath: string }[] }[] };
      const paths = [
        ...lib.sources.map((s) => s.storedPath).filter(Boolean),
        ...lib.problems.flatMap((p) => p.attachments.map((a) => a.storedPath)),
      ] as string[];
      for (const p of new Set(paths)) {
        const bytes = await idbGet<Uint8Array>(`file:${p}`);
        if (bytes) zip.file(`files/${p}`, bytes);
      }
      download(defaultName, await zip.generateAsync({ type: "uint8array" }), "application/zip");
      return defaultName;
    },
    async pickBackup() {
      const [file] = await pickViaInput(".zip", false);
      if (!file) return null;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const lib = zip.file("library.json");
      if (!lib) throw new Error("This archive does not contain library.json; it is not a Marée backup.");
      let restored = 0;
      let skipped = 0;
      for (const [name, entry] of Object.entries(zip.files)) {
        if (!name.startsWith("files/") || entry.dir) continue;
        const key = `file:${name.slice(6)}`;
        if (await idbGet(key)) skipped++;
        else {
          await idbPut(key, await entry.async("uint8array"));
          restored++;
        }
      }
      return { name: file.name, contents: { libraryJson: await lib.async("string"), filesRestored: restored, filesSkipped: skipped } };
    },
    async openStored(storedPath) {
      const bytes = await this.readStored(storedPath);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      window.open(url, "_blank");
    },
    async revealStored() {
      /* not available in the browser */
    },
    async openDataFolder() {
      /* not available in the browser */
    },
    async openUrl(url) {
      window.open(url, "_blank", "noopener");
    },
    window: {
      minimize() {},
      toggleMaximize() {},
      close() {},
      isMaximized: async () => false,
      onResized: () => () => {},
      setTitle: (t) => {
        document.title = t;
      },
      show: async () => {},
      onCloseRequested(beforeClose) {
        window.addEventListener("pagehide", () => void beforeClose());
      },
    },
    inbox: memoryInbox(),
    async copyImages(_files, combined) {
      // Browsers can only place one image on the clipboard: use the combined picture.
      if (!combined) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([combined.png as BlobPart], { type: "image/png" }) })]);
    },
    onFileDrop: html5FileDrop,
  };
  return platform;
}

/** Browser preview: the inbox lives in memory and there is no phone link. */
function memoryInbox(): PhoneBridge {
  const items = new Map<string, { item: InboxItem; bytes: Uint8Array }>();
  const archived = new Map<string, { item: InboxItem; bytes: Uint8Array }>();
  const listeners = new Set<() => void>();
  let n = 0;
  return {
    start: async () => {
      throw new Error("The phone link needs the desktop app.");
    },
    stop: async () => {},
    status: async () => null,
    setContext: async () => {},
    list: async () => [...items.values()].map((v) => v.item),
    read: async (id) => {
      const v = items.get(id);
      if (!v) throw new Error("This photo is no longer in the inbox.");
      return v.bytes;
    },
    archive: async (id) => {
      const v = items.get(id);
      if (v) archived.set(id, v);
      items.delete(id);
    },
    restore: async (id) => {
      const v = archived.get(id);
      if (v) items.set(id, v);
      archived.delete(id);
    },
    add: async (name, bytes, kind, problemId) => {
      const id = `${Date.now()}-${++n}`;
      const item: InboxItem = { id, fileName: name, kind, problemId: problemId ?? null, note: "", origin: "desktop", originalName: name, receivedAt: Date.now(), size: bytes.length, hash: id };
      items.set(id, { item, bytes });
      listeners.forEach((l) => l());
      return item;
    },
    collectFolder: async () => ({ added: 0, skippedHeic: 0 }),
    onChanged(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
