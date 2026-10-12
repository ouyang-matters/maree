import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FileType2,
  Filter,
  GraduationCap,
  Hash,
  Image as ImageIcon,
  Inbox,
  NotebookText,
  Plus,
  Trash2,
  Images,
  MessageSquareShare,
} from "lucide-react";
import { openInbox } from "../state/inbox";
import { openTray } from "../state/tray";
import { useStore, get } from "../state/store";
import * as A from "../state/actions";
import { openContextMenu, type MenuItem } from "../ui/Menu";
import { reviewGroups } from "../domain/review";
import { todayLocal } from "../data/ids";
import { courseLabel, lectureLabel } from "../domain/filters";
import { printProblems } from "./print";
import { t } from "../i18n";
import type { Source, Topic } from "../data/types";

const DRAG_TYPE = "application/x-maree-problems";

export function draggedProblemIds(e: React.DragEvent): string[] | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return null;
  }
}

export function startProblemDrag(e: React.DragEvent, ids: string[]): void {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "copyLink";
  const ghost = document.createElement("div");
  ghost.textContent = ids.length === 1 ? t("1 problem") : t("{n} problems", { n: ids.length });
  ghost.style.cssText =
    "position:fixed;top:-100px;padding:4px 10px;border-radius:6px;background:var(--accent);color:var(--accent-text);font:500 12px var(--font-ui)";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  setTimeout(() => ghost.remove(), 0);
}

function useDrop(onDropIds: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "link";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const ids = draggedProblemIds(e);
        if (ids?.length) {
          e.preventDefault();
          onDropIds(ids);
        }
      },
    },
  };
}

function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useStore((s) => !!s.layout.collapsed[id]);
  return (
    <section className="sb-section">
      <div className="sb-head">
        <button
          className="toggle"
          aria-expanded={!collapsed}
          onClick={() => A.updateLayout({ collapsed: { ...get().layout.collapsed, [id]: !collapsed } })}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {title}
        </button>
        <div className="actions">{actions}</div>
      </div>
      {!collapsed && children}
    </section>
  );
}

