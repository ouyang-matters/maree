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

/** A photo waiting in the inbox (sent from the phone, a watched folder or added here). */
export interface InboxItem {
  id: string;
  fileName: string;
  kind: "question" | "answer" | "unknown";
  problemId: string | null;
  note: string;
  origin: "phone" | "folder" | "desktop";
  originalName: string;
  /** Milliseconds since the Unix epoch. */
  receivedAt: number;
  size: number;
  hash: string;
}

export interface PhoneLinkStatus {
  port: number;
  /** Addresses the phone can open, most likely first (each includes the pairing key). */
  urls: string[];
}

export interface ClipboardImage {
  name: string;
  bytes: Uint8Array;
}

/** The local-network link to the phone and the photo inbox (desktop; a stand-in in the browser). */
export interface PhoneBridge {
  start(key: string, port: number): Promise<PhoneLinkStatus>;
  stop(): Promise<void>;
  status(): Promise<PhoneLinkStatus | null>;
  setContext(json: string): Promise<void>;
  list(): Promise<InboxItem[]>;
  read(id: string): Promise<Uint8Array>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  add(name: string, bytes: Uint8Array, kind: InboxItem["kind"], problemId?: string | null): Promise<InboxItem>;
  collectFolder(folder: string): Promise<{ added: number; skippedHeic: number }>;
  onChanged(cb: () => void): () => void;
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
  inbox: PhoneBridge;
  /** Puts images on the clipboard as separate files (pasted as separate attachments), plus a combined picture. */
  copyImages(files: ClipboardImage[], combined: { png: Uint8Array; bmp: Uint8Array | null } | null): Promise<void>;
  pickFolder?(title: string): Promise<string | null>;
  onFileDrop(onDrop: (files: PickedFile[]) => void, onHover: (over: boolean) => void): () => void;
}
