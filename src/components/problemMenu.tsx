import { CalendarClock, Copy, FileDown, FileText, PanelRight, Printer, Trash2 } from "lucide-react";
import type { MenuItem } from "../ui/Menu";
import { get } from "../state/store";
import * as A from "../state/actions";
import { STATUSES } from "../data/types";
import { DIFFICULTY_LABEL, STATUS_LABEL } from "../domain/status";
import { StatusIcon } from "../ui/icons";
import { lectureLabel } from "../domain/filters";
import { todayLocal } from "../data/ids";
import { printProblems } from "./print";
import { t } from "../i18n";

export function reviewDateItems(ids: string[]): MenuItem[] {
  const opt = (label: string, days: number) => ({ label, onSelect: () => A.setReviewDate(ids, todayLocal(days)) });
  return [
    opt(t("Today"), 0),
    opt(t("Tomorrow"), 1),
    opt(t("In 3 days"), 3),
    opt(t("In 1 week"), 7),
    opt(t("In 2 weeks"), 14),
    opt(t("In 1 month"), 30),
    { separator: true },
    { label: t("Choose a date…"), onSelect: () => A.openDialog({ kind: "review-date", problemIds: ids }) },
    { label: t("Clear review date"), onSelect: () => A.setReviewDate(ids, null) },
  ];
}

/** Context menu for one or more problems. */
export function problemMenuItems(ids: string[], opts: { inTrash?: boolean; inView?: boolean } = {}): MenuItem[] {
  const s = get();
  if (opts.inTrash) {
    return [
      { label: t("Restore"), onSelect: () => A.restoreProblems(ids) },
      { label: t("Delete Permanently…"), danger: true, onSelect: () => A.purgeProblems(ids) },
    ];
  }
  const single = ids.length === 1 ? s.problems.find((p) => p.id === ids[0]) : undefined;
  const courseId = single?.courseId ?? s.activeCourseId;
  const lectures = s.lectures.filter((l) => !courseId || l.courseId === courseId);
  const src = single?.sourceId ? s.index.sources.get(single.sourceId) : undefined;
  const items: MenuItem[] = [];
  if (single && !opts.inView) {
    items.push(
      { label: t("Open"), onSelect: () => A.openProblem(single.id) },
      { label: t("Open to the Side"), icon: <PanelRight size={14} />, onSelect: () => openBeside(single.id) },
    );
    if (src?.storedPath && src.format === "pdf") {
      items.push({ label: t("Open Source PDF Beside"), icon: <FileText size={14} />, onSelect: () => A.openSource(src.id, single.sourcePage ?? undefined, true) });
    }
    items.push({ separator: true });
  }
  if (!opts.inView) items.push(
    {
      label: t("Status"),
      submenu: STATUSES.map((st, i) => ({
        label: t(STATUS_LABEL[st]),
        icon: <StatusIcon status={st} />,
        shortcut: `Alt+${i + 1}`,
        checked: single?.status === st ? true : undefined,
        onSelect: () => A.setStatus(ids, st),
      })),
    },
    {
      label: t("Difficulty"),
      submenu: [
        ...[1, 2, 3, 4].map((d) => ({
          label: `${d} — ${t(DIFFICULTY_LABEL[d])}`,
          checked: single?.difficulty === d ? true : undefined,
          onSelect: () => A.bulkUpdate(ids, { difficulty: d }),
        })),
        { separator: true },
        { label: t("None"), onSelect: () => A.bulkUpdate(ids, { difficulty: null }) },
      ],
    },
    {
      label: t("Add to Lecture"),
      disabled: lectures.length === 0,
      submenu: lectures.map((l) => ({
        label: lectureLabel(l),
        checked: single?.lectureIds.includes(l.id) ? true : undefined,
        onSelect: () =>
          single?.lectureIds.includes(l.id)
            ? A.bulkUpdate(ids, { removeLectureIds: [l.id] })
            : A.bulkUpdate(ids, { addLectureIds: [l.id], courseId: l.courseId }),
      })),
    },
    {
      label: t("Add Topic"),
      disabled: s.topics.length === 0,
      submenu: s.topics.map((tp) => ({
        label: tp.name,
        checked: single?.topicIds.includes(tp.id) ? true : undefined,
        onSelect: () =>
          single?.topicIds.includes(tp.id) ? A.bulkUpdate(ids, { removeTopicIds: [tp.id] }) : A.bulkUpdate(ids, { addTopicIds: [tp.id] }),
      })),
    },
    { label: t("Schedule Review"), icon: <CalendarClock size={14} />, submenu: reviewDateItems(ids) },
    { separator: true },
  );
  if (single) {
    items.push(
      { label: t("Copy as Markdown"), icon: <Copy size={14} />, onSelect: () => A.copyProblemAs(single.id, "solution", "md") },
      { label: t("Copy as LaTeX"), onSelect: () => A.copyProblemAs(single.id, "solution", "tex") },
      { label: t("Duplicate"), onSelect: () => A.duplicateProblem(single.id) },
    );
  }
  items.push(
    { label: t("Export…"), icon: <FileDown size={14} />, onSelect: () => A.openDialog({ kind: "export", problemIds: ids, title: single?.title || t("Problems") }) },
    { label: t("Print…"), icon: <Printer size={14} />, onSelect: () => printProblems(ids, single?.title || t("Problems")) },
    { separator: true },
    { label: ids.length > 1 ? t("Move {n} to Trash", { n: ids.length }) : t("Move to Trash"), icon: <Trash2 size={14} />, danger: true, onSelect: () => A.trashProblems(ids) },
  );
  return items;
}

export function openBeside(problemId: string): void {
  const s = get();
  const other = s.groups.length >= 2 ? (s.activeGroup === 0 ? 1 : 0) : 1;
  void A.openProblem(problemId, { group: other });
}
