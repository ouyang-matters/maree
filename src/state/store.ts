// Application state (zustand). Async operations live in ./actions.ts.

import { create } from "zustand";
import type {
  Course,
  FilterSpec,
  Lecture,
  Problem,
  ProblemSummary,
  SavedView,
  SortSpec,
  Source,
  Topic,
} from "../data/types";
import type { LibraryIndex } from "../domain/filters";
import { buildIndex } from "../domain/filters";
import type { AppInfo, InboxItem, PhoneLinkStatus } from "../platform/types";
import type { CommitResult, DocPlan } from "../import/pipeline";
import type { Locale } from "../i18n";
import type { LibraryJson } from "../export/library-json";

export type ThemeId = "maree" | "maree-dark" | "waterloo" | "black-gold" | "system";

export type Tab =
  | { id: string; kind: "problem"; problemId: string; preview?: boolean }
  | { id: string; kind: "source"; sourceId: string; page?: number; nonce?: number }
  | { id: string; kind: "import"; importId: string }
  | { id: string; kind: "progress" }
  | { id: string; kind: "settings" }
  | { id: string; kind: "welcome" }
  | { id: string; kind: "help" }
  | { id: string; kind: "inbox" }
  | { id: string; kind: "tray" };

export interface EditorGroup {
  id: string;
  tabs: Tab[];
  activeId: string | null;
}

export type ListMode = "filter" | "review" | "recent" | "trash";

export interface ListOrigin {
  kind: "all" | "course" | "lecture" | "topic" | "source" | "view" | "custom" | "unassigned" | "import-review";
  id?: string;
  /** Set when the scope is a topic (or source) inside one course. */
  courseId?: string;
  label: string;
}

export type ColumnKey =
  | "number"
  | "title"
  | "course"
  | "lecture"
  | "topic"
  | "difficulty"
  | "status"
  | "category"
  | "priority"
  | "source"
  | "lastAttempt"
  | "reviewDue"
  | "updated";

export const DEFAULT_COLUMNS: ColumnKey[] = ["title", "lecture", "topic", "difficulty", "status", "lastAttempt"];

export interface ImportSession {
  id: string;
  status: "reading" | "review" | "committing" | "done";
  progress: string;
  plans: DocPlan[];
  errors: { name: string; message: string }[];
  activePlan: string | null;
  activeCandidate: string | null;
  result: CommitResult | null;
}

export type DialogSpec =
  | { kind: "course"; courseId?: string }
  | { kind: "lecture"; lectureId?: string; courseId?: string }
  | { kind: "lectures-bulk"; courseId: string }
  | { kind: "topic"; topicId?: string; parentId?: string | null }
  | { kind: "source"; sourceId: string }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
      secondary?: { label: string; run: () => void | Promise<void> };
    }
  | { kind: "export"; problemIds: string[]; title: string }
  | { kind: "save-view"; viewId?: string }
  | { kind: "library-import"; lib: LibraryJson; name: string; filesRestored?: number }
  | { kind: "review-date"; problemIds: string[] }
  | { kind: "delete-course"; courseId: string }
  | { kind: "about" }
  | { kind: "phone" }
  | { kind: "ink"; problemId: string; partId: string | null; edit?: { attachmentId: string; fileName: string } }
  | { kind: "prompt"; title: string; label: string; value: string; allowEmpty?: boolean; onSubmit: (v: string) => unknown };

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

export interface Settings {
  theme: ThemeId;
  locale: Locale;
  katexMacros: Record<string, string>;
  editorFontSize: number;
  proseSize: number;
  editorMode: "split" | "source" | "preview";
  spellcheck: boolean;
  onboardingDone: boolean;
  confirmTrash: boolean;
  /** Serve the phone page on the local network while the app is open. */
  phoneLink: boolean;
  /** Pairing key carried by the QR code; changing it unpairs every phone. */
  phoneKey: string;
  phonePort: number;
  /** Optional folder (e.g. synced by Google Drive) whose new photos are collected into the inbox. */
  inboxFolder: string;
  /** Look for new versions on GitHub Releases. */
  autoUpdate: boolean;
  /** Problems gathered in "To ChatGPT", in order. */
  chatTray: string[];
}

