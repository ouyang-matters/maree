// All user-facing operations. Components, menus and the command palette call these.

import { Repo, type BulkUpdate, type CourseInput, type LectureInput, type TopicInput } from "../data/repo";
import { migrate } from "../data/schema";
import { todayLocal } from "../data/ids";
import type {
  Category,
  FilterSpec,
  Lecture,
  NewProblem,
  Outcome,
  PartPatch,
  Problem,
  ProblemPatch,
  SortKey,
  Source,
  Status,
  Topic,
} from "../data/types";
import { buildIndex, courseLabel, lectureLabel, problemLabel } from "../domain/filters";
import { STATUS_LABEL } from "../domain/status";
import { loadSampleLibrary } from "../data/sample";
import { initPlatform, platform } from "../platform";
import type { PickedFile } from "../platform/types";
import { setMacros, DEFAULT_MACROS } from "../math/render";
import { fmtDate, setLocale, t } from "../i18n";
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  get,
  set,
  toast,
  type DialogSpec,
  type EditorGroup,
  type ImportSession,
  type Layout,
  type ListOrigin,
  type Settings,
  type Tab,
  type ThemeId,
} from "./store";
import { configureAutosave, flushAutosave, queuePartPatch, queueProblemPatch } from "./autosave";
import {
  commitPlans,
  detectFormat,
  extractDocument,
  LibraryFileError,
  mapLectures,
  planDocument,
  sha256Hex,
  type DocPlan,
  type LibraryContext,
} from "../import/pipeline";
import type { Candidate } from "../import/types";
import { exportLibrary, importLibrary, validateLibrary, type LibraryJson } from "../export/library-json";
import { collectionToLatex, collectionToMarkdown, DEFAULT_EXPORT, problemToMarkdown, safeFileName, type ExportOptions } from "../export/documents";
import { loadPdfjs } from "../import/pdfjs-loader";

export let repo: Repo;

// ------------------------------------------------------------------ boot

export async function boot(): Promise<void> {
  try {
    const p = await initPlatform();
    const info = await p.info();
    await migrate(p.db);
    repo = new Repo(p.db);
    configureAutosave(writeEdits, (ids) => refreshProblems(ids));
    await loadSettings();
    await reloadAll();
    set({ info, ready: true });
    restoreSession();
    const s = get();
    if (!s.settings.onboardingDone && s.problems.length === 0 && s.courses.length === 0) openTab({ id: "welcome", kind: "welcome" });
    p.window.onCloseRequested(async () => {
      await flushAutosave();
      await persistSession();
      await repo.idle();
    });
    if (info.e2e) exposeTestHooks();
    await p.window.show();
  } catch (e) {
    console.error(e);
    set({ bootError: e instanceof Error ? e.message : String(e), ready: false });
    try {
      await platform().window.show();
    } catch {
      /* ignore */
    }
  }
}

async function loadSettings(): Promise<void> {
  const raw = await repo.getSettings();
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (raw[k] !== undefined && raw[k] !== null) (settings as unknown as Record<string, unknown>)[k] = raw[k];
  }
  if (!raw.katexMacros) settings.katexMacros = { ...DEFAULT_MACROS };
  const layout: Layout = { ...DEFAULT_LAYOUT, ...((raw.layout as Partial<Layout>) ?? {}) };
  set({ settings, layout });
  applySettings(settings);
  const sort = raw.sort as typeof DEFAULT_SORT | undefined;
  if (sort !== undefined) set({ sort });
  const sessionCourse = raw.activeCourseId as string | undefined;
  if (sessionCourse) set({ activeCourseId: sessionCourse });
}

const DEFAULT_SORT = null;

function applySettings(s: Settings): void {
  applyTheme(s.theme);
  setMacros(s.katexMacros);
  setLocale(s.locale);
  document.documentElement.style.setProperty("--editor-font-size", `${s.editorFontSize}px`);
  document.documentElement.style.setProperty("--prose-size", `${s.proseSize}px`);
}

export function resolveTheme(theme: ThemeId): Exclude<ThemeId, "system"> {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "maree-dark" : "maree";
}

export function applyTheme(theme: ThemeId): void {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem("maree-theme", resolved);
  } catch {
    /* storage may be unavailable */
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  applySettings(settings);
  for (const [k, v] of Object.entries(patch)) await repo.setSetting(k, v);
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null;
export function updateLayout(patch: Partial<Layout>): void {
  set((s) => ({ layout: { ...s.layout, ...patch } }));
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => void repo.setSetting("layout", get().layout), 500);
}

// --------------------------------------------------------------- loading

export async function reloadEntities(): Promise<void> {
  const [courses, lectures, topics, sources, views, hasSample] = await Promise.all([
    repo.listCourses(),
    repo.listLectures(),
    repo.listTopics(),
    repo.listSources(),
    repo.listViews(),
    repo.hasSample(),
  ]);
  const s = get();
  const activeCourseId =
    s.activeCourseId && courses.some((c) => c.id === s.activeCourseId) ? s.activeCourseId : (courses.find((c) => !c.archived)?.id ?? null);
  set({ courses, lectures, topics, sources, views, hasSample, activeCourseId, index: buildIndex(courses, lectures, topics, sources) });
}

export async function reloadProblems(): Promise<void> {
  const [problems, recentIds] = await Promise.all([repo.listSummaries(), repo.listRecent()]);
  set({ problems, recentIds });
  // Drop cached full records so open tabs re-read fresh data.
  const cache = get().problemCache;
  const fresh: Record<string, Problem> = {};
  for (const id of Object.keys(cache)) {
    const p = await repo.getProblem(id);
    if (p) fresh[id] = p;
  }
  set({ problemCache: fresh });
  await rerunSearch();
}

export async function reloadAll(): Promise<void> {
  await reloadEntities();
  await reloadProblems();
}

export async function refreshProblems(ids: string[], opts: { full?: boolean } = {}): Promise<void> {
  if (!ids.length) return;
  const sums = await repo.getSummaries(ids);
  const byId = new Map(sums.map((s) => [s.id, s]));
  set((s) => {
    const existing = new Set(s.problems.map((p) => p.id));
    const problems = s.problems.filter((p) => !ids.includes(p.id) || byId.has(p.id)).map((p) => byId.get(p.id) ?? p);
    for (const sm of sums) if (!existing.has(sm.id)) problems.push(sm);
    return { problems };
  });
  if (opts.full) {
    const cache = { ...get().problemCache };
    for (const id of ids) {
      if (!(id in cache)) continue;
      const p = await repo.getProblem(id);
      if (p) cache[id] = p;
      else delete cache[id];
    }
    set({ problemCache: cache });
  }
}

