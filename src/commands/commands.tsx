// Every command is defined once and used by the menu bar, the command palette and
// the keyboard handler, so shortcuts and labels never drift apart.

import type { ReactNode } from "react";
import {
  Archive,
  BookOpen,
  BookPlus,
  Columns2,
  Copy,
  Database,
  FileDown,
  FileInput,
  FilePlus2,
  FolderOpen,
  History,
  Inbox,
  Keyboard,
  LayoutGrid,
  LibraryBig,
  ListTree,
  Moon,
  PanelLeft,
  Printer,
  RefreshCw,
  Rows2,
  Save,
  Search,
  Settings as SettingsIcon,
  SquareSplitHorizontal,
  Tag,
  TableProperties,
  Trash2,
  Waves,
  X,
  ClipboardCopy,
  Images,
  ImagePlus,
  Smartphone,
} from "lucide-react";
import { addPhotos, copyForChatGpt, openInbox } from "../state/inbox";
import { checkForUpdates } from "../state/updates";
import { get, activeProblemId, set } from "../state/store";
import * as A from "../state/actions";
import { STATUSES, type Status } from "../data/types";
import { STATUS_LABEL } from "../domain/status";
import { StatusIcon } from "../ui/icons";
import { t } from "../i18n";
import { focusSearch, getVisibleIds } from "./bridge";
import { editUndo, editRedo, editCopy, editCut, editPaste, editSelectAll } from "./editing";
import { printProblems } from "../components/print";

export interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  /** Additional shortcuts that trigger the command. */
  alt?: string[];
  icon?: ReactNode;
  run: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** Hidden from the command palette (e.g. pure editing commands). */
  hidden?: boolean;
  /** Shortcut is handled even when a text field has focus. */
  global?: boolean;
}

/** Problems a command should act on: the list selection, or the problem in the active tab. */
export function targetIds(): string[] {
  const s = get();
  const tabProblem = activeProblemId();
  const listFocused = document.activeElement?.closest(".listpane");
  if (s.selection.length && (listFocused || !tabProblem)) return s.selection;
  if (tabProblem) return [tabProblem];
  return s.selection;
}

const hasTarget = () => targetIds().length > 0;

function statusCommands(): Command[] {
  return STATUSES.map((st: Status, i) => ({
    id: `status.${st}`,
    label: t("Mark as {status}", { status: t(STATUS_LABEL[st]) }),
    category: t("Problem"),
    shortcut: `Alt+${i + 1}`,
    icon: <StatusIcon status={st} />,
    run: () => A.setStatus(targetIds(), st),
    enabled: hasTarget,
    global: true,
  }));
}