export interface Layout {
  sidebarOpen: boolean;
  listOpen: boolean;
  sidebarWidth: number;
  listWidth: number;
  collapsed: Record<string, boolean>;
  columns: ColumnKey[];
  listView: "table" | "cards";
  splitDir: "row" | "column";
}

export interface State {
  ready: boolean;
  bootError: string | null;
  info: AppInfo | null;

  courses: Course[];
  lectures: Lecture[];
  topics: Topic[];
  sources: Source[];
  views: SavedView[];
  problems: ProblemSummary[];
  index: LibraryIndex;
  recentIds: string[];
  hasSample: boolean;
  problemCache: Record<string, Problem>;

  listMode: ListMode;
  filter: FilterSpec;
  origin: ListOrigin;
  activeViewId: string | null;
  sort: SortSpec | null;
  searchHits: Map<string, number> | null;
  selection: string[];
  anchorId: string | null;
  focusedId: string | null;
  activeCourseId: string | null;

  groups: EditorGroup[];
  activeGroup: number;

  imports: Record<string, ImportSession>;
  dialog: DialogSpec | null;
  palette: { open: boolean; query: string };
  toasts: Toast[];
  dropActive: boolean;
  saveState: "saved" | "pending" | "saving" | "error";
  lastSavedAt: string | null;

  settings: Settings;
  layout: Layout;

  inbox: InboxItem[];
  phone: { status: PhoneLinkStatus | null; error: string | null };
  /** A newer version found by the updater. */
  update: { version: string; notes: string; installing?: boolean } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "maree",
  locale: "en",
  katexMacros: {},
  editorFontSize: 13.5,
  proseSize: 16,
  editorMode: "split",
  spellcheck: false,
  onboardingDone: false,
  confirmTrash: false,
  phoneLink: false,
  phoneKey: "",
  phonePort: 47147,
  inboxFolder: "",
  autoUpdate: true,
  chatTray: [],
};

export const DEFAULT_LAYOUT: Layout = {
  sidebarOpen: true,
  listOpen: true,
  sidebarWidth: 248,
  listWidth: 460,
  collapsed: {},
  columns: DEFAULT_COLUMNS,
  listView: "table",
  splitDir: "row",
};

export const useStore = create<State>()(() => ({
  ready: false,
  bootError: null,
  info: null,
  courses: [],
  lectures: [],
  topics: [],
  sources: [],
  views: [],
  problems: [],
  index: buildIndex([], [], [], []),
  recentIds: [],
  hasSample: false,
  problemCache: {},
  listMode: "filter",
  filter: {},
  origin: { kind: "all", label: "All Problems" },
  activeViewId: null,
  sort: null,
  searchHits: null,
  selection: [],
  anchorId: null,
  focusedId: null,
  activeCourseId: null,
  groups: [{ id: "g1", tabs: [], activeId: null }],
  activeGroup: 0,
  imports: {},
  dialog: null,
  palette: { open: false, query: "" },
  toasts: [],
  dropActive: false,
  saveState: "saved",
  lastSavedAt: null,
  settings: DEFAULT_SETTINGS,
  layout: DEFAULT_LAYOUT,
  inbox: [],
  phone: { status: null, error: null },
  update: null,
}));

export const get = () => useStore.getState();
export const set = useStore.setState;

let toastId = 0;
export function toast(message: string, kind: Toast["kind"] = "info", action?: Toast["action"]): void {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind, action }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 9000 : 5000);
}

export function activeTab(): Tab | null {
  const s = get();
  const g = s.groups[s.activeGroup] ?? s.groups[0];
  return g?.tabs.find((t) => t.id === g.activeId) ?? null;
}

export function activeProblemId(): string | null {
  const t = activeTab();
  return t?.kind === "problem" ? t.problemId : null;
}