export async function loadProblem(id: string, force = false): Promise<Problem | null> {
  const cached = get().problemCache[id];
  if (cached && !force) return cached;
  const p = await repo.getProblem(id);
  if (p) set((s) => ({ problemCache: { ...s.problemCache, [id]: p } }));
  return p;
}

// ---------------------------------------------------------------- session

let sessionTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSessionSave() {
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => void persistSession(), 800);
}

export async function persistSession(): Promise<void> {
  if (!repo) return;
  const s = get();
  const groups = s.groups.map((g) => ({
    tabs: g.tabs.filter((t) => t.kind !== "import").map((t) => ({ ...t, preview: false })),
    activeId: g.activeId,
  }));
  await repo.setSetting("session", { groups, activeGroup: s.activeGroup });
  await repo.setSetting("activeCourseId", s.activeCourseId);
}

function restoreSession(): void {
  void repo.getSettings().then((raw) => {
    const sess = raw.session as { groups: { tabs: Tab[]; activeId: string | null }[]; activeGroup: number } | undefined;
    if (!sess?.groups?.length) return;
    const s = get();
    const valid = (t: Tab) =>
      (t.kind === "problem" && s.problems.some((p) => p.id === t.problemId && !p.deletedAt)) ||
      (t.kind === "source" && s.sources.some((x) => x.id === t.sourceId)) ||
      ["progress", "settings", "help", "inbox"].includes(t.kind);
    const groups: EditorGroup[] = sess.groups
      .map((g, i) => {
        const tabs = g.tabs.filter(valid);
        return { id: `g${i + 1}`, tabs, activeId: tabs.some((t) => t.id === g.activeId) ? g.activeId : (tabs[0]?.id ?? null) };
      })
      .filter((g) => g.tabs.length);
    if (!groups.length) return;
    set({ groups, activeGroup: Math.min(sess.activeGroup ?? 0, groups.length - 1) });
    for (const g of groups) for (const t of g.tabs) if (t.kind === "problem") void loadProblem(t.problemId);
  });
}

// ------------------------------------------------------------- list scope

function resetList(patch: Partial<ReturnType<typeof get>>) {
  set({ selection: [], anchorId: null, focusedId: null, activeViewId: null, ...patch });
  void rerunSearch();
}

export function showAll(): void {
  resetList({ listMode: "filter", filter: {}, origin: { kind: "all", label: "All Problems" } });
}

export function showCourse(id: string): void {
  const c = get().index.courses.get(id);
  if (!c) return;
  resetList({ listMode: "filter", filter: { courseIds: [id] }, origin: { kind: "course", id, label: courseLabel(c) }, activeCourseId: id });
  scheduleSessionSave();
}

export function showLecture(id: string): void {
  const l = get().index.lectures.get(id);
  if (!l) return;
  const c = get().index.courses.get(l.courseId);
  resetList({
    listMode: "filter",
    filter: { lectureIds: [id] },
    origin: { kind: "lecture", id, label: `${c ? `${c.code || c.title} · ` : ""}${lectureLabel(l)}` },
    activeCourseId: l.courseId,
  });
}

export function showTopic(id: string): void {
  const tp = get().index.topics.get(id);
  if (!tp) return;
  resetList({ listMode: "filter", filter: { topicIds: [id], includeSubtopics: true }, origin: { kind: "topic", id, label: tp.name } });
}

/** A topic within one course: "MATH 147 · Cauchy Sequences". */
export function showCourseTopic(courseId: string, topicId: string): void {
  const c = get().index.courses.get(courseId);
  const tp = get().index.topics.get(topicId);
  if (!c || !tp) return;
  resetList({
    listMode: "filter",
    filter: { courseIds: [courseId], topicIds: [topicId], includeSubtopics: true },
    origin: { kind: "topic", id: topicId, courseId, label: `${c.code || c.title} · ${tp.name}` },
    activeCourseId: courseId,
  });
}

export function showSource(id: string): void {
  const src = get().index.sources.get(id);
  if (!src) return;
  resetList({ listMode: "filter", filter: { sourceIds: [id] }, origin: { kind: "source", id, label: src.title } });
}

export function showView(id: string): void {
  const v = get().views.find((x) => x.id === id);
  if (!v) return;
  resetList({ listMode: "filter", filter: v.filter, origin: { kind: "view", id, label: v.name }, sort: v.sort ?? get().sort });
  set({ activeViewId: id });
}

export function showReview(): void {
  resetList({ listMode: "review", filter: {}, origin: { kind: "custom", label: "Review Queue" } });
}

export function showRecent(): void {
  resetList({ listMode: "recent", filter: {}, origin: { kind: "custom", label: "Recently Edited" } });
}

export function showTrash(): void {
  resetList({ listMode: "trash", filter: {}, origin: { kind: "custom", label: "Trash" } });
}

export function showImportReview(): void {
  resetList({ listMode: "filter", filter: { flags: ["import-review"] }, origin: { kind: "import-review", label: "Needs import review" } });
}

export function showUnassigned(): void {
  resetList({ listMode: "filter", filter: { courseIds: [""] }, origin: { kind: "unassigned", label: "No course" } });
}

export function setFilter(filter: FilterSpec, origin?: ListOrigin): void {
  const prevText = get().filter.text ?? "";
  set((s) => ({
    filter,
    listMode: s.listMode === "review" || s.listMode === "recent" ? s.listMode : "filter",
    origin: origin ?? (s.origin.kind === "view" || s.origin.kind === "all" ? s.origin : s.origin),
  }));
  if ((filter.text ?? "") !== prevText) scheduleSearch();
}

export function patchFilter(patch: Partial<FilterSpec>): void {
  setFilter({ ...get().filter, ...patch });
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void rerunSearch(), 120);
}

async function rerunSearch(): Promise<void> {
  const text = get().filter.text?.trim();
  if (!text) {
    set({ searchHits: null });
    return;
  }
  try {
    const hits = await repo.search(text);
    if ((get().filter.text?.trim() ?? "") === text) set({ searchHits: hits });
  } catch (e) {
    console.warn("search failed", e);
    set({ searchHits: null });
  }
}

export function setSort(key: SortKey): void {
  const cur = get().sort;
  const next = !cur || cur.key !== key ? { key, dir: "asc" as const } : cur.dir === "asc" ? { key, dir: "desc" as const } : null;
  set({ sort: next });
  void repo.setSetting("sort", next);
}

