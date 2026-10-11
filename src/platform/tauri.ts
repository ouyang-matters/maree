// Desktop platform: SQLite and the file system through the Rust backend.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { SqlDriver, SqlParam, Statement } from "../data/driver";
import type { AppInfo, BackupContents, PickedFile, Platform, StoredFileInfo } from "./types";
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