export function buildCommands(): Command[] {
  return [
    // File
    { id: "problem.new", label: t("New Problem"), category: t("File"), shortcut: "Ctrl+N", icon: <FilePlus2 size={15} />, run: () => A.createProblem(), global: true },
    { id: "course.new", label: t("New Course…"), category: t("Library"), icon: <BookPlus size={15} />, run: () => A.openDialog({ kind: "course" }) },
    { id: "import.files", label: t("Import Exercises…"), category: t("File"), shortcut: "Ctrl+O", icon: <FileInput size={15} />, run: () => A.pickAndImport(), global: true },
    { id: "import.library", label: t("Import Library (JSON)…"), category: t("File"), icon: <LibraryBig size={15} />, run: () => A.importLibraryFile() },
    { id: "backup.restore", label: t("Restore Library Backup…"), category: t("File"), icon: <Archive size={15} />, run: () => A.restoreBackup() },
    {
      id: "export.selection",
      label: t("Export Problems…"),
      category: t("File"),
      shortcut: "Ctrl+E",
      icon: <FileDown size={15} />,
      run: () => openExportDialog(),
      global: true,
    },
    { id: "export.library", label: t("Export Library as JSON…"), category: t("File"), icon: <Database size={15} />, run: () => A.exportLibraryJsonFile() },
    { id: "backup.create", label: t("Back Up Library…"), category: t("File"), shortcut: "Ctrl+Shift+S", icon: <Save size={15} />, run: () => A.backupLibrary(), global: true },
    {
      id: "print",
      label: t("Print / Save as PDF…"),
      category: t("File"),
      shortcut: "Ctrl+Alt+P",
      icon: <Printer size={15} />,
      run: () => {
        const ids = exportScopeIds();
        return printProblems(ids.ids, ids.title);
      },
    },
    { id: "settings", label: t("Settings"), category: t("File"), shortcut: "Ctrl+,", icon: <SettingsIcon size={15} />, run: () => A.openTab({ id: "settings", kind: "settings" }), global: true },
    { id: "tab.close", label: t("Close Tab"), category: t("View"), shortcut: "Ctrl+W", icon: <X size={15} />, run: () => A.closeActiveTab(), global: true },
    { id: "app.exit", label: t("Exit"), category: t("File"), shortcut: "Alt+F4", run: () => import("../platform").then((m) => m.platform().window.close()) },

    // Edit
    { id: "edit.undo", label: t("Undo"), category: t("Edit"), shortcut: "Ctrl+Z", run: editUndo, hidden: true },
    { id: "edit.redo", label: t("Redo"), category: t("Edit"), shortcut: "Ctrl+Y", run: editRedo, hidden: true },
    { id: "edit.cut", label: t("Cut"), category: t("Edit"), shortcut: "Ctrl+X", run: editCut, hidden: true },
    { id: "edit.copy", label: t("Copy"), category: t("Edit"), shortcut: "Ctrl+C", run: editCopy, hidden: true },
    { id: "edit.paste", label: t("Paste"), category: t("Edit"), shortcut: "Ctrl+V", run: editPaste, hidden: true },
    { id: "edit.selectAll", label: t("Select All"), category: t("Edit"), shortcut: "Ctrl+A", run: editSelectAll, hidden: true },
    { id: "search.focus", label: t("Find in Library"), category: t("Edit"), shortcut: "Ctrl+F", icon: <Search size={15} />, run: focusSearch, global: true },
    {
      id: "problem.copyChatGpt",
      label: t("Copy for ChatGPT"),
      category: t("Edit"),
      shortcut: "Ctrl+Shift+C",
      icon: <ClipboardCopy size={15} />,
      run: () => targetIds()[0] && copyForChatGpt(targetIds()[0]),
      enabled: hasTarget,
      global: true,
    },
    {
      id: "problem.copyMarkdown",
      label: t("Copy Problem and Solution as Markdown"),
      category: t("Edit"),
      icon: <Copy size={15} />,
      run: () => targetIds()[0] && A.copyProblemAs(targetIds()[0], "solution", "md"),
      enabled: hasTarget,
      global: true,
    },
    {
      id: "problem.copyLatex",
      label: t("Copy Problem and Solution as LaTeX"),
      category: t("Edit"),
      icon: <Copy size={15} />,
      run: () => targetIds()[0] && A.copyProblemAs(targetIds()[0], "solution", "tex"),
      enabled: hasTarget,
    },
    {
      id: "problem.duplicate",
      label: t("Duplicate Problem"),
      category: t("Edit"),
      shortcut: "Ctrl+D",
      run: () => targetIds()[0] && A.duplicateProblem(targetIds()[0]),
      enabled: hasTarget,
    },
    {
      id: "problem.trash",
      label: t("Move to Trash"),
      category: t("Edit"),
      shortcut: "Ctrl+Delete",
      icon: <Trash2 size={15} />,
      run: () => A.trashProblems(targetIds()),
      enabled: hasTarget,
      global: true,
    },
    {
      id: "problem.review",
      label: t("Schedule Review…"),
      category: t("Problem"),
      shortcut: "Ctrl+R",
      icon: <History size={15} />,
      run: () => A.openDialog({ kind: "review-date", problemIds: targetIds() }),
      enabled: hasTarget,
      global: true,
    },
    ...statusCommands(),

    // View
    { id: "palette", label: t("Search Everything…"), category: t("View"), shortcut: "Ctrl+K", alt: ["Ctrl+P"], run: () => set({ palette: { open: true, query: "" } }), global: true, hidden: true },
    { id: "commands", label: t("Command Palette"), category: t("View"), shortcut: "Ctrl+Shift+P", run: () => set({ palette: { open: true, query: ">" } }), global: true, hidden: true },
    { id: "view.sidebar", label: t("Toggle Sidebar"), category: t("View"), shortcut: "Ctrl+B", icon: <PanelLeft size={15} />, run: () => A.updateLayout({ sidebarOpen: !get().layout.sidebarOpen }), checked: () => get().layout.sidebarOpen, global: true },
    { id: "view.list", label: t("Toggle Problem List"), category: t("View"), shortcut: "Ctrl+J", icon: <ListTree size={15} />, run: () => A.updateLayout({ listOpen: !get().layout.listOpen }), checked: () => get().layout.listOpen, global: true },
    { id: "view.table", label: t("Table View"), category: t("View"), icon: <TableProperties size={15} />, run: () => A.updateLayout({ listView: "table" }), checked: () => get().layout.listView === "table" },
    { id: "view.cards", label: t("Card View"), category: t("View"), icon: <LayoutGrid size={15} />, run: () => A.updateLayout({ listView: "cards" }), checked: () => get().layout.listView === "cards" },
    { id: "view.splitRight", label: t("Split Editor Right"), category: t("View"), shortcut: "Ctrl+\\", icon: <Columns2 size={15} />, run: () => A.splitEditor("row"), global: true },
    { id: "view.splitDown", label: t("Split Editor Down"), category: t("View"), icon: <Rows2 size={15} />, run: () => A.splitEditor("column") },
    { id: "view.unsplit", label: t("Close Split"), category: t("View"), icon: <SquareSplitHorizontal size={15} />, run: () => A.unsplitEditor(), enabled: () => get().groups.length > 1 },
    { id: "view.nextTab", label: t("Next Tab"), category: t("View"), shortcut: "Ctrl+Tab", run: () => A.cycleTab(1), global: true, hidden: true },
    { id: "view.prevTab", label: t("Previous Tab"), category: t("View"), shortcut: "Ctrl+Shift+Tab", run: () => A.cycleTab(-1), global: true, hidden: true },
    { id: "view.zoomIn", label: t("Larger Mathematics"), category: t("View"), shortcut: "Ctrl+=", alt: ["Ctrl++"], run: () => A.updateSettings({ proseSize: Math.min(22, get().settings.proseSize + 1) }), global: true },
    { id: "view.zoomOut", label: t("Smaller Mathematics"), category: t("View"), shortcut: "Ctrl+-", run: () => A.updateSettings({ proseSize: Math.max(13, get().settings.proseSize - 1) }), global: true },
    { id: "view.zoomReset", label: t("Reset Text Size"), category: t("View"), shortcut: "Ctrl+0", run: () => A.updateSettings({ proseSize: 16 }), global: true },
    ...(
      [
        ["maree", "Marée (light)"],
        ["maree-dark", "Dark Academic"],
        ["waterloo", "Waterloo Math Pink"],
        ["black-gold", "Black & Gold"],
        ["system", "Follow System"],
      ] as const
    ).map(([id, label]) => ({
      id: `theme.${id}`,
      label: t("Theme: {name}", { name: t(label) }),
      category: t("View"),
      icon: <Moon size={15} />,
      run: () => A.updateSettings({ theme: id }),
      checked: () => get().settings.theme === id,
    })),

    // Library
    { id: "nav.all", label: t("All Problems"), category: t("Go"), shortcut: "Ctrl+1", icon: <BookOpen size={15} />, run: A.showAll, global: true },
    { id: "nav.review", label: t("Review Queue"), category: t("Go"), shortcut: "Ctrl+2", icon: <Inbox size={15} />, run: A.showReview, global: true },
    { id: "nav.recent", label: t("Recently Edited"), category: t("Go"), shortcut: "Ctrl+3", icon: <History size={15} />, run: A.showRecent, global: true },
    { id: "inbox.open", label: t("Photo Inbox"), category: t("Go"), shortcut: "Ctrl+4", icon: <Images size={15} />, run: openInbox, global: true },
    { id: "inbox.add", label: t("Add Photos to Inbox…"), category: t("File"), icon: <ImagePlus size={15} />, run: () => addPhotos() },
    { id: "phone.connect", label: t("Connect Phone…"), category: t("Tools"), icon: <Smartphone size={15} />, run: () => A.openDialog({ kind: "phone" }) },
    { id: "nav.trash", label: t("Trash"), category: t("Go"), icon: <Trash2 size={15} />, run: A.showTrash },
    { id: "nav.importReview", label: t("Problems Needing Import Review"), category: t("Go"), run: A.showImportReview },
    { id: "lecture.new", label: t("Add Lectures…"), category: t("Library"), run: () => {
      const c = get().activeCourseId ?? get().courses[0]?.id;
      if (c) A.openDialog({ kind: "lectures-bulk", courseId: c });
      else A.openDialog({ kind: "course" });
    } },
    { id: "topic.new", label: t("New Topic…"), category: t("Library"), icon: <Tag size={15} />, run: () => A.openDialog({ kind: "topic" }) },
    { id: "view.save", label: t("Save Current Filter as View…"), category: t("Library"), run: () => A.openDialog({ kind: "save-view" }) },
    { id: "sample.load", label: t("Load Sample Library"), category: t("Library"), run: A.loadSample, enabled: () => !get().hasSample },
    { id: "sample.remove", label: t("Remove Sample Data"), category: t("Library"), run: A.removeSample, enabled: () => get().hasSample },
    { id: "trash.empty", label: t("Empty Trash…"), category: t("Library"), run: A.emptyTrash },

    // Tools
    { id: "progress", label: t("Progress Overview"), category: t("Tools"), shortcut: "Ctrl+Shift+G", icon: <Waves size={15} />, run: () => A.openTab({ id: "progress", kind: "progress" }), global: true },
    { id: "tools.reindex", label: t("Rebuild Search Index"), category: t("Tools"), icon: <RefreshCw size={15} />, run: A.rebuildSearchIndex },
    { id: "tools.snapshot", label: t("Take Database Snapshot"), category: t("Tools"), icon: <Database size={15} />, run: A.snapshotNow },
    { id: "tools.dataFolder", label: t("Open Data Folder"), category: t("Tools"), icon: <FolderOpen size={15} />, run: () => import("../platform").then((m) => m.platform().openDataFolder()) },

    // Help
    { id: "help.welcome", label: t("Getting Started"), category: t("Help"), run: () => A.openTab({ id: "welcome", kind: "welcome" }) },
    { id: "help.shortcuts", label: t("Keyboard Shortcuts and LaTeX Syntax"), category: t("Help"), shortcut: "F1", icon: <Keyboard size={15} />, run: () => A.openTab({ id: "help", kind: "help" }), global: true },
    { id: "help.updates", label: t("Check for Updates…"), category: t("Help"), icon: <RefreshCw size={15} />, run: () => checkForUpdates(true) },
    { id: "help.about", label: t("About Marée"), category: t("Help"), run: () => A.openDialog({ kind: "about" }) },
  ];
}