function Item({
  icon,
  label,
  count,
  active,
  onClick,
  onContext,
  onDropIds,
  depth = 0,
  chevron,
  className = "",
  title,
  extra,
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: number | string;
  active?: boolean;
  onClick: () => void;
  onContext?: (e: React.MouseEvent) => void;
  onDropIds?: (ids: string[]) => void;
  depth?: number;
  chevron?: ReactNode;
  className?: string;
  title?: string;
  extra?: ReactNode;
}) {
  const drop = useDrop(onDropIds ?? (() => undefined));
  return (
    <button
      className={`sb-item${active ? " active" : ""}${drop.over ? " drop-target" : ""} ${className}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onClick}
      onContextMenu={onContext}
      title={title}
      {...(onDropIds ? drop.props : {})}
    >
      {chevron}
      {icon && <span className="sb-icon">{icon}</span>}
      <span className="label">{label}</span>
      {extra}
      {count !== undefined && count !== 0 && <span className="count">{count}</span>}
    </button>
  );
}

function SourceIcon({ src }: { src: Source }) {
  if (src.format === "pdf") return <FileText size={14} />;
  if (src.format === "image") return <ImageIcon size={14} />;
  if (src.format === "latex" || src.format === "markdown") return <FileType2 size={14} />;
  return <NotebookText size={14} />;
}

export function Sidebar() {
  const problems = useStore((s) => s.problems);
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const topics = useStore((s) => s.topics);
  const sources = useStore((s) => s.sources);
  const views = useStore((s) => s.views);
  const origin = useStore((s) => s.origin);
  const listMode = useStore((s) => s.listMode);
  const activeViewId = useStore((s) => s.activeViewId);
  const layoutCollapsed = useStore((s) => s.layout.collapsed);
  const inboxCount = useStore((s) => s.inbox.length);
  const phoneOn = useStore((s) => !!s.phone.status);
  const inboxInFront = useStore((s) => {
    const g = s.groups[s.activeGroup];
    return g?.tabs.find((x) => x.id === g.activeId)?.kind === "inbox";
  });
  const trayInFront = useStore((s) => {
    const g = s.groups[s.activeGroup];
    return g?.tabs.find((x) => x.id === g.activeId)?.kind === "tray";
  });
  const tray = useStore((s) => s.settings.chatTray);
  const trayCount = useMemo(() => {
    const live = new Set(problems.filter((p) => !p.deletedAt).map((p) => p.id));
    return tray.filter((id) => live.has(id)).length;
  }, [tray, problems]);
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);

  const counts = useMemo(() => {
    const live = problems.filter((p) => !p.deletedAt);
    const by = (key: (p: (typeof live)[number]) => string[] | string | null) => {
      const m = new Map<string, number>();
      for (const p of live) {
        const k = key(p);
        for (const x of Array.isArray(k) ? k : k ? [k] : []) m.set(x, (m.get(x) ?? 0) + 1);
      }
      return m;
    };
    const review = reviewGroups(live, todayLocal())
      .filter((g) => g.key === "due" || g.key === "needs_review" || g.key === "struggling")
      .reduce((n, g) => n + g.problems.length, 0);
    return {
      all: live.length,
      trash: problems.length - live.length,
      review,
      importReview: live.filter((p) => p.needsImportReview).length,
      course: by((p) => p.courseId),
      lecture: by((p) => p.lectureIds),
      topic: by((p) => p.topicIds),
      source: by((p) => p.sourceId),
    };
  }, [problems]);

  const liveCourses = courses.filter((c) => !c.archived);
  const archived = courses.filter((c) => c.archived);

  const isActive = (kind: string, id?: string) =>
    listMode === "filter" && origin.kind === kind && (id === undefined || origin.id === id) && !origin.courseId;
  const collapsed = (key: string, byDefault = false) => layoutCollapsed[key] ?? byDefault;
  const toggle = (key: string, byDefault = false) =>
    A.updateLayout({ collapsed: { ...get().layout.collapsed, [key]: !collapsed(key, byDefault) } });

  const courseMenu = (e: React.MouseEvent, id: string) => {
    const c = courses.find((x) => x.id === id)!;
    const ids = problems.filter((p) => p.courseId === id && !p.deletedAt).map((p) => p.id);
    openContextMenu(e, [
      { label: t("Edit Course…"), onSelect: () => A.openDialog({ kind: "course", courseId: id }) },
      { label: t("Add Lectures…"), onSelect: () => A.openDialog({ kind: "lectures-bulk", courseId: id }) },
      { label: t("New Topic…"), onSelect: () => A.openDialog({ kind: "topic" }) },
      { label: t("New Problem in Course"), onSelect: () => A.createProblem({ courseId: id }) },
      { separator: true },
      { label: t("Export Course…"), onSelect: () => A.openDialog({ kind: "export", problemIds: ids, title: courseLabel(c) }) },
      { label: t("Print Course…"), onSelect: () => printProblems(ids, courseLabel(c)) },
      { separator: true },
      { label: c.archived ? t("Unarchive") : t("Archive"), onSelect: () => A.updateCourse(id, { archived: !c.archived }) },
      { label: t("Delete Course…"), danger: true, onSelect: () => A.openDialog({ kind: "delete-course", courseId: id }) },
    ]);
  };

  const lectureMenu = (e: React.MouseEvent, id: string) => {
    const l = lectures.find((x) => x.id === id)!;
    const ids = problems.filter((p) => p.lectureIds.includes(id) && !p.deletedAt).map((p) => p.id);
    openContextMenu(e, [
      { label: t("Edit Lecture…"), onSelect: () => A.openDialog({ kind: "lecture", lectureId: id }) },
      { label: t("New Problem in Lecture"), onSelect: () => A.createProblem({ courseId: l.courseId, lectureIds: [id] }) },
      { separator: true },
      { label: t("Move Up"), onSelect: () => A.moveLecture(id, -1) },
      { label: t("Move Down"), onSelect: () => A.moveLecture(id, 1) },
      { separator: true },
      { label: t("Export Lecture…"), onSelect: () => A.openDialog({ kind: "export", problemIds: ids, title: lectureLabel(l) }) },
      { label: t("Print Lecture…"), onSelect: () => printProblems(ids, lectureLabel(l)) },
      { separator: true },
      { label: t("Delete Lecture…"), danger: true, onSelect: () => A.deleteLecture(id) },
    ]);
  };

  const topicMenu = (e: React.MouseEvent, tp: Topic) => {
    const ids = problems.filter((p) => p.topicIds.includes(tp.id) && !p.deletedAt).map((p) => p.id);
    openContextMenu(e, [
      { label: t("Edit Topic…"), onSelect: () => A.openDialog({ kind: "topic", topicId: tp.id }) },
      { label: t("Add Subtopic…"), onSelect: () => A.openDialog({ kind: "topic", parentId: tp.id }) },
      { separator: true },
      { label: t("Export Topic…"), onSelect: () => A.openDialog({ kind: "export", problemIds: ids, title: tp.name }) },
      { label: t("Print Topic…"), onSelect: () => printProblems(ids, tp.name) },
      { separator: true },
      { label: t("Delete Topic…"), danger: true, onSelect: () => A.deleteTopic(tp.id) },
    ]);
  };

  const sourceMenu = (e: React.MouseEvent, src: Source) => {
    const items: MenuItem[] = [];
    if (src.storedPath) {
      if (src.format === "pdf") items.push({ label: t("Open in Viewer"), onSelect: () => A.openSource(src.id) });
      items.push({ label: t("Open Original File"), onSelect: () => import("../platform").then((m) => m.platform().openStored(src.storedPath!)) });
      if (get().info?.kind === "tauri") items.push({ label: t("Show in Folder"), onSelect: () => import("../platform").then((m) => m.platform().revealStored(src.storedPath!)) });
      items.push({ separator: true });
    }
    items.push(
      { label: t("Edit Source…"), onSelect: () => A.openDialog({ kind: "source", sourceId: src.id }) },
      { label: t("Remove Source…"), danger: true, onSelect: () => A.deleteSource(src) },
    );
    openContextMenu(e, items);
  };

  /** Topic tree limited to `visible`, with counts from `countOf`; clicking calls `onPick`. */
  const renderTopicTree = (
    parentId: string | null,
    depth: number,
    visible: Set<string>,
    countOf: (id: string) => number | undefined,
    activeFor: (id: string) => boolean,
    onPick: (id: string) => void,
    keyPrefix: string,
  ): ReactNode[] =>
    topics
      .filter((tp) => tp.parentId === parentId && visible.has(tp.id))
      .flatMap((tp) => {
        const kids = topics.some((x) => x.parentId === tp.id && visible.has(x.id));
        const open = openTopics[tp.id] ?? true;
        return [
          <Item
            key={`${keyPrefix}${tp.id}`}
            depth={depth}
            icon={<Hash size={13} />}
            label={tp.name}
            title={tp.description || tp.name}
            count={countOf(tp.id)}
            active={activeFor(tp.id)}
            onClick={() => onPick(tp.id)}
            onContext={(e) => topicMenu(e, tp)}
            onDropIds={(ids) => A.bulkUpdate(ids, { addTopicIds: [tp.id] }, t("Tagged {n} problem(s) with {name}", { n: ids.length, name: tp.name }))}
            chevron={
              kids ? (
                <span
                  className="chev"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenTopics((o) => ({ ...o, [tp.id]: !open }));
                  }}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
              ) : undefined
            }
          />,
          ...(kids && open ? renderTopicTree(tp.id, depth + 1, visible, countOf, activeFor, onPick, keyPrefix) : []),
        ];
      });

  /** A topic is shown together with its ancestors so the hierarchy stays readable. */
  const withAncestors = (ids: Iterable<string>): Set<string> => {
    const out = new Set<string>();
    for (const id of ids) {
      let cur: string | null = id;
      while (cur && !out.has(cur)) {
        out.add(cur);
        cur = topics.find((x) => x.id === cur)?.parentId ?? null;
      }
    }
    return out;
  };

  const SubHead = ({ id, label, count, byDefault }: { id: string; label: string; count: number; byDefault?: boolean }) => (
    <button className="sb-sub" onClick={() => toggle(id, byDefault)} aria-expanded={!collapsed(id, byDefault)}>
      {collapsed(id, byDefault) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
      <span className="grow">{label}</span>
      <span className="count">{count}</span>
    </button>
  );

  const courseBlock = (c: (typeof courses)[number]) => {
    const live = problems.filter((p) => !p.deletedAt && p.courseId === c.id);
    const lecs = lectures.filter((l) => l.courseId === c.id);
    const topicCount = new Map<string, number>();
    for (const p of live) for (const tid of p.topicIds) topicCount.set(tid, (topicCount.get(tid) ?? 0) + 1);
    const courseTopics = withAncestors(topicCount.keys());
    const courseSources = sources.filter((s) => s.courseId === c.id);
    const key = `course:${c.id}`;
    const open = !collapsed(key);
    return (
      <div key={c.id} className="sb-course">
        <Item
          icon={<GraduationCap size={15} />}
          label={
            <>
              {c.code || c.title}
              {c.code && c.title && <span className="sb-course-title"> {c.title}</span>}
            </>
          }
          title={courseLabel(c)}
          count={live.length}
          active={isActive("course", c.id)}
          onClick={() => A.showCourse(c.id)}
          onContext={(e) => courseMenu(e, c.id)}
          onDropIds={(ids) => A.bulkUpdate(ids, { courseId: c.id }, t("Moved {n} problem(s) to {name}", { n: ids.length, name: c.code || c.title }))}
          className={c.archived ? "archived" : ""}
          chevron={
            <span
              className="chev"
              onClick={(e) => {
                e.stopPropagation();
                toggle(key);
              }}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          }
          extra={c.isSample ? <span className="sample-tag">{t("sample")}</span> : undefined}
        />
        {open && (
          <div className="sb-course-body">
            {lecs.map((l) => (
              <Item
                key={l.id}
                depth={1}
                icon={<span className="lec-num">{l.number || "·"}</span>}
                label={l.title || (l.number ? `${t("Lecture")} ${l.number}` : t("Untitled lecture"))}
                title={lectureLabel(l) + (l.description ? ` · ${l.description}` : "") + (l.date ? ` · ${A.formatDate(l.date)}` : "")}
                count={counts.lecture.get(l.id)}
                active={isActive("lecture", l.id)}
                onClick={() => A.showLecture(l.id)}
                onContext={(e) => lectureMenu(e, l.id)}
                onDropIds={(ids) =>
                  A.bulkUpdate(ids, { addLectureIds: [l.id], courseId: l.courseId }, t("Added {n} problem(s) to {name}", { n: ids.length, name: lectureLabel(l) }))
                }
              />
            ))}
            {lecs.length === 0 && (
              <div className="sb-empty indent">
                <button onClick={() => A.openDialog({ kind: "lectures-bulk", courseId: c.id })}>{t("Add lectures")}</button>
              </div>
            )}
            {courseTopics.size > 0 && (
              <>
                <SubHead id={`${key}:topics`} label={t("Topics")} count={topicCount.size} />
                {!collapsed(`${key}:topics`) &&
                  renderTopicTree(
                    null,
                    1,
                    courseTopics,
                    (id) => topicCount.get(id),
                    (id) => listMode === "filter" && origin.kind === "topic" && origin.id === id && origin.courseId === c.id,
                    (id) => A.showCourseTopic(c.id, id),
                    `${c.id}:`,
                  )}
              </>
            )}
            {courseSources.length > 0 && (
              <>
                <SubHead id={`${key}:sources`} label={t("Sources")} count={courseSources.length} byDefault />
                {!collapsed(`${key}:sources`, true) &&
                  courseSources.map((src) => (
                    <Item
                      key={src.id}
                      depth={1}
                      icon={<SourceIcon src={src} />}
                      label={src.title}
                      title={`${src.title}${src.fileName ? `\n${src.fileName}` : ""}`}
                      count={counts.source.get(src.id)}
                      active={isActive("source", src.id)}
                      onClick={() => A.showSource(src.id)}
                      onContext={(e) => sourceMenu(e, src)}
                    />
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Things that do not belong to any course get their own groups, shown only when they exist.
  const usedTopics = new Set(problems.filter((p) => !p.deletedAt && p.courseId).flatMap((p) => p.topicIds));
  const otherTopics = topics.filter((tp) => !usedTopics.has(tp.id));
  const otherSources = sources.filter((s) => !s.courseId || !courses.some((c) => c.id === s.courseId));
  const noCourse = problems.filter((p) => !p.deletedAt && !p.courseId).length;

  return (
    <aside className="sidebar" aria-label={t("Library navigation")}>
      <div className="sidebar-scroll">
        <Item icon={<BookOpen size={15} />} label={t("All Problems")} count={counts.all} active={isActive("all")} onClick={A.showAll} />
        <Item icon={<Inbox size={15} />} label={t("Review Queue")} count={counts.review} active={listMode === "review"} onClick={A.showReview} />
        <Item icon={<Clock3 size={15} />} label={t("Recently Edited")} active={listMode === "recent"} onClick={A.showRecent} />
        {(inboxCount > 0 || phoneOn) && (
          <Item icon={<Images size={15} />} label={t("Photo Inbox")} count={inboxCount || undefined} active={inboxInFront} onClick={openInbox} />
        )}
        {trayCount > 0 && (
          <Item icon={<MessageSquareShare size={15} />} label={t("To ChatGPT")} count={trayCount} active={trayInFront} onClick={openTray} />
        )}
        {counts.importReview > 0 && (
          <Item icon={<AlertTriangle size={14} />} label={t("Needs Import Review")} count={counts.importReview} active={isActive("import-review")} onClick={A.showImportReview} />
        )}

        <Section
          id="course-tree"
          title={t("Courses")}
          actions={
            <button className="icon-btn sm" title={t("New Course…")} onClick={() => A.openDialog({ kind: "course" })}>
              <Plus size={14} />
            </button>
          }
        >
          {liveCourses.map(courseBlock)}
          {noCourse > 0 && (
            <Item icon={<GraduationCap size={15} />} label={t("No course")} className="archived" count={noCourse} active={isActive("unassigned")} onClick={A.showUnassigned} />
          )}
          {archived.length > 0 && (
            <>
              <Item icon={<Archive size={14} />} label={t("Archived ({n})", { n: archived.length })} className="archived" onClick={() => setShowArchived(!showArchived)} />
              {showArchived && archived.map(courseBlock)}
            </>
          )}
          {courses.length === 0 && (
            <div className="sb-empty">
              <button onClick={() => A.openDialog({ kind: "course" })}>{t("Create a course")}</button>
            </div>
          )}
        </Section>

        {otherTopics.length > 0 && (
          <Section
            id="topics"
            title={courses.length ? t("Other Topics") : t("Topics")}
            actions={
              <button className="icon-btn sm" title={t("New Topic…")} onClick={() => A.openDialog({ kind: "topic" })}>
                <Plus size={14} />
              </button>
            }
          >
            {otherTopics.map((tp) => (
              <Item
                key={tp.id}
                icon={<Hash size={13} />}
                label={tp.name}
                count={counts.topic.get(tp.id)}
                active={isActive("topic", tp.id)}
                onClick={() => A.showTopic(tp.id)}
                onContext={(e) => topicMenu(e, tp)}
                onDropIds={(ids) => A.bulkUpdate(ids, { addTopicIds: [tp.id] })}
              />
            ))}
          </Section>
        )}

        {otherSources.length > 0 && (
          <Section id="sources" title={courses.length ? t("Other Sources") : t("Sources")}>
            {otherSources.map((src) => (
              <Item
                key={src.id}
                icon={<SourceIcon src={src} />}
                label={src.title}
                title={`${src.title}${src.fileName ? `\n${src.fileName}` : ""}`}
                count={counts.source.get(src.id)}
                active={isActive("source", src.id)}
                onClick={() => A.showSource(src.id)}
                onContext={(e) => sourceMenu(e, src)}
                extra={src.isSample ? <span className="sample-tag">{t("sample")}</span> : undefined}
              />
            ))}
          </Section>
        )}

        {views.length > 0 && (
          <Section id="views" title={t("Saved Views")}>
            {views.map((v) => (
              <Item
                key={v.id}
                icon={<Filter size={13} />}
                label={v.name}
                active={activeViewId === v.id}
                onClick={() => A.showView(v.id)}
                onContext={(e) =>
                  openContextMenu(e, [
                    { label: t("Update with Current Filter"), onSelect: () => A.saveView(v.name, v.id) },
                    { label: t("Rename…"), onSelect: () => A.openDialog({ kind: "save-view", viewId: v.id }) },
                    { separator: true },
                    { label: t("Delete View…"), danger: true, onSelect: () => A.deleteView(v.id) },
                  ])
                }
              />
            ))}
          </Section>
        )}
      </div>
      <div className="sidebar-foot">
        <Item icon={<Trash2 size={14} />} label={t("Trash")} count={counts.trash || undefined} active={listMode === "trash"} onClick={A.showTrash} />
      </div>
    </aside>
  );
}
