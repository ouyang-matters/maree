// Desktop platform: SQLite and the file system through the Rust backend.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { SqlDriver, SqlParam, Statement } from "../data/driver";
import type { AppInfo, BackupContents, ClipboardImage, InboxItem, PhoneBridge, PickedFile, Platform, StoredFileInfo } from "./types";
import { html5FileDrop } from "./dom-drop";

const driver: SqlDriver = {
  name: "sqlite (tauri)",
  select: (sql, params) => invoke("db_select", { sql, params: params ?? [] }),
  execute: (sql, params) => invoke("db_execute", { sql, params: params ?? [] }),
  async batch(statements: Statement[]) {
    await invoke("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: (s.params ?? []) as SqlParam[] })) });
  },
  snapshot: (label: string) => invoke<string>("db_snapshot", { label }),
};

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

async function filesFromPaths(paths: string[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const path of paths) {
    const info = await invoke<{ name: string; size: number; exists: boolean }>("file_info", { path });
    if (!info.exists) continue;
    out.push({
      name: info.name || baseName(path),
      path,
      size: info.size,
      read: async () => new Uint8Array(await invoke<ArrayBuffer>("read_external_file", { path })),
    });
  }
  return out;
}

async function write(path: string, data: string | Uint8Array): Promise<void> {
  if (typeof data === "string") await invoke("write_text_file", { path, contents: data });
  else await invoke("write_binary_file", data, { headers: { "x-path": encodeURIComponent(path) } });
}

const inbox: PhoneBridge = {
  start: (token, port) => invoke("phone_start", { token, port }),
  stop: () => invoke("phone_stop"),
  status: () => invoke("phone_status"),
  setContext: (json) => invoke("phone_set_context", { json }),
  list: () => invoke<InboxItem[]>("inbox_list"),
  read: async (id) => new Uint8Array(await invoke<ArrayBuffer>("inbox_read", { id })),
  archive: (id) => invoke("inbox_archive", { id }),
  restore: (id) => invoke("inbox_restore", { id }),
  add: (name, bytes, kind, problemId) =>
    invoke<InboxItem>("inbox_add", bytes, {
      headers: { "x-name": encodeURIComponent(name), "x-kind": kind, "x-problem": encodeURIComponent(problemId ?? "") },
    }),
  collectFolder: (folder) => invoke("inbox_collect_folder", { folder }),
  onChanged(cb) {
    let off: (() => void) | null = null;
    let cancelled = false;
    void listen("inbox-changed", () => cb()).then((u) => (cancelled ? u() : (off = u)));
    return () => {
      cancelled = true;
      off?.();
    };
  },
};

async function copyImages(files: ClipboardImage[], combined: { png: Uint8Array; bmp: Uint8Array | null } | null): Promise<void> {
  const parts: { name: string; len: number; role: string; bytes: Uint8Array }[] = files.map((f) => ({ name: f.name, len: f.bytes.length, role: "file", bytes: f.bytes }));
  if (combined) {
    parts.push({ name: "combined.png", len: combined.png.length, role: "png", bytes: combined.png });
    if (combined.bmp) parts.push({ name: "combined.bmp", len: combined.bmp.length, role: "bmp", bytes: combined.bmp });
  }
  const body = new Uint8Array(parts.reduce((n, p) => n + p.len, 0));
  let at = 0;
  for (const p of parts) {
    body.set(p.bytes, at);
    at += p.len;
  }
  const manifest = JSON.stringify(parts.map(({ name, len, role }) => ({ name, len, role })));
  await invoke("clipboard_copy_images", body, { headers: { "x-manifest": encodeURIComponent(manifest) } });
}

export function createTauriPlatform(): Platform {
  const win = getCurrentWindow();
  let info: AppInfo | null = null;
  return {
    kind: "tauri",
    db: driver,
    async info() {
      if (!info) info = { kind: "tauri", ...(await invoke<Omit<AppInfo, "kind">>("app_info")) };
      return info;
    },
    async pickFiles({ multiple, filters, title }) {
      const res = await openDialog({ multiple, filters, title, directory: false });
      if (!res) return [];
      return filesFromPaths(Array.isArray(res) ? res : [res]);
    },
    readPaths: filesFromPaths,
    inbox,
    copyImages,
    async pickFolder(title) {
      const res = await openDialog({ directory: true, multiple: false, title });
      return typeof res === "string" ? res : null;
    },
    async storeFile(kind, name, bytes, path): Promise<StoredFileInfo> {
      if (path) return invoke("store_file_from_path", { path, kind });
      return invoke("store_file_bytes", bytes ?? new Uint8Array(), {
        headers: { "x-kind": kind, "x-name": encodeURIComponent(name) },
      });
    },
    async readStored(storedPath) {
      return new Uint8Array(await invoke<ArrayBuffer>("read_stored_file", { storedPath }));
    },
    async saveFile({ defaultName, filters, data }) {
      const path = await saveDialog({ defaultPath: defaultName, filters });
      if (!path) return null;
      await write(path, data);
      return path;
    },
    writeFile: write,
    async saveBackup(defaultName, libraryJson) {
      const path = await saveDialog({ defaultPath: defaultName, filters: [{ name: "Marée backup", extensions: ["zip"] }] });
      if (!path) return null;
      await invoke("create_backup_archive", { dest: path, libraryJson });
      return path;
    },
    async writeBackup(path, libraryJson) {
      await invoke("create_backup_archive", { dest: path, libraryJson });
    },
    async pickBackup() {
      const res = await openDialog({ multiple: false, filters: [{ name: "Marée backup", extensions: ["zip"] }] });
      if (!res || Array.isArray(res)) return null;
      const contents = await invoke<BackupContents>("read_backup_archive", { path: res });
      return { name: baseName(res), contents };
    },
    async openStored(storedPath) {
      await openPath(await invoke<string>("stored_file_path", { storedPath }));
    },
    async revealStored(storedPath) {
      await revealItemInDir(await invoke<string>("stored_file_path", { storedPath }));
    },
    async openDataFolder() {
      const i = await this.info();
      await openPath(i.dataDir);
    },
    async openUrl(url) {
      await openUrl(url);
    },
    window: {
      minimize: () => void win.minimize(),
      toggleMaximize: () => void win.toggleMaximize(),
      close: () => void win.close(),
      isMaximized: () => win.isMaximized(),
      onResized(cb) {
        let un: (() => void) | null = null;
        let cancelled = false;
        void win.onResized(cb).then((f) => (cancelled ? f() : (un = f)));
        return () => {
          cancelled = true;
          un?.();
        };
      },
      setTitle: (t) => void win.setTitle(t),
      show: async () => {
        await win.show();
        await win.setFocus();
      },
      onCloseRequested(beforeClose) {
        void win.onCloseRequested(async () => {
          try {
            await beforeClose();
          } catch (e) {
            console.error("flush before close failed", e);
          }
        });
      },
    },
    onFileDrop: html5FileDrop,
  };
}
