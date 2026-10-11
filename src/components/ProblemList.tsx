import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CalendarClock,
  Columns3,
  FileDown,
  Flag,
  GraduationCap,
  Hash,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  Pin,
  Plus,
  Printer,
  RotateCcw,
  Rows3,
  Trash2,
} from "lucide-react";
import { useStore, get, type ColumnKey } from "../state/store";
import * as A from "../state/actions";
import type { ProblemSummary, SortKey } from "../data/types";
import { STATUSES } from "../data/types";
import { applyFilter, problemLabel, sortProblems, type LibraryIndex } from "../domain/filters";
import { reviewGroups } from "../domain/review";
import { CATEGORY_LABEL, DIFFICULTY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../domain/status";
import { todayLocal } from "../data/ids";
import { renderInline, renderMarkdown } from "../math/render";
import { safeTruncate } from "../math/segments";
import { DifficultyMeter, StatusIcon } from "../ui/icons";
import { openContextMenu, openMenuBelow, type MenuItem } from "../ui/Menu";
import { SearchAndFilter } from "./FilterBar";
import { problemMenuItems, reviewDateItems } from "./problemMenu";
import { startProblemDrag } from "./Sidebar";
import { setVisibleIds } from "../commands/bridge";
import { printProblems } from "./print";
import { t } from "../i18n";

interface ColumnDef {
  label: string;
  width: number;
  flex?: boolean;
  sort?: SortKey;
  render: (p: ProblemSummary, index: LibraryIndex, today: string) => ReactNode;
}

const titleCache = new Map<string, string>();
function inlineHtml(src: string): string {
  let h = titleCache.get(src);
  if (h === undefined) {
    h = renderInline(src);
    if (titleCache.size > 3000) titleCache.clear();
    titleCache.set(src, h);
  }
  return h;
}

function ProblemTitle({ p }: { p: ProblemSummary }) {
  const text = p.title || safeTruncate(p.preview.replace(/\s+/g, " "), 140);
  return (
    <>
      {p.pinned && <Pin size={11} className="faint" style={{ flex: "none" }} />}
      {p.sourceNumber && <span className="num">{p.sourceNumber}</span>}
      <span className="ttl" dangerouslySetInnerHTML={{ __html: text ? inlineHtml(text) : `<span class="faint">${t("Untitled problem")}</span>` }} />
      {p.partCount > 0 && (
        <span className="parts" title={t("{done} of {n} parts done", { done: p.partsDone, n: p.partCount })}>
          {p.partsDone}/{p.partCount}
        </span>
      )}
      {p.needsImportReview && (
        <span className="flag" title={t("Imported text needs review")}>
          <AlertTriangle size={12} />
        </span>
      )}
    </>
  );
}

export const COLUMNS: Record<ColumnKey, ColumnDef> = {
  title: { label: "Problem", width: 260, flex: true, sort: "number", render: (p) => <ProblemTitle p={p} /> },
  number: { label: "No.", width: 56, sort: "number", render: (p) => <span className="num">{p.sourceNumber}</span> },
  course: {
    label: "Course",
    width: 96,
    sort: "course",
    render: (p, ix) => {
      const c = p.courseId ? ix.courses.get(p.courseId) : null;
      return c ? <span className="ellipsis">{c.code || c.title}</span> : null;
    },
  },
  lecture: {
    label: "Lecture",
    width: 150,
    sort: "lecture",
    render: (p, ix) => {
      const ls = p.lectureIds.map((id) => ix.lectures.get(id)).filter(Boolean).sort((a, b) => a!.sortOrder - b!.sortOrder);
      if (!ls.length) return null;
      const l = ls[0]!;
      return (
        <span className="ellipsis" title={ls.map((x) => `${x!.number ? `Lecture ${x!.number}` : ""} ${x!.title}`).join("\n")}>
          {l.number && <span className="num">L{l.number}</span>} {l.title}
          {ls.length > 1 && <span className="faint"> +{ls.length - 1}</span>}
        </span>
      );
    },
  },
  topic: {
    label: "Topics",
    width: 170,
    sort: "topic",
    render: (p, ix) => {
      const names = p.topicIds.map((id) => ix.topics.get(id)?.name).filter(Boolean) as string[];
      if (!names.length) return null;
      return (
        <span className="row" style={{ gap: 4, overflow: "hidden" }} title={names.join(", ")}>
          <span className="topic-pill">{names[0]}</span>
          {names.length > 1 && <span className="faint" style={{ fontSize: 11 }}>+{names.length - 1}</span>}
        </span>
      );
    },
  },
  difficulty: {
    label: "Difficulty",
    width: 76,
    sort: "difficulty",
    render: (p) => (p.difficulty ? <span title={t(DIFFICULTY_LABEL[p.difficulty])}><DifficultyMeter value={p.difficulty} /></span> : null),
  },
  status: {
    label: "Status",
    width: 124,
    sort: "status",
    render: (p) => (
      <>
        <StatusIcon status={p.status} />
        <span className="ellipsis">{t(STATUS_LABEL[p.status])}</span>
      </>
    ),
  },
  category: { label: "Type", width: 96, sort: "category", render: (p) => (p.category ? t(CATEGORY_LABEL[p.category]) : null) },
  priority: {
    label: "Priority",
    width: 72,
    sort: "priority",
    render: (p) => (p.priority ? <span title={t(PRIORITY_LABEL[p.priority])} style={{ color: p.priority >= 3 ? "var(--accent)" : "var(--text-2)" }}><Flag size={12} /> {t(PRIORITY_LABEL[p.priority])}</span> : null),
  },
  source: {
    label: "Source",
    width: 150,
    sort: "source",
    render: (p, ix) => {
      const s = p.sourceId ? ix.sources.get(p.sourceId) : null;
      return s ? <span className="ellipsis" title={s.title}>{s.title}{p.sourcePage ? <span className="faint"> · p.{p.sourcePage}</span> : null}</span> : null;
    },
  },
  lastAttempt: { label: "Last Attempt", width: 104, sort: "lastAttempt", render: (p) => <span className="muted">{A.relativeDate(p.lastAttemptAt)}</span> },
  reviewDue: {
    label: "Review",
    width: 96,
    sort: "reviewDue",
    render: (p, _ix, today) => (p.reviewDue ? <span className={p.reviewDue <= today ? "due-past" : "muted"}>{A.formatDate(p.reviewDue)}</span> : null),
  },
  updated: { label: "Modified", width: 104, sort: "updated", render: (p) => <span className="muted">{A.relativeDate(p.updatedAt)}</span> },
};

const ALL_COLUMNS = Object.keys(COLUMNS) as ColumnKey[];

function useVisibleProblems(): ProblemSummary[] {
  const problems = useStore((s) => s.problems);
  const filter = useStore((s) => s.filter);
  const hits = useStore((s) => s.searchHits);
  const sort = useStore((s) => s.sort);
  const index = useStore((s) => s.index);
  const mode = useStore((s) => s.listMode);
  return useMemo(() => {
    const today = todayLocal();
    if (mode === "trash") return problems.filter((p) => p.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
    if (mode === "recent") {
      const live = applyFilter(problems, filter, { index, searchHits: hits, today });
      return [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 60);
    }
    if (mode === "review") {
      const live = applyFilter(problems, filter, { index, searchHits: hits, today });
      return reviewGroups(live, today).flatMap((g) => g.problems);
    }
    return sortProblems(applyFilter(problems, filter, { index, searchHits: hits, today }), sort, index, hits);
  }, [problems, filter, hits, sort, index, mode]);
}

/** Two-line row used when the list column is narrow (the usual three-pane layout). */
const CompactRow = memo(function CompactRow({
  p,
  index,
  today,
  selected,
  focused,
  top,
  onMouseDown,
  onDoubleClick,
  onContext,
  onDragStart,
  flat,
}: {
  p: ProblemSummary;
  index: LibraryIndex;
  today: string;
  selected: boolean;
  focused: boolean;
  top: number;
  flat?: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
  onContext: (e: React.MouseEvent, id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  const lec = p.lectureIds
    .map((id) => index.lectures.get(id))
    .filter(Boolean)
    .sort((a, b) => a!.sortOrder - b!.sortOrder)[0];
  const topics = p.topicIds.map((id) => index.topics.get(id)?.name).filter(Boolean) as string[];
  const course = p.courseId ? index.courses.get(p.courseId) : null;
  const due = !!p.reviewDue && p.reviewDue <= today;
  return (
    <div
      className={`lp-row compact${flat ? " lp-flat-row" : ""}${selected ? " selected" : ""}${focused ? " focused" : ""}${p.deletedAt ? " trashed" : ""}`}
      style={flat ? undefined : { top }}
      role="row"
      aria-selected={selected}
      data-id={p.id}
      draggable
      onMouseDown={(e) => onMouseDown(e, p.id)}
      onDoubleClick={() => onDoubleClick(p.id)}
      onContextMenu={(e) => onContext(e, p.id)}
      onDragStart={(e) => onDragStart(e, p.id)}
    >
      <StatusIcon status={p.status} />
      <div className="lp-compact-main">
        <div className="lp-compact-title">
          <ProblemTitle p={p} />
        </div>
        <div className="lp-compact-meta">
          {course && <span>{course.code || course.title}</span>}
          {lec && <span>{lec.number ? `L${lec.number}` : lec.title}</span>}
          {topics.length > 0 && <span className="ellipsis">{topics.join(", ")}</span>}
          {p.reviewDue && <span className={due ? "due-past" : ""}>{t("review {date}", { date: A.formatDate(p.reviewDue) })}</span>}
          {!p.reviewDue && p.lastAttemptAt && <span>{A.relativeDate(p.lastAttemptAt)}</span>}
        </div>
      </div>
      {p.difficulty ? <DifficultyMeter value={p.difficulty} /> : null}
    </div>
  );
});

export function sortMenu(): MenuItem[] {
  const cur = get().sort;
  const opt = (key: SortKey | null, label: string): MenuItem => ({
    label: t(label),
    checked: (cur?.key ?? null) === key ? true : undefined,
    onSelect: () => {
      if (key === null) {
        useStore.setState({ sort: null });
        void A.repo.setSetting("sort", null);
      } else if (cur?.key !== key) A.setSort(key);
    },
  });
  return [
    { heading: t("Sort by") },
    opt(null, "Library order (course, lecture, number)"),
    opt("number", "Original number"),
    opt("title", "Title"),
    opt("lecture", "Lecture"),
    opt("status", "Status"),
    opt("difficulty", "Difficulty"),
    opt("lastAttempt", "Last attempt"),
    opt("reviewDue", "Review date"),
    opt("updated", "Last modified"),
    opt("created", "Date added"),
    { separator: true },
    {
      label: cur?.dir === "desc" ? t("Ascending") : t("Descending"),
      disabled: !cur,
      onSelect: () => {
        if (cur) A.setSort(cur.key);
      },
    },
  ];
}

const Row = memo(function Row({
  p,
  columns,
  index,
  today,
  selected,
  focused,
  top,
  onMouseDown,
  onDoubleClick,
  onContext,
  onDragStart,
}: {
  p: ProblemSummary;
  columns: ColumnKey[];
  index: LibraryIndex;
  today: string;
  selected: boolean;
  focused: boolean;
  top: number;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
  onContext: (e: React.MouseEvent, id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  return (
    <div
      className={`lp-row${selected ? " selected" : ""}${focused ? " focused" : ""}${p.deletedAt ? " trashed" : ""}`}
      style={{ top }}
      role="row"
      aria-selected={selected}
      data-id={p.id}
      draggable
      onMouseDown={(e) => onMouseDown(e, p.id)}
      onDoubleClick={() => onDoubleClick(p.id)}
      onContextMenu={(e) => onContext(e, p.id)}
      onDragStart={(e) => onDragStart(e, p.id)}
    >
      {columns.map((c) => {
        const def = COLUMNS[c];
        return (
          <div key={c} className="lp-cell" role="cell" style={def.flex ? { flex: `1 0 ${def.width}px` } : { width: def.width, flex: "none" }}>
            {def.render(p, index, today)}
          </div>
        );
      })}
    </div>
  );
});

function TableView({ list, onOpen }: { list: ProblemSummary[]; onOpen: (id: string, preview: boolean) => void }) {
  const columns = useStore((s) => s.layout.columns);
  const index = useStore((s) => s.index);
  const selection = useStore((s) => s.selection);
  const focusedId = useStore((s) => s.focusedId);
  const sort = useStore((s) => s.sort);
  const mode = useStore((s) => s.listMode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayLocal();
  const ids = useMemo(() => list.map((p) => p.id), [list]);
  const [width, setWidth] = useState(1000);
  const compact = width < 640;
  const rowH = compact ? 50 : 30;
  const virt = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12 });
  const sel = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => virt.measure(), [compact, virt]);

  useEffect(() => {
    if (!focusedId) return;
    const i = ids.indexOf(focusedId);
    if (i >= 0) virt.scrollToIndex(i, { align: "auto" });
  }, [focusedId, ids, virt]);

  const onMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    if (e.shiftKey) A.selectProblem(id, "range", ids);
    else if (e.ctrlKey || e.metaKey) A.selectProblem(id, "toggle", ids);
    else {
      if (!sel.has(id) || selection.length === 1) A.selectProblem(id, "single", ids);
      if (mode !== "trash") onOpen(id, true);
    }
  };
  const onContext = (e: React.MouseEvent, id: string) => {
    let target = selection;
    if (!sel.has(id)) {
      A.selectProblem(id, "single", ids);
      target = [id];
    }
    openContextMenu(e, problemMenuItems(target, { inTrash: mode === "trash" }));
  };
  const onDragStart = (e: React.DragEvent, id: string) => startProblemDrag(e, sel.has(id) ? selection : [id]);
  const tableWidth = columns.reduce((w, c) => w + COLUMNS[c].width, 0);

  return (
    <div
      ref={scrollRef}
      className="lp-body"
      tabIndex={0}
      role="grid"
      aria-rowcount={list.length}
      onKeyDown={(e) => listKeys(e, ids, onOpen)}
    >
      <div className="lp-table" style={{ minWidth: compact ? undefined : tableWidth }}>
        {!compact && (
        <div className="lp-headrow" role="row" onContextMenu={(e) => openContextMenu(e, columnMenu())}>
          {columns.map((c) => {
            const def = COLUMNS[c];
            const sorted = sort && def.sort === sort.key;
            return (
              <button
                key={c}
                className={`lp-th${sorted ? " sorted" : ""}`}
                style={def.flex ? { flex: `1 0 ${def.width}px` } : { width: def.width, flex: "none" }}
                onClick={() => def.sort && A.setSort(def.sort)}
                title={t("Sort by {col}", { col: t(def.label) })}
              >
                {t(def.label)}
                {sorted && (sort!.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
              </button>
            );
          })}
        </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const p = list[v.index];
            if (compact) {
              return (
                <CompactRow
                  key={p.id}
                  p={p}
                  index={index}
                  today={today}
                  selected={sel.has(p.id)}
                  focused={focusedId === p.id}
                  top={v.start}
                  onMouseDown={onMouseDown}
                  onDoubleClick={(id) => onOpen(id, false)}
                  onContext={onContext}
                  onDragStart={onDragStart}
                />
              );
            }
            return (
              <Row
                key={p.id}
                p={p}
                columns={columns}
                index={index}
                today={today}
                selected={sel.has(p.id)}
                focused={focusedId === p.id}
                top={v.start}
                onMouseDown={onMouseDown}
                onDoubleClick={(id) => onOpen(id, false)}
                onContext={onContext}
                onDragStart={onDragStart}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function listKeys(e: React.KeyboardEvent, ids: string[], onOpen: (id: string, preview: boolean) => void) {
  const s = get();
  const cur = ids.indexOf(s.focusedId ?? "");
  const move = (to: number) => {
    const i = Math.max(0, Math.min(ids.length - 1, to));
    if (!ids[i]) return;
    if (e.shiftKey) A.selectProblem(ids[i], "range", ids);
    else {
      A.selectProblem(ids[i], "single", ids);
      if (s.listMode !== "trash") onOpen(ids[i], true);
    }
  };
  switch (e.key) {
    case "ArrowDown":
    case "j":
      e.preventDefault();
      move(cur + 1);
      break;
    case "ArrowUp":
    case "k":
      e.preventDefault();
      move(cur < 0 ? 0 : cur - 1);
      break;
    case "Home":
      e.preventDefault();
      move(0);
      break;
    case "End":
      e.preventDefault();
      move(ids.length - 1);
      break;
    case "PageDown":
      e.preventDefault();
      move(cur + 15);
      break;
    case "PageUp":
      e.preventDefault();
      move(cur - 15);
      break;
    case "Enter":
      e.preventDefault();
      if (s.focusedId) {
        if (s.listMode === "trash") void A.restoreProblems([s.focusedId]);
        else onOpen(s.focusedId, false);
      }
      break;
    case "Delete":
      e.preventDefault();
      if (s.selection.length) {
        if (s.listMode === "trash") A.purgeProblems(s.selection);
        else void A.trashProblems(s.selection);
      }
      break;
    case "a":
      if (e.ctrlKey) {
        e.preventDefault();
        useStore.setState({ selection: ids });
      }
      break;
    case "Escape":
      useStore.setState({ selection: s.focusedId ? [s.focusedId] : [] });
      break;
  }
}

function columnMenu(): MenuItem[] {
  const cols = get().layout.columns;
  return [
    { heading: t("Columns") },
    ...ALL_COLUMNS.filter((c) => c !== "title").map((c) => ({
      label: t(COLUMNS[c].label),
      checked: cols.includes(c),
      onSelect: () => {
        const next = cols.includes(c) ? cols.filter((x) => x !== c) : ALL_COLUMNS.filter((x) => x === c || cols.includes(x));
        A.updateLayout({ columns: next.includes("title") ? next : ["title", ...next] });
      },
    })),
    { separator: true },
    { label: t("Reset Columns"), onSelect: () => A.updateLayout({ columns: ["title", "lecture", "topic", "difficulty", "status", "lastAttempt"] }) },
  ];
}

function CardView({ list, onOpen }: { list: ProblemSummary[]; onOpen: (id: string, preview: boolean) => void }) {
  const index = useStore((s) => s.index);
  const selection = useStore((s) => s.selection);
  const [limit, setLimit] = useState(120);
  const ids = useMemo(() => list.map((p) => p.id), [list]);
  return (
    <div className="lp-body" tabIndex={0} onKeyDown={(e) => listKeys(e, ids, onOpen)}>
      <div className="lp-cards">
        {list.slice(0, limit).map((p) => {
          const course = p.courseId ? index.courses.get(p.courseId) : null;
          const lec = p.lectureIds.map((id) => index.lectures.get(id)).filter(Boolean)[0];
          return (
            <button
              key={p.id}
              className={`card${selection.includes(p.id) ? " selected" : ""}`}
              draggable
              onDragStart={(e) => startProblemDrag(e, selection.includes(p.id) ? selection : [p.id])}
              onClick={(e) => {
                if (e.ctrlKey) A.selectProblem(p.id, "toggle", ids);
                else if (e.shiftKey) A.selectProblem(p.id, "range", ids);
                else {
                  A.selectProblem(p.id, "single", ids);
                  onOpen(p.id, true);
                }
              }}
              onDoubleClick={() => onOpen(p.id, false)}
              onContextMenu={(e) => openContextMenu(e, problemMenuItems(selection.includes(p.id) ? selection : [p.id]))}
            >
              <div className="card-head">
                <StatusIcon status={p.status} />
                <span className="ellipsis" dangerouslySetInnerHTML={{ __html: inlineHtml(problemLabel(p)) }} />
              </div>
              <div className="card-body prose-mini" dangerouslySetInnerHTML={{ __html: renderMarkdown(safeTruncate(p.preview, 320)) }} />
              <div className="card-foot">
                {course && (
                  <span className="row" style={{ gap: 3 }}>
                    <GraduationCap size={12} /> {course.code || course.title}
                  </span>
                )}
                {lec && <span>L{lec.number}</span>}
                {p.topicIds.slice(0, 2).map((id) => (
                  <span key={id} className="topic-pill">
                    {index.topics.get(id)?.name}
                  </span>
                ))}
                <span className="grow" />
                {p.difficulty && <DifficultyMeter value={p.difficulty} />}
              </div>
            </button>
          );
        })}
      </div>
      {list.length > limit && (
        <div className="row" style={{ justifyContent: "center", padding: 12 }}>
          <button className="btn" onClick={() => setLimit(limit + 200)}>
            {t("Show more ({n} remaining)", { n: list.length - limit })}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewView({ onOpen }: { onOpen: (id: string, preview: boolean) => void }) {
  const problems = useStore((s) => s.problems);
  const filter = useStore((s) => s.filter);
  const hits = useStore((s) => s.searchHits);
  const index = useStore((s) => s.index);
  const selection = useStore((s) => s.selection);
  const focusedId = useStore((s) => s.focusedId);
  const today = todayLocal();
  const groups = useMemo(
    () => reviewGroups(applyFilter(problems, filter, { index, searchHits: hits, today }), today),
    [problems, filter, hits, index, today],
  );
  const ids = groups.flatMap((g) => g.problems.map((p) => p.id));
  if (!groups.length) {
    return (
      <div className="lp-body">
        <div className="empty-state">
          <Rows3 size={28} strokeWidth={1.3} />
          <div className="title">{t("Nothing to review")}</div>
          <p>{t("Problems appear here when they are marked Needs Review, have a review date, or have an incorrect or incomplete attempt.")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="lp-body" tabIndex={0} onKeyDown={(e) => listKeys(e, ids, onOpen)}>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="lp-group-head">
            {t(g.title)} <span className="hint">{g.problems.length} · {t(g.hint)}</span>
          </div>
          {g.problems.map((p) => (
            <CompactRow
              key={p.id}
              flat
              p={p}
              index={index}
              today={today}
              selected={selection.includes(p.id)}
              focused={focusedId === p.id}
              top={0}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                if (e.ctrlKey) A.selectProblem(p.id, "toggle", ids);
                else if (e.shiftKey) A.selectProblem(p.id, "range", ids);
                else {
                  A.selectProblem(p.id, "single", ids);
                  onOpen(p.id, true);
                }
              }}
              onDoubleClick={() => onOpen(p.id, false)}
              onContext={(e) => openContextMenu(e, problemMenuItems(selection.includes(p.id) ? selection : [p.id]))}
              onDragStart={(e) => startProblemDrag(e, selection.includes(p.id) ? selection : [p.id])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function BulkBar({ ids, trash }: { ids: string[]; trash: boolean }) {
  const s = get();
  if (trash) {
    return (
      <div className="bulkbar">
        <span className="count">{t("{n} selected", { n: ids.length })}</span>
        <button className="btn btn-sm" onClick={() => A.restoreProblems(ids)}>
          <RotateCcw size={13} /> {t("Restore")}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => A.purgeProblems(ids)}>
          {t("Delete permanently")}
        </button>
      </div>
    );
  }
  const btn = (label: string, icon: ReactNode, items: () => MenuItem[]) => (
    <button className="btn btn-sm btn-ghost" onClick={(e) => openMenuBelow(e.currentTarget, items())}>
      {icon} {label}
    </button>
  );
  return (
    <div className="bulkbar" role="toolbar" aria-label={t("Bulk actions")}>
      <span className="count">{t("{n} selected", { n: ids.length })}</span>
      {btn(t("Status"), <ListChecks size={13} />, () =>
        STATUSES.map((st) => ({ label: t(STATUS_LABEL[st]), icon: <StatusIcon status={st} />, onSelect: () => A.setStatus(ids, st) })),
      )}
      {btn(t("Lecture"), <Hash size={13} />, () =>
        s.lectures.map((l) => ({
          label: `${s.index.courses.get(l.courseId)?.code ?? ""} · ${l.number ? `L${l.number}` : ""} ${l.title}`,
          onSelect: () => A.bulkUpdate(ids, { addLectureIds: [l.id], courseId: l.courseId }, t("Added to lecture")),
        })),
      )}
      {btn(t("Topic"), <Hash size={13} />, () =>
        s.topics.map((tp) => ({ label: tp.name, onSelect: () => A.bulkUpdate(ids, { addTopicIds: [tp.id] }, t("Tagged with {name}", { name: tp.name })) })),
      )}
      {btn(t("Course"), <GraduationCap size={13} />, () => [
        ...s.courses.map((c) => ({ label: c.code || c.title, onSelect: () => A.bulkUpdate(ids, { courseId: c.id }, t("Course updated")) })),
        { separator: true },
        { label: t("No course"), onSelect: () => A.bulkUpdate(ids, { courseId: null }) },
      ])}
      {btn(t("Difficulty"), <Rows3 size={13} />, () => [
        ...[1, 2, 3, 4].map((d) => ({ label: `${d} — ${t(DIFFICULTY_LABEL[d])}`, onSelect: () => A.bulkUpdate(ids, { difficulty: d }) })),
        { label: t("None"), onSelect: () => A.bulkUpdate(ids, { difficulty: null }) },
      ])}
      {btn(t("Review"), <CalendarClock size={13} />, () => reviewDateItems(ids))}
      <span className="grow" />
      <button className="icon-btn" title={t("Export…")} onClick={() => A.openDialog({ kind: "export", problemIds: ids, title: t("{n} problems", { n: ids.length }) })}>
        <FileDown size={15} />
      </button>
      <button className="icon-btn" title={t("Print…")} onClick={() => printProblems(ids, t("{n} problems", { n: ids.length }))}>
        <Printer size={15} />
      </button>
      <button className="icon-btn" title={t("Move to Trash")} onClick={() => A.trashProblems(ids)}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export function ProblemList() {
  const list = useVisibleProblems();
  const origin = useStore((s) => s.origin);
  const mode = useStore((s) => s.listMode);
  const view = useStore((s) => s.layout.listView);
  const selection = useStore((s) => s.selection);
  const total = useStore((s) => s.problems.filter((p) => !p.deletedAt).length);
  const activeViewId = useStore((s) => s.activeViewId);
  const sortActive = useStore((s) => s.sort !== null);

  useEffect(() => setVisibleIds(list.map((p) => p.id)), [list]);

  const onOpen = (id: string, preview: boolean) => void A.openProblem(id, { preview });
  const title = mode === "review" ? t("Review Queue") : mode === "recent" ? t("Recently Edited") : mode === "trash" ? t("Trash") : t(origin.label);

  const moreMenu = (): MenuItem[] => [
    { label: t("New Problem"), shortcut: "Ctrl+N", onSelect: () => A.createProblem() },
    { separator: true },
    { label: t("Select All"), shortcut: "Ctrl+A", onSelect: () => useStore.setState({ selection: list.map((p) => p.id) }) },
    { label: t("Export List…"), onSelect: () => A.openDialog({ kind: "export", problemIds: list.map((p) => p.id), title }) },
    { label: t("Print List…"), onSelect: () => printProblems(list.map((p) => p.id), title) },
    { separator: true },
    { label: activeViewId ? t("Update Saved View") : t("Save as View…"), onSelect: () => (activeViewId ? A.saveView(origin.label, activeViewId) : A.openDialog({ kind: "save-view" })) },
    { label: t("Columns"), submenu: columnMenu() },
    ...(mode === "trash" ? [{ separator: true }, { label: t("Empty Trash…"), danger: true, onSelect: A.emptyTrash }] : []),
  ];

  let body: ReactNode;
  if (mode === "review") body = <ReviewView onOpen={onOpen} />;
  else if (!list.length) {
    body = (
      <div className="lp-body">
        <div className="empty-state">
          {total === 0 && mode === "filter" ? (
            <>
              <div className="title">{t("Your library is empty")}</div>
              <p>{t("Create a problem, import a PDF or LaTeX file, or drop files anywhere in the window.")}</p>
              <div className="row">
                <button className="btn btn-primary" onClick={() => A.createProblem()}>
                  <Plus size={14} /> {t("New Problem")}
                </button>
                <button className="btn" onClick={() => A.pickAndImport()}>
                  {t("Import…")}
                </button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => A.loadSample()}>
                {t("Load the sample library")}
              </button>
            </>
          ) : mode === "trash" ? (
            <>
              <Trash2 size={26} strokeWidth={1.3} />
              <div className="title">{t("The Trash is empty")}</div>
            </>
          ) : (
            <>
              <div className="title">{t("No matching problems")}</div>
              <p>{t("Try removing a filter or searching for a different term.")}</p>
              {origin.kind !== "all" && origin.kind !== "custom" && (
                <button className="btn btn-sm" onClick={() => A.createProblem()}>
                  <Plus size={13} /> {t("New problem here")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  } else if (view === "cards" && mode !== "trash") body = <CardView list={list} onOpen={onOpen} />;
  else body = <TableView list={list} onOpen={onOpen} />;

  return (
    <section className="listpane" aria-label={t("Problems")}>
      <div className="lp-header">
        <div className="lp-title-row">
          <span className="lp-title" title={title}>
            {title}
          </span>
          <span className="lp-count">{list.length}</span>
          <span className="grow" />
          {mode !== "trash" && (
            <button className="icon-btn" title={t("New Problem (Ctrl+N)")} onClick={() => A.createProblem()}>
              <Plus size={16} />
            </button>
          )}
          {mode === "filter" && (
            <button className={`icon-btn${sortActive ? " active" : ""}`} title={t("Sort")} onClick={(e) => openMenuBelow(e.currentTarget, sortMenu())}>
              <ArrowDownUp size={15} />
            </button>
          )}
          <button
            className="icon-btn"
            title={view === "table" ? t("Card view") : t("Table view")}
            onClick={() => A.updateLayout({ listView: view === "table" ? "cards" : "table" })}
          >
            {view === "table" ? <LayoutGrid size={15} /> : <Columns3 size={15} />}
          </button>
          <button className="icon-btn" title={t("More")} onClick={(e) => openMenuBelow(e.currentTarget, moreMenu())}>
            <MoreHorizontal size={16} />
          </button>
        </div>
        <SearchAndFilter />
      </div>
      {body}
      {selection.length > 1 && <BulkBar ids={selection} trash={mode === "trash"} />}
    </section>
  );
}
