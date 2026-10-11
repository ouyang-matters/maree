import type { SqlDriver } from "../data/driver";

export interface PickedFile {
  name: string;
  /** Absolute path (desktop) or null (browser). */
  path: string | null;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface StoredFileInfo {
  storedPath: string;
  hash: string;
  size: number;
}

export interface AppInfo {
  kind: "tauri" | "web";
  version: string;
  dataDir: string;
  dbPath: string;
  filesDir: string;
  backupsDir: string;
  portable: boolean;
  e2e: boolean;
  lastSnapshot: string | null;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface BackupContents {
  libraryJson: string;
  filesRestored: number;
  filesSkipped: number;
}

export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onResized(cb: () => void): () => void;
  setTitle(title: string): void;
  show(): Promise<void>;
  /** Runs `beforeClose` (e.g. flushing unsaved edits) before the window closes. */
  onCloseRequested(beforeClose: () => Promise<void>): void;
}

export interface Platform {
  kind: "tauri" | "web";
  db: SqlDriver;
  info(): Promise<AppInfo>;
  pickFiles(opts: { multiple: boolean; filters?: FileFilter[]; title?: string }): Promise<PickedFile[]>;
  storeFile(kind: "sources" | "attachments", name: string, bytes: Uint8Array | null, path: string | null): Promise<StoredFileInfo>;
  readStored(storedPath: string): Promise<Uint8Array>;
  /** Saves text or bytes through a save dialog. Returns the chosen path/name, or null if cancelled. */
  saveFile(opts: { defaultName: string; filters: FileFilter[]; data: string | Uint8Array }): Promise<string | null>;
  /** Writes directly to a path (desktop only; used by automated tests). */
  writeFile?(path: string, data: string | Uint8Array): Promise<void>;
  saveBackup(defaultName: string, libraryJson: string): Promise<string | null>;
  writeBackup?(path: string, libraryJson: string): Promise<void>;
  pickBackup(): Promise<{ name: string; contents: BackupContents } | null>;
  readPaths?(paths: string[]): Promise<PickedFile[]>;
  openStored(storedPath: string): Promise<void>;
  revealStored(storedPath: string): Promise<void>;
  openDataFolder(): Promise<void>;
  openUrl(url: string): Promise<void>;
  window: WindowControls;
  onFileDrop(onDrop: (files: PickedFile[]) => void, onHover: (over: boolean) => void): () => void;
}