/** What "Export…" and "Print…" act on: the selection, else the visible list. */
export function exportScopeIds(): { ids: string[]; title: string } {
  const s = get();
  const sel = targetIds();
  if (sel.length > 1 || (sel.length === 1 && document.activeElement?.closest(".listpane"))) {
    return { ids: sel, title: sel.length === 1 ? t("Problem") : t("{n} selected problems", { n: sel.length }) };
  }
  const tabProblem = activeProblemId();
  if (tabProblem && !document.activeElement?.closest(".listpane")) {
    const p = s.problems.find((x) => x.id === tabProblem);
    return { ids: [tabProblem], title: p?.title || (p?.sourceNumber ? `Problem ${p.sourceNumber}` : t("Problem")) };
  }
  return { ids: getVisibleIds(), title: s.origin.label };
}

function openExportDialog() {
  const { ids, title } = exportScopeIds();
  A.openDialog({ kind: "export", problemIds: ids, title });
}

let cache: Command[] | null = null;
export function commands(): Command[] {
  if (!cache) cache = buildCommands();
  return cache;
}
export function resetCommands(): void {
  cache = null;
}

export function runCommand(id: string): void {
  const c = commands().find((x) => x.id === id);
  if (!c || (c.enabled && !c.enabled())) return;
  void Promise.resolve(c.run()).catch((e) => {
    console.error(e);
    import("../state/store").then((m) => m.toast(String((e as Error).message ?? e), "error"));
  });
}

