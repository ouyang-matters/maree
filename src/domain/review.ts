// The review queue: a calm, ordered list of what deserves attention next.

import type { Course, Lecture, ProblemSummary, Status, Topic } from "../data/types";
import { STATUSES } from "../data/types";
import { isDone } from "./status";
import { topicWithDescendants } from "./filters";

export type ReviewGroupKey = "due" | "needs_review" | "struggling" | "in_progress" | "upcoming" | "recent";

export interface ReviewGroup {
  key: ReviewGroupKey;
  title: string;
  hint: string;
  problems: ProblemSummary[];
}

/** Each problem appears in the first group it qualifies for, in the order below. */
export function reviewGroups(problems: ProblemSummary[], today: string, now = Date.now()): ReviewGroup[] {
  const live = problems.filter((p) => !p.deletedAt);
  const used = new Set<string>();
  const take = (pred: (p: ProblemSummary) => boolean, cmp?: (a: ProblemSummary, b: ProblemSummary) => number) => {
    const out = live.filter((p) => !used.has(p.id) && pred(p));
    if (cmp) out.sort(cmp);
    for (const p of out) used.add(p.id);
    return out;
  };
  const byDue = (a: ProblemSummary, b: ProblemSummary) => (a.reviewDue ?? "").localeCompare(b.reviewDue ?? "");
  const byRecent = (a: ProblemSummary, b: ProblemSummary) => (b.lastAttemptAt ?? "").localeCompare(a.lastAttemptAt ?? "");
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();

  return [
    {
      key: "due" as const,
      title: "Due for review",
      hint: "Review date reached",
      problems: take((p) => !!p.reviewDue && p.reviewDue <= today, byDue),
    },
    {
      key: "needs_review" as const,
      title: "Marked Needs Review",
      hint: "Status set to Needs Review",
      problems: take((p) => p.status === "needs_review", byRecent),
    },
    {
      key: "struggling" as const,
      title: "Incorrect or incomplete proofs",
      hint: "Latest recorded attempt was incorrect or incomplete",
      problems: take((p) => (p.lastOutcome === "incorrect" || p.lastOutcome === "incomplete") && !isDone(p.status), byRecent),
    },
    {
      key: "in_progress" as const,
      title: "In progress",
      hint: "Started but not finished",
      problems: take((p) => p.status === "in_progress", byRecent),
    },
    {
      key: "upcoming" as const,
      title: "Scheduled",
      hint: "Review date in the future",
      problems: take((p) => !!p.reviewDue && p.reviewDue > today, byDue),
    },
    {
      key: "recent" as const,
      title: "Recently attempted",
      hint: "Worked on in the last 7 days",
      problems: take((p) => !!p.lastAttemptAt && p.lastAttemptAt >= weekAgo, byRecent),
    },
  ].filter((g) => g.problems.length > 0);
}

export type StatusCounts = Record<Status, number>;

export function emptyCounts(): StatusCounts {
  return Object.fromEntries(STATUSES.map((s) => [s, 0])) as StatusCounts;
}

export function countStatuses(problems: ProblemSummary[]): StatusCounts {
  const c = emptyCounts();
  for (const p of problems) if (!p.deletedAt) c[p.status]++;
  return c;
}

export interface ProgressRow {
  id: string;
  label: string;
  sublabel?: string;
  depth: number;
  total: number;
  counts: StatusCounts;
}

function row(id: string, label: string, list: ProblemSummary[], depth = 0, sublabel?: string): ProgressRow {
  return { id, label, sublabel, depth, total: list.length, counts: countStatuses(list) };
}

export function progressByCourse(problems: ProblemSummary[], courses: Course[], lectures: Lecture[]): ProgressRow[] {
  const live = problems.filter((p) => !p.deletedAt);
  const rows: ProgressRow[] = [];
  for (const c of courses.filter((c) => !c.archived)) {
    const inCourse = live.filter((p) => p.courseId === c.id);
    rows.push(row(c.id, c.code || c.title, inCourse, 0, c.code ? c.title : undefined));
    for (const l of lectures.filter((l) => l.courseId === c.id)) {
      const inLec = live.filter((p) => p.lectureIds.includes(l.id));
      rows.push(row(l.id, l.number ? `Lecture ${l.number}` : l.title, inLec, 1, l.number ? l.title : undefined));
    }
  }
  const unassigned = live.filter((p) => !p.courseId);
  if (unassigned.length) rows.push(row("__none__", "No course", unassigned));
  return rows;
}

export function progressByTopic(problems: ProblemSummary[], topics: Topic[]): ProgressRow[] {
  const live = problems.filter((p) => !p.deletedAt);
  const rows: ProgressRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const t of topics.filter((t) => t.parentId === parentId)) {
      const ids = new Set(topicWithDescendants(t.id, topics));
      rows.push(row(t.id, t.name, live.filter((p) => p.topicIds.some((x) => ids.has(x))), depth));
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