export function selectProblem(id: string, mode: "single" | "toggle" | "range", visible: string[]): void {
  const s = get();
  if (mode === "single") set({ selection: [id], anchorId: id, focusedId: id });
  else if (mode === "toggle") {
    const has = s.selection.includes(id);
    set({ selection: has ? s.selection.filter((x) => x !== id) : [...s.selection, id], anchorId: id, focusedId: id });
  } else {
    const a = visible.indexOf(s.anchorId ?? id);
    const b = visible.indexOf(id);
    if (a < 0 || b < 0) return set({ selection: [id], anchorId: id, focusedId: id });
    const [lo, hi] = a < b ? [a, b] : [b, a];
    set({ selection: visible.slice(lo, hi + 1), focusedId: id });
  }
}

// ------------------------------------------------------------------- tabs

function updateGroups(fn: (groups: EditorGroup[]) => EditorGroup[], activeGroup?: number) {
  set((s) => {
    const groups = fn(s.groups.map((g) => ({ ...g, tabs: [...g.tabs] })));
    const nonEmpty = groups.filter((g, i) => g.tabs.length || i === 0);
    return { groups: nonEmpty.length ? nonEmpty : [{ id: "g1", tabs: [], activeId: null }], activeGroup: Math.min(activeGroup ?? s.activeGroup, Math.max(0, nonEmpty.length - 1)) };
  });
  scheduleSessionSave();
}

export function openTab(tab: Tab, opts: { group?: number; preview?: boolean } = {}): void {
  const s = get();
  let gi = opts.group ?? s.activeGroup;
  if (gi >= s.groups.length) gi = s.groups.length - 1;
  // Already open somewhere? Activate it there.
  const where = s.groups.findIndex((g) => g.tabs.some((t) => t.id === tab.id));
  if (where >= 0 && opts.group === undefined) {
    updateGroups((groups) => {
      const g = groups[where];
      g.tabs = g.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab, preview: opts.preview ? (t as { preview?: boolean }).preview : false } : t)) as Tab[];
      g.activeId = tab.id;
      return groups;
    }, where);
    return;
  }
  updateGroups((groups) => {
    while (groups.length <= gi) groups.push({ id: `g${groups.length + 1}`, tabs: [], activeId: null });
    const g = groups[gi];
    const existing = g.tabs.findIndex((t) => t.id === tab.id);
    const newTab = { ...tab, preview: !!opts.preview } as Tab;
    if (existing >= 0) g.tabs[existing] = newTab;
    else {
      const previewIdx = opts.preview ? g.tabs.findIndex((t) => (t as { preview?: boolean }).preview) : -1;
      if (previewIdx >= 0) g.tabs[previewIdx] = newTab;
      else {
        const activeIdx = g.tabs.findIndex((t) => t.id === g.activeId);
        g.tabs.splice(activeIdx + 1, 0, newTab);
      }
    }
    g.activeId = tab.id;
    return groups;
  }, gi);
}

export async function openProblem(id: string, opts: { preview?: boolean; group?: number } = {}): Promise<void> {
  await loadProblem(id);
  openTab({ id: `p:${id}`, kind: "problem", problemId: id }, opts);
  set({ focusedId: id });
  void repo.touchRecent(id).then(async () => set({ recentIds: await repo.listRecent() }));
}

export function pinTab(tabId: string): void {
  updateGroups((groups) => {
    for (const g of groups) g.tabs = g.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)) as Tab[];
    return groups;
  });
}

export async function closeTab(groupIndex: number, tabId: string): Promise<void> {
  await flushAutosave();
  updateGroups((groups) => {
    const g = groups[groupIndex];
    if (!g) return groups;
    const idx = g.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return groups;
    g.tabs.splice(idx, 1);
    if (g.activeId === tabId) g.activeId = g.tabs[Math.min(idx, g.tabs.length - 1)]?.id ?? null;
    return groups;
  });
  const t = tabId.startsWith("import:") ? tabId.slice(7) : null;
  if (t && !get().groups.some((g) => g.tabs.some((x) => x.id === tabId))) {
    set((s) => {
      const imports = { ...s.imports };
      delete imports[t];
      return { imports };
    });
  }
}

export async function closeActiveTab(): Promise<void> {
  const s = get();
  const g = s.groups[s.activeGroup];
  if (g?.activeId) await closeTab(s.activeGroup, g.activeId);
}

export async function closeAllTabs(groupIndex?: number): Promise<void> {
  await flushAutosave();
  updateGroups((groups) => groups.map((g, i) => (groupIndex === undefined || i === groupIndex ? { ...g, tabs: [], activeId: null } : g)));
}

export async function closeOtherTabs(groupIndex: number, keepId: string): Promise<void> {
  await flushAutosave();
  updateGroups((groups) => {
    const g = groups[groupIndex];
    g.tabs = g.tabs.filter((t) => t.id === keepId);
    g.activeId = keepId;
    return groups;
  });
}

export function activateTab(groupIndex: number, tabId: string): void {
  updateGroups((groups) => {
    groups[groupIndex].activeId = tabId;
    return groups;
  }, groupIndex);
  const tab = get().groups[groupIndex]?.tabs.find((t) => t.id === tabId);
  if (tab?.kind === "problem") set({ focusedId: tab.problemId });
}

export function focusGroup(groupIndex: number): void {
  if (get().activeGroup !== groupIndex) set({ activeGroup: groupIndex });
}

export function cycleTab(delta: number): void {
  const s = get();
  const g = s.groups[s.activeGroup];
  if (!g || g.tabs.length < 2) return;
  const i = g.tabs.findIndex((t) => t.id === g.activeId);
  const next = g.tabs[(i + delta + g.tabs.length) % g.tabs.length];
  activateTab(s.activeGroup, next.id);
}

export function splitEditor(dir?: "row" | "column"): void {
  const s = get();
  if (dir) updateLayout({ splitDir: dir });
  if (s.groups.length >= 2) {
    if (!dir) updateLayout({ splitDir: s.layout.splitDir === "row" ? "column" : "row" });
    return;
  }
  const g = s.groups[0];
  const active = g.tabs.find((t) => t.id === g.activeId);
  updateGroups((groups) => [...groups, { id: "g2", tabs: active ? [{ ...active, preview: false } as Tab] : [], activeId: active?.id ?? null }], 1);
  if (!active) toast(t("Editor split. Open a problem or source to fill the new group."));
}