// ------------------------------------------------------------- shortcuts

export function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  if (e.code.startsWith("Digit") && (e.altKey || e.ctrlKey)) key = e.code.slice(5);
  if (key === "Backslash" || e.code === "Backslash") key = "\\";
  if (e.code === "Equal" && (e.ctrlKey || e.metaKey)) key = "=";
  if (e.code === "Minus" && (e.ctrlKey || e.metaKey)) key = "-";
  if (e.code === "Comma" && (e.ctrlKey || e.metaKey)) key = ",";
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return parts.join("+");
  parts.push(key);
  return parts.join("+");
}

/** Shortcuts the text editors own; they are not intercepted while typing. */
const EDITOR_OWNED = new Set(["Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+X", "Ctrl+C", "Ctrl+V", "Ctrl+A", "Ctrl+B", "Ctrl+I", "Ctrl+F", "Ctrl+D", "Ctrl+Delete", "Ctrl+M"]);

export function handleGlobalKey(e: KeyboardEvent): boolean {
  const sc = eventToShortcut(e);
  if (!sc || sc === "Ctrl" || sc === "Alt" || sc === "Shift") return false;
  const target = e.target as HTMLElement | null;
  const typing = !!target && (target.closest(".cm-editor") || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
  if (typing && EDITOR_OWNED.has(sc)) return false;
  const cmd = commands().find((c) => c.shortcut === sc || c.alt?.includes(sc));
  if (!cmd) return false;
  if (cmd.hidden && cmd.category === t("Edit")) return false;
  if (typing && !cmd.global) return false;
  if (cmd.enabled && !cmd.enabled()) return false;
  e.preventDefault();
  runCommand(cmd.id);
  return true;
}