export function unsplitEditor(): void {
  updateGroups((groups) => {
    if (groups.length < 2) return groups;
    const [a, b] = groups;
    for (const tb of b.tabs) if (!a.tabs.some((x) => x.id === tb.id)) a.tabs.push(tb);
    return [a];
  }, 0);
}

export function moveTabToOtherGroup(groupIndex: number, tabId: string): void {
  const s = get();
  const target = groupIndex === 0 ? 1 : 0;
  const tab = s.groups[groupIndex]?.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  updateGroups((groups) => {
    if (groups.length < 2) groups.push({ id: "g2", tabs: [], activeId: null });
    const from = groups[groupIndex];
    from.tabs = from.tabs.filter((t) => t.id !== tabId);
    if (from.activeId === tabId) from.activeId = from.tabs[0]?.id ?? null;
    const to = groups[target];
    if (!to.tabs.some((t) => t.id === tabId)) to.tabs.push({ ...tab, preview: false } as Tab);
    to.activeId = tabId;
    return groups;
  }, target);
}

/** Opens a source document; `beside` places it in the other editor group (creating a split). */
export function openSource(sourceId: string, page?: number, beside = false): void {
  const s = get();
  const tab: Tab = { id: `s:${sourceId}`, kind: "source", sourceId, page, nonce: Date.now() };
  if (!beside) return openTab(tab);
  const other = s.groups.length >= 2 ? (s.activeGroup === 0 ? 1 : 0) : 1;
  if (s.groups.length < 2) {
    updateGroups((groups) => [...groups, { id: "g2", tabs: [], activeId: null }]);
  }
  // Remove from the current group so it does not appear twice.
  updateGroups((groups) => {
    for (const g of groups) {
      if (g.tabs.some((t) => t.id === tab.id) && groups.indexOf(g) !== other) {
        g.tabs = g.tabs.filter((t) => t.id !== tab.id);
        if (g.activeId === tab.id) g.activeId = g.tabs[0]?.id ?? null;
      }
    }
    return groups;
  });
  openTab(tab, { group: other });
  set({ activeGroup: s.activeGroup });
}

// ------------------------------------------------------------- problems

async function writeEdits(problemId: string, patch: ProblemPatch, parts: Map<string, PartPatch>): Promise<void> {
  if (Object.keys(patch).length) await repo.updateProblem(problemId, patch);
  for (const [partId, pp] of parts) await repo.updatePart(partId, pp);
}

const TEXT_FIELDS = new Set(["title", "statement", "solution", "referenceSolution", "notes", "sourceNumber", "sourceSection"]);

/** Applies an edit to the open problem immediately; text is autosaved, metadata saved at once. */
export async function patchProblem(id: string, patch: ProblemPatch): Promise<void> {
  set((s) => {
    const cur = s.problemCache[id];
    const problemCache = cur ? { ...s.problemCache, [id]: { ...cur, ...patch, updatedAt: new Date().toISOString() } } : s.problemCache;
    const problems = s.problems.map((p) =>
      p.id === id
        ? {
            ...p,
            ...("title" in patch ? { title: patch.title! } : {}),
            ...("statement" in patch ? { preview: patch.statement!.slice(0, 600) } : {}),
            ...("status" in patch ? { status: patch.status! } : {}),
            ...("difficulty" in patch ? { difficulty: patch.difficulty ?? null } : {}),
            ...("priority" in patch ? { priority: patch.priority! } : {}),
            ...("category" in patch ? { category: patch.category ?? null } : {}),
            ...("courseId" in patch ? { courseId: patch.courseId ?? null } : {}),
            ...("sourceNumber" in patch ? { sourceNumber: patch.sourceNumber! } : {}),
            ...("lectureIds" in patch ? { lectureIds: patch.lectureIds! } : {}),
            ...("topicIds" in patch ? { topicIds: patch.topicIds! } : {}),
            ...("reviewDue" in patch ? { reviewDue: patch.reviewDue ?? null } : {}),
            ...("pinned" in patch ? { pinned: !!patch.pinned } : {}),
            ...("importFlags" in patch ? { needsImportReview: (patch.importFlags ?? []).length > 0 } : {}),
          }
        : p,
    );
    return { problemCache, problems };
  });
  const keys = Object.keys(patch);
  if (keys.every((k) => TEXT_FIELDS.has(k))) {
    queueProblemPatch(id, patch);
    pinTab(`p:${id}`);
    return;
  }
  await flushAutosave();
  set({ saveState: "saving" });
  try {
    await repo.updateProblem(id, patch);
    set({ saveState: "saved", lastSavedAt: new Date().toISOString() });
  } catch (e) {
    set({ saveState: "error" });
    toast(`${t("Could not save")}: ${(e as Error).message}`, "error");
  }
  pinTab(`p:${id}`);
  await refreshProblems([id], { full: "status" in patch });
}

export function patchPart(problemId: string, partId: string, patch: PartPatch): void {
  set((s) => {
    const cur = s.problemCache[problemId];
    if (!cur) return {};
    return {
      problemCache: {
        ...s.problemCache,
        [problemId]: { ...cur, parts: cur.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) },
      },
    };
  });
  pinTab(`p:${problemId}`);
  if (patch.status !== undefined) {
    void (async () => {
      await flushAutosave();
      await repo.updatePart(partId, patch);
      await refreshProblems([problemId], { full: true });
    })();
    return;
  }
  queuePartPatch(problemId, partId, patch);
}

export async function addPart(problemId: string): Promise<void> {
  await flushAutosave();
  await repo.addPart(problemId);
  await refreshProblems([problemId], { full: true });
}

export async function deletePart(problemId: string, partId: string): Promise<void> {
  await flushAutosave();
  await repo.deletePart(partId);
  await refreshProblems([problemId], { full: true });
}

export async function createProblem(init: Partial<NewProblem> = {}): Promise<string> {
  await flushAutosave();
  const s = get();
  const o = s.origin;
  const ctx: Partial<NewProblem> = {};
  if (o.kind === "course" && o.id) ctx.courseId = o.id;
  if (o.kind === "lecture" && o.id) {
    ctx.lectureIds = [o.id];
    ctx.courseId = s.index.lectures.get(o.id)?.courseId ?? null;
  }
  if (o.kind === "topic" && o.id) ctx.topicIds = [o.id];
  if (o.courseId) ctx.courseId = o.courseId;
  if (o.kind === "source" && o.id) ctx.sourceId = o.id;
  const id = await repo.createProblem({ ...ctx, ...init });
  await refreshProblems([id]);
  await openProblem(id, { preview: false });
  set({ selection: [id], focusedId: id });
  return id;
}

export async function duplicateProblem(id: string): Promise<void> {
  await flushAutosave();
  const nid = await repo.duplicateProblem(id);
  await refreshProblems([nid]);
  await openProblem(nid);
  toast(t("Problem duplicated"), "success");
}

export async function setStatus(ids: string[], status: Status): Promise<void> {
  if (!ids.length) return;
  await flushAutosave();
  const before = new Map(get().problems.filter((p) => ids.includes(p.id)).map((p) => [p.id, p.status]));
  await repo.setStatus(ids, status);
  await refreshProblems(ids, { full: true });
  const label = STATUS_LABEL[status];
  toast(ids.length === 1 ? t("Marked as {status}", { status: t(label) }) : t("{n} problems marked as {status}", { n: ids.length, status: t(label) }), "success", {
    label: t("Undo"),
    run: () => {
      void (async () => {
        const byStatus = new Map<Status, string[]>();
        for (const [id, st] of before) byStatus.set(st, [...(byStatus.get(st) ?? []), id]);
        for (const [st, list] of byStatus) await repo.setStatus(list, st);
        await refreshProblems(ids, { full: true });
      })();
    },
  });
}

export async function setReviewDate(ids: string[], date: string | null): Promise<void> {
  await flushAutosave();
  await repo.bulkUpdate(ids, { reviewDue: date });
  await refreshProblems(ids, { full: true });
  toast(date ? t("Review scheduled for {date}", { date: formatDate(date) }) : t("Review date cleared"), "success");
}

export async function bulkUpdate(ids: string[], op: BulkUpdate, message?: string): Promise<void> {
  if (!ids.length) return;
  await flushAutosave();
  await repo.bulkUpdate(ids, op);
  await refreshProblems(ids, { full: true });
  if (message) toast(message, "success");
}

export async function trashProblems(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await flushAutosave();
  await repo.trashProblems(ids);
  updateGroups((groups) => {
    for (const g of groups) {
      g.tabs = g.tabs.filter((tb) => !(tb.kind === "problem" && ids.includes(tb.problemId)));
      if (!g.tabs.some((tb) => tb.id === g.activeId)) g.activeId = g.tabs[0]?.id ?? null;
    }
    return groups;
  });
  await refreshProblems(ids);
  set((s) => ({ selection: s.selection.filter((x) => !ids.includes(x)) }));
  toast(ids.length === 1 ? t("Moved to Trash") : t("{n} problems moved to Trash", { n: ids.length }), "info", {
    label: t("Undo"),
    run: () => void restoreProblems(ids),
  });
}

export async function restoreProblems(ids: string[]): Promise<void> {
  await repo.restoreProblems(ids);
  await refreshProblems(ids);
}

export function purgeProblems(ids: string[]): void {
  confirmDialog({
    title: t("Delete permanently?"),
    message: t("{n} problem(s) and their solutions, attempts and history will be deleted. This cannot be undone.", { n: ids.length }),
    confirmLabel: t("Delete permanently"),
    danger: true,
    onConfirm: async () => {
      await repo.purgeProblems(ids);
      await refreshProblems(ids);
    },
  });
}

export function emptyTrash(): void {
  const n = get().problems.filter((p) => p.deletedAt).length;
  if (!n) return toast(t("The Trash is empty."));
  confirmDialog({
    title: t("Empty Trash?"),
    message: t("{n} problem(s) will be deleted permanently. This cannot be undone.", { n }),
    confirmLabel: t("Empty Trash"),
    danger: true,
    onConfirm: async () => {
      await repo.emptyTrash();
      await reloadProblems();
    },
  });
}

export async function finishAttempt(problemId: string, partId: string | null, outcome: Outcome, note: string, startFresh: boolean): Promise<void> {
  await flushAutosave();
  const p = await loadProblem(problemId, true);
  if (!p) return;
  const content = partId ? (p.parts.find((x) => x.id === partId)?.solution ?? "") : p.solution;
  await repo.addAttempt(problemId, partId, content, outcome, note);
  if (startFresh) {
    if (partId) await repo.updatePart(partId, { solution: "" });
    else await repo.updateProblem(problemId, { solution: "" });
  }
  await refreshProblems([problemId], { full: true });
  toast(t("Attempt recorded"), "success");
}

export async function deleteAttempt(problemId: string, attemptId: string): Promise<void> {
  await repo.deleteAttempt(attemptId);
  await refreshProblems([problemId], { full: true });
}

export async function addAttachments(problemId: string, files?: PickedFile[]): Promise<void> {
  const picked =
    files ??
    (await platform().pickFiles({
      multiple: true,
      filters: [{ name: "Images and documents", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf"] }],
    }));
  for (const f of picked) {
    const bytes = f.path ? null : await f.read();
    const stored = await platform().storeFile("attachments", f.name, bytes, f.path);
    await repo.addAttachment({
      problemId,
      fileName: f.name,
      storedPath: stored.storedPath,
      mime: guessMime(f.name),
      size: stored.size,
      hash: stored.hash,
      caption: "",
    });
  }
  if (picked.length) await refreshProblems([problemId], { full: true });
}

export async function removeAttachment(problemId: string, attachmentId: string): Promise<void> {
  await repo.deleteAttachment(attachmentId);
  await refreshProblems([problemId], { full: true });
}

function guessMime(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" }[e] ??
    "application/octet-stream"
  );
}

// ---------------------------------------------------- courses & taxonomy

export async function createCourse(input: CourseInput): Promise<string> {
  const c = await repo.createCourse(input);
  await reloadEntities();
  set({ activeCourseId: c.id });
  return c.id;
}

export async function updateCourse(id: string, patch: Parameters<Repo["updateCourse"]>[1]): Promise<void> {
  await repo.updateCourse(id, patch);
  await reloadEntities();
}

export async function deleteCourse(id: string, problems: "keep" | "trash"): Promise<void> {
  await flushAutosave();
  await repo.deleteCourse(id, problems);
  if (get().origin.id === id) showAll();
  await reloadAll();
}

export async function createLectures(inputs: LectureInput[]): Promise<Lecture[]> {
  const ls = await repo.createLectures(inputs);
  await reloadEntities();
  return ls;
}

export async function updateLecture(id: string, patch: Parameters<Repo["updateLecture"]>[1]): Promise<void> {
  await repo.updateLecture(id, patch);
  await reloadEntities();
}

export async function moveLecture(id: string, delta: -1 | 1): Promise<void> {
  const l = get().index.lectures.get(id);
  if (!l) return;
  const siblings = get().lectures.filter((x) => x.courseId === l.courseId);
  const i = siblings.findIndex((x) => x.id === id);
  const j = i + delta;
  if (j < 0 || j >= siblings.length) return;
  const order = siblings.map((x) => x.id);
  [order[i], order[j]] = [order[j], order[i]];
  await repo.reorderLectures(order);
  await reloadEntities();
}

export function deleteLecture(id: string): void {
  const l = get().index.lectures.get(id);
  if (!l) return;
  const n = get().problems.filter((p) => p.lectureIds.includes(id) && !p.deletedAt).length;
  confirmDialog({
    title: t("Delete {name}?", { name: lectureLabel(l) }),
    message: n
      ? t("{n} problem(s) are linked to this lecture. They are kept; only the lecture link is removed.", { n })
      : t("The lecture has no problems."),
    confirmLabel: t("Delete lecture"),
    danger: true,
    onConfirm: async () => {
      await repo.deleteLecture(id);
      if (get().origin.id === id) showAll();
      await reloadAll();
    },
  });
}

export async function createTopic(input: TopicInput): Promise<Topic> {
  const tp = await repo.createTopic(input);
  await reloadEntities();
  return tp;
}

export async function updateTopic(id: string, patch: Parameters<Repo["updateTopic"]>[1]): Promise<void> {
  await repo.updateTopic(id, patch);
  await reloadEntities();
}

export function deleteTopic(id: string): void {
  const tp = get().index.topics.get(id);
  if (!tp) return;
  const n = get().problems.filter((p) => p.topicIds.includes(id) && !p.deletedAt).length;
  confirmDialog({
    title: t("Delete topic “{name}”?", { name: tp.name }),
    message: n ? t("The tag is removed from {n} problem(s); the problems themselves are kept.", { n }) : t("No problems use this topic."),
    confirmLabel: t("Delete topic"),
    danger: true,
    onConfirm: async () => {
      await repo.deleteTopic(id);
      if (get().origin.id === id) showAll();
      await reloadAll();
    },
  });
}

export async function updateSource(id: string, patch: Parameters<Repo["updateSource"]>[1]): Promise<void> {
  await repo.updateSource(id, patch);
  await reloadEntities();
}

export function deleteSource(src: Source): void {
  const n = get().problems.filter((p) => p.sourceId === src.id && !p.deletedAt).length;
  confirmDialog({
    title: t("Remove source “{name}”?", { name: src.title }),
    message:
      (n ? t("{n} problem(s) keep their original numbers and pages but lose the link to this source.", { n }) + " " : "") +
      t("The stored copy of the file is kept in the library folder."),
    confirmLabel: t("Remove source"),
    danger: true,
    onConfirm: async () => {
      await repo.deleteSource(src.id);
      if (get().origin.id === src.id) showAll();
      await reloadAll();
    },
  });
}

// ------------------------------------------------------------ saved views

export async function saveView(name: string, id?: string): Promise<void> {
  const s = get();
  const vid = await repo.saveView({ id, name, filter: s.filter, sort: s.sort });
  await reloadEntities();
  set({ activeViewId: vid, origin: { kind: "view", id: vid, label: name } });
  toast(t("View “{name}” saved", { name }), "success");
}

export function deleteView(id: string): void {
  const v = get().views.find((x) => x.id === id);
  if (!v) return;
  confirmDialog({
    title: t("Delete view “{name}”?", { name: v.name }),
    message: t("Only the saved filter is removed; no problems are affected."),
    confirmLabel: t("Delete view"),
    danger: true,
    onConfirm: async () => {
      await repo.deleteView(id);
      if (get().activeViewId === id) showAll();
      await reloadEntities();
    },
  });
}

// ----------------------------------------------------------------- dialogs

export function openDialog(d: DialogSpec): void {
  set({ dialog: d });
}

export function closeDialog(): void {
  set({ dialog: null });
}

export function confirmDialog(opts: Omit<Extract<DialogSpec, { kind: "confirm" }>, "kind">): void {
  set({ dialog: { kind: "confirm", ...opts } });
}

export function promptDialog(opts: Omit<Extract<DialogSpec, { kind: "prompt" }>, "kind">): void {
  set({ dialog: { kind: "prompt", ...opts } });
}

// ------------------------------------------------------------------ import

export const IMPORT_FILTERS = [
  { name: "Supported documents", extensions: ["pdf", "md", "markdown", "tex", "txt", "docx", "json", "png", "jpg", "jpeg", "gif", "webp"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "Markdown / text", extensions: ["md", "markdown", "txt"] },
  { name: "LaTeX", extensions: ["tex"] },
  { name: "Word", extensions: ["docx"] },
  { name: "JSON", extensions: ["json"] },
  { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
];

export async function pickAndImport(): Promise<void> {
  const files = await platform().pickFiles({ multiple: true, filters: IMPORT_FILTERS, title: t("Import exercises") });
  if (files.length) await startImport(files);
}

async function libraryContext(): Promise<LibraryContext> {
  const s = get();
  return {
    courses: s.courses,
    lectures: s.lectures,
    topics: s.topics,
    existing: (await repo.listStatements()).map((x) => ({
      id: x.id,
      label: problemLabel({ title: x.title, sourceNumber: x.sourceNumber, preview: x.statement }),
      statement: x.statement,
    })),
  };
}

let importCounter = 0;

export async function startImport(files: PickedFile[]): Promise<void> {
  if (!files.length) return;
  const backups = files.filter((f) => detectFormat(f.name) === "backup");
  if (backups.length) toast(t("Library backups are restored with File › Restore Library Backup…"), "info");
  const docs = files.filter((f) => detectFormat(f.name) !== "backup");
  if (!docs.length) return;
  const id = `imp${++importCounter}`;
  const session: ImportSession = { id, status: "reading", progress: t("Reading files…"), plans: [], errors: [], activePlan: null, activeCandidate: null, result: null };
  set((s) => ({ imports: { ...s.imports, [id]: session } }));
  openTab({ id: `import:${id}`, kind: "import", importId: id });
  const patch = (p: Partial<ImportSession>) => set((s) => ({ imports: { ...s.imports, [id]: { ...s.imports[id], ...p } } }));
  const ctx = await libraryContext();
  const plans: DocPlan[] = [];
  const errors: ImportSession["errors"] = [];
  for (const [i, f] of docs.entries()) {
    patch({ progress: t("Reading {name} ({i} of {n})…", { name: f.name, i: i + 1, n: docs.length }) });
    try {
      const bytes = await f.read();
      const hash = await sha256Hex(bytes);
      let doc;
      try {
        doc = await extractDocument(f.name, bytes, {
          loadPdfjs,
          onProgress: (m) => patch({ progress: `${f.name}: ${m}` }),
        });
      } catch (e) {
        if (e instanceof LibraryFileError) {
          openDialog({ kind: "library-import", lib: validateLibrary(e.library), name: f.name });
          continue;
        }
        throw e;
      }
      const existing = await repo.findSourcesByHash(hash);
      const plan = planDocument({ fileName: f.name, path: f.path, bytes: f.path ? null : bytes, hash, size: bytes.length, doc }, ctx, existing);
      if (f.path === null) plan.bytes = bytes;
      plans.push(plan);
    } catch (e) {
      errors.push({ name: f.name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!plans.length && !errors.length) {
    await closeTab(get().activeGroup, `import:${id}`);
    return;
  }
  patch({
    status: "review",
    plans,
    errors,
    progress: "",
    activePlan: plans[0]?.key ?? null,
    activeCandidate: null,
  });
}

export function importPatch(importId: string, p: Partial<ImportSession>): void {
  set((s) => ({ imports: { ...s.imports, [importId]: { ...s.imports[importId], ...p } } }));
}

export function updatePlan(importId: string, planKey: string, fn: (plan: DocPlan) => DocPlan): void {
  set((s) => {
    const sess = s.imports[importId];
    if (!sess) return {};
    return { imports: { ...s.imports, [importId]: { ...sess, plans: sess.plans.map((p) => (p.key === planKey ? fn(p) : p)) } } };
  });
}

export function setPlanCourse(importId: string, planKey: string, courseId: string | null): void {
  updatePlan(importId, planKey, (p) => setPlanCourseSync(p, courseId, null));
}

/** Pure variant used inside plan updaters: sets the target course (or a new one) and remaps lectures. */
export function setPlanCourseSync(plan: DocPlan, courseId: string | null, newCourse: { code: string; title: string } | null): DocPlan {
  return mapLectures({ ...plan, newCourse: courseId ? null : newCourse }, courseId, get());
}

export function updateCandidate(importId: string, planKey: string, candKey: string, patch: Partial<Candidate>): void {
  updatePlan(importId, planKey, (p) => ({ ...p, candidates: p.candidates.map((c) => (c.key === candKey ? { ...c, ...patch } : c)) }));
}

export async function commitImport(importId: string): Promise<void> {
  const sess = get().imports[importId];
  if (!sess) return;
  await flushAutosave();
  importPatch(importId, { status: "committing", progress: t("Saving to the library…") });
  try {
    const result = await commitPlans(sess.plans, {
      repo,
      storeFile: (kind, name, bytes, path) => platform().storeFile(kind, name, bytes, path),
    });
    await reloadAll();
    importPatch(importId, { status: "done", result, progress: "" });
    // Close the wizard, show what was imported and preview the first problem.
    const where = get().groups.findIndex((g) => g.tabs.some((x) => x.id === `import:${importId}`));
    if (where >= 0) await closeTab(where, `import:${importId}`);
    if (result.sourceIds.length === 1) showSource(result.sourceIds[0]);
    if (result.problemIds[0]) await openProblem(result.problemIds[0], { preview: true });
    const extra = [
      result.createdCourses ? t("{n} course(s)", { n: result.createdCourses }) : "",
      result.createdLectures ? t("{n} lecture(s)", { n: result.createdLectures }) : "",
      result.createdTopics ? t("{n} topic(s)", { n: result.createdTopics }) : "",
    ].filter(Boolean);
    toast(
      t("Imported {n} problem(s)", { n: result.problemIds.length }) + (extra.length ? ` · ${t("created")} ${extra.join(", ")}` : ""),
      "success",
    );
  } catch (e) {
    importPatch(importId, { status: "review", progress: "" });
    toast(`${t("Import failed")}: ${(e as Error).message}`, "error");
  }
}

// ------------------------------------------------------------------ export

export async function fullProblems(ids: string[]): Promise<Problem[]> {
  await flushAutosave();
  const out: Problem[] = [];
  for (const id of ids) {
    const p = await repo.getProblem(id);
    if (p) out.push(p);
  }
  return out;
}

export async function exportProblems(ids: string[], format: "md" | "tex" | "json", opts: ExportOptions): Promise<void> {
  const problems = await fullProblems(ids);
  const s = get();
  let data: string;
  let filters;
  if (format === "md") {
    data = collectionToMarkdown(problems, s.index, opts);
    filters = [{ name: "Markdown", extensions: ["md"] }];
  } else if (format === "tex") {
    data = collectionToLatex(problems, s.index, opts, s.settings.katexMacros);
    filters = [{ name: "LaTeX", extensions: ["tex"] }];
  } else {
    const lib = await exportLibrary(repo, s.info?.version ?? "1.0.0");
    const keep = new Set(ids);
    const problemsSel = lib.problems.filter((p) => keep.has(p.id));
    const used = (key: "courseId" | "sourceId") => new Set(problemsSel.map((p) => p[key]).filter(Boolean));
    const lecIds = new Set(problemsSel.flatMap((p) => p.lectureIds));
    const topIds = new Set(problemsSel.flatMap((p) => p.topicIds));
    const subset: LibraryJson = {
      ...lib,
      problems: problemsSel,
      courses: lib.courses.filter((c) => used("courseId").has(c.id)),
      lectures: lib.lectures.filter((l) => lecIds.has(l.id)),
      topics: lib.topics.filter((tp) => topIds.has(tp.id) || lib.topics.some((x) => topIds.has(x.id) && x.parentId === tp.id)),
      sources: lib.sources.filter((x) => used("sourceId").has(x.id)),
      savedViews: [],
    };
    data = JSON.stringify(subset, null, 2);
    filters = [{ name: "JSON", extensions: ["json"] }];
  }
  const name = `${safeFileName(opts.title)}.${format}`;
  const path = await platform().saveFile({ defaultName: name, filters, data });
  if (path) toast(t("Exported to {path}", { path }), "success");
}

export async function copyProblemAs(id: string, what: "statement" | "solution" | "full", format: "md" | "tex" = "md"): Promise<void> {
  const [p] = await fullProblems([id]);
  if (!p) return;
  const s = get();
  const opts: ExportOptions = {
    ...DEFAULT_EXPORT,
    title: problemLabel({ title: p.title, sourceNumber: p.sourceNumber, preview: p.statement }),
    includeSolution: what !== "statement",
    includeReference: false,
    includeMetadata: what === "full",
  };
  const text = format === "md" ? problemToMarkdown(p, s.index, opts) : collectionToLatex([p], s.index, opts, s.settings.katexMacros);
  await navigator.clipboard.writeText(text);
  toast(format === "md" ? t("Copied as Markdown") : t("Copied as LaTeX"), "success");
}

export async function exportLibraryJsonFile(): Promise<void> {
  await flushAutosave();
  const lib = await exportLibrary(repo, get().info?.version ?? "1.0.0", { includeTrash: true });
  const path = await platform().saveFile({
    defaultName: `Maree-library-${todayLocal()}.json`,
    filters: [{ name: "Marée library (JSON)", extensions: ["json"] }],
    data: JSON.stringify(lib, null, 2),
  });
  if (path) toast(t("Library exported to {path}", { path }), "success");
}

export async function backupLibrary(): Promise<void> {
  await flushAutosave();
  const lib = await exportLibrary(repo, get().info?.version ?? "1.0.0", { includeTrash: true });
  const path = await platform().saveBackup(`Maree-backup-${todayLocal()}.zip`, JSON.stringify(lib, null, 2));
  if (path) toast(t("Backup written to {path}", { path }), "success");
}

export async function restoreBackup(): Promise<void> {
  try {
    const picked = await platform().pickBackup();
    if (!picked) return;
    const lib = validateLibrary(JSON.parse(picked.contents.libraryJson));
    openDialog({ kind: "library-import", lib, name: picked.name, filesRestored: picked.contents.filesRestored });
  } catch (e) {
    toast(`${t("Could not read backup")}: ${(e as Error).message}`, "error");
  }
}

export async function applyLibraryImport(lib: LibraryJson, mode: "keep" | "overwrite"): Promise<void> {
  await flushAutosave();
  await importLibrary(repo, lib, mode);
  await reloadAll();
  toast(t("Library imported: {n} problems", { n: lib.problems.length }), "success");
}

export async function importLibraryFile(): Promise<void> {
  const [f] = await platform().pickFiles({ multiple: false, filters: [{ name: "Marée library (JSON)", extensions: ["json"] }] });
  if (!f) return;
  try {
    const lib = validateLibrary(JSON.parse(new TextDecoder().decode(await f.read())));
    openDialog({ kind: "library-import", lib, name: f.name });
  } catch (e) {
    toast(`${t("Could not read library")}: ${(e as Error).message}`, "error");
  }
}

// ------------------------------------------------------------------ sample

export async function loadSample(): Promise<void> {
  if (get().hasSample) return toast(t("The sample library is already loaded."));
  await loadSampleLibrary(repo);
  await reloadAll();
  const c = get().courses.find((x) => x.isSample);
  if (c) showCourse(c.id);
  toast(t("Sample library loaded. Remove it any time from Library › Remove Sample Data."), "success");
}

export function removeSample(): void {
  confirmDialog({
    title: t("Remove sample data?"),
    message: t("All sample courses, lectures, topics and problems are deleted. Your own data is not affected."),
    confirmLabel: t("Remove sample data"),
    danger: true,
    onConfirm: async () => {
      await flushAutosave();
      const sampleIds = new Set(get().problems.filter((p) => p.isSample).map((p) => p.id));
      updateGroups((groups) => {
        for (const g of groups) {
          g.tabs = g.tabs.filter((tb) => !(tb.kind === "problem" && sampleIds.has(tb.problemId)));
          if (!g.tabs.some((tb) => tb.id === g.activeId)) g.activeId = g.tabs[0]?.id ?? null;
        }
        return groups;
      });
      await repo.removeSample();
      showAll();
      await reloadAll();
      toast(t("Sample data removed"), "success");
    },
  });
}

// ------------------------------------------------------------------- tools

export async function rebuildSearchIndex(): Promise<void> {
  const n = await repo.reindexAll();
  toast(t("Search index rebuilt ({n} problems)", { n }), "success");
}

export async function snapshotNow(): Promise<void> {
  await flushAutosave();
  const where = await platform().db.snapshot?.("manual");
  toast(where ? t("Snapshot saved: {path}", { path: where }) : t("Snapshots are not available here."), where ? "success" : "info");
}

export function formatDate(d: string | null | undefined): string {
  return fmtDate(d);
}

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) {
    const today = new Date().toDateString() === d.toDateString();
    return today ? t("Today") : t("Yesterday");
  }
  if (days === 1) return t("Yesterday");
  if (days < 7) return t("{n} days ago", { n: days });
  return formatDate(iso);
}

export function categoryOptions(): { value: Category; label: string }[] {
  return [
    { value: "proof", label: t("Proof") },
    { value: "calculation", label: t("Calculation") },
    { value: "conceptual", label: t("Conceptual") },
    { value: "application", label: t("Application") },
  ];
}

// --------------------------------------------------------- test automation

/** Hooks for the automated acceptance test (enabled only with MAREE_E2E=1). */
function exposeTestHooks(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__maree = {
    state: get,
    async importPaths(paths: string[]) {
      const files = await platform().readPaths!(paths);
      await startImport(files);
    },
    async exportLibraryTo(path: string) {
      await flushAutosave();
      const lib = await exportLibrary(repo, get().info?.version ?? "1.0.0", { includeTrash: true });
      await platform().writeFile!(path, JSON.stringify(lib, null, 2));
    },
    async backupTo(path: string) {
      await flushAutosave();
      const lib = await exportLibrary(repo, get().info?.version ?? "1.0.0", { includeTrash: true });
      await platform().writeBackup!(path, JSON.stringify(lib, null, 2));
    },
    async exportMarkdownTo(path: string, ids: string[]) {
      const problems = await fullProblems(ids);
      await platform().writeFile!(path, collectionToMarkdown(problems, get().index, { ...DEFAULT_EXPORT, title: "E2E export" }));
    },
    flush: flushAutosave,
    getProblem: (id: string) => repo.getProblem(id),
    openProblem: (id: string) => openProblem(id, { preview: false }),
    async createProblem(input: NewProblem) {
      const id = await repo.createProblem(input);
      await refreshProblems([id]);
      return id;
    },
  };
}
