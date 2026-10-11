// Pure functions for combining filters, sorting and grouping problem summaries.

import type { Course, FilterSpec, Lecture, ProblemSummary, SortSpec, Source, Topic } from "../data/types";
import { STATUS_RANK } from "./status";

export interface LibraryIndex {
  courses: Map<string, Course>;
  lectures: Map<string, Lecture>;
  topics: Map<string, Topic>;
  sources: Map<string, Source>;
}

export function buildIndex(courses: Course[], lectures: Lecture[], topics: Topic[], sources: Source[]): LibraryIndex {
  return {
    courses: new Map(courses.map((c) => [c.id, c])),
    lectures: new Map(lectures.map((l) => [l.id, l])),
    topics: new Map(topics.map((t) => [t.id, t])),
    sources: new Map(sources.map((s) => [s.id, s])),
  };
}

/** The topic itself plus all of its descendants. */
export function topicWithDescendants(id: string, topics: Iterable<Topic>): string[] {
  const children = new Map<string, string[]>();
  for (const t of topics) {
    if (t.parentId) (children.get(t.parentId) ?? children.set(t.parentId, []).get(t.parentId)!).push(t.id);
  }
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    stack.push(...(children.get(cur) ?? []));
  }
  return out;
}

export function isFilterEmpty(f: FilterSpec): boolean {
  return (
    !f.text?.trim() &&
    !f.courseIds?.length &&
    !f.lectureIds?.length &&
    !f.topicIds?.length &&
    !f.sourceIds?.length &&
    !f.statuses?.length &&
    !f.difficulties?.length &&
    !f.categories?.length &&
    !f.priorities?.length &&
    !f.review &&
    !f.flags?.length &&
    !f.attemptedWithinDays &&
    !f.neverAttempted
  );
}

function daysAgo(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / 86_400_000;
}

export interface FilterContext {
  index: LibraryIndex;
  /** FTS hits for `spec.text`; when null, a local substring match is used. */
  searchHits?: Map<string, number> | null;
  today: string;
  now?: number;
}

function localTextMatch(p: ProblemSummary, text: string, index: LibraryIndex): boolean {
  const hay = [
    p.title,
    p.preview,
    p.sourceNumber,
    ...p.topicIds.map((t) => index.topics.get(t)?.name ?? ""),
    index.sources.get(p.sourceId ?? "")?.title ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function matchesFilter(p: ProblemSummary, f: FilterSpec, ctx: FilterContext): boolean {
  const now = ctx.now ?? Date.now();
  const text = f.text?.trim();
  if (text) {
    if (ctx.searchHits) {
      if (!ctx.searchHits.has(p.id)) return false;
    } else if (!localTextMatch(p, text, ctx.index)) return false;
  }
  if (f.courseIds?.length && !f.courseIds.includes(p.courseId ?? "")) return false;
  if (f.lectureIds?.length) {
    const has = (l: string) => p.lectureIds.includes(l);
    if ((f.lectureMode ?? "any") === "all" ? !f.lectureIds.every(has) : !f.lectureIds.some(has)) return false;
  }
  if (f.topicIds?.length) {
    const groups = f.topicIds.map((t) =>
      f.includeSubtopics === false ? [t] : topicWithDescendants(t, ctx.index.topics.values()),
    );
    const hit = (g: string[]) => g.some((t) => p.topicIds.includes(t));
    if ((f.topicMode ?? "any") === "all" ? !groups.every(hit) : !groups.some(hit)) return false;
  }
  if (f.sourceIds?.length && !f.sourceIds.includes(p.sourceId ?? "")) return false;
  if (f.statuses?.length && !f.statuses.includes(p.status)) return false;
  if (f.difficulties?.length && !f.difficulties.includes(p.difficulty ?? 0)) return false;
  if (f.categories?.length && !f.categories.includes(p.category ?? "none")) return false;
  if (f.priorities?.length && !f.priorities.includes(p.priority)) return false;
  if (f.review === "due" && !(p.reviewDue && p.reviewDue <= ctx.today)) return false;
  if (f.review === "scheduled" && !p.reviewDue) return false;
  if (f.review === "unscheduled" && p.reviewDue) return false;
  for (const flag of f.flags ?? []) {
    if (flag === "import-review" && !p.needsImportReview) return false;
    if (flag === "has-solution" && !p.hasSolution) return false;
    if (flag === "no-solution" && p.hasSolution) return false;
    if (flag === "has-reference" && !p.hasReference) return false;
    if (flag === "pinned" && !p.pinned) return false;
    if (flag === "sample" && !p.isSample) return false;
    if (flag === "has-parts" && p.partCount === 0) return false;
  }
  if (f.neverAttempted && p.lastAttemptAt) return false;
  if (f.attemptedWithinDays && !(p.lastAttemptAt && daysAgo(p.lastAttemptAt, now) <= f.attemptedWithinDays)) return false;
  return true;
}

export function applyFilter(problems: ProblemSummary[], f: FilterSpec, ctx: FilterContext): ProblemSummary[] {
  return problems.filter((p) => !p.deletedAt && matchesFilter(p, f, ctx));
}

/** Natural comparison so that "2.9" < "2.10" and "4a" < "4b" < "10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function lectureKey(p: ProblemSummary, index: LibraryIndex): number {
  let best = Number.POSITIVE_INFINITY;
  for (const id of p.lectureIds) {
    const l = index.lectures.get(id);
    if (l) best = Math.min(best, l.sortOrder);
  }
  return best;
}

export function displayNumber(p: Pick<ProblemSummary, "sourceNumber">): string {
  return p.sourceNumber ? p.sourceNumber : "";
}

export function compareProblems(a: ProblemSummary, b: ProblemSummary, sort: SortSpec, index: LibraryIndex): number {
  const dir = sort.dir === "asc" ? 1 : -1;
  const nullsLast = (x: number | string | null | undefined, y: number | string | null | undefined, cmp: () => number) => {
    const xn = x === null || x === undefined || x === "";
    const yn = y === null || y === undefined || y === "";
    if (xn && yn) return 0;
    if (xn) return 1;
    if (yn) return -1;
    return cmp() * dir;
  };
  const course = (p: ProblemSummary) => {
    const c = index.courses.get(p.courseId ?? "");
    return c ? `${c.code} ${c.title}` : "";
  };
  switch (sort.key) {
    case "title":
      return nullsLast(a.title, b.title, () => naturalCompare(a.title, b.title));
    case "number":
      return nullsLast(a.sourceNumber, b.sourceNumber, () => naturalCompare(a.sourceNumber, b.sourceNumber));
    case "course":
      return nullsLast(course(a), course(b), () => naturalCompare(course(a), course(b)));
    case "lecture": {
      const x = lectureKey(a, index);
      const y = lectureKey(b, index);
      return nullsLast(isFinite(x) ? x : null, isFinite(y) ? y : null, () => x - y);
    }
    case "topic": {
      const t = (p: ProblemSummary) =>
        p.topicIds
          .map((id) => index.topics.get(id)?.name ?? "")
          .sort(naturalCompare)[0] ?? "";
      return nullsLast(t(a), t(b), () => naturalCompare(t(a), t(b)));
    }
    case "difficulty":
      return nullsLast(a.difficulty, b.difficulty, () => a.difficulty! - b.difficulty!);
    case "priority":
      return (a.priority - b.priority) * dir;
    case "status":
      return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
    case "category":
      return nullsLast(a.category, b.category, () => a.category!.localeCompare(b.category!));
    case "source": {
      const s = (p: ProblemSummary) => index.sources.get(p.sourceId ?? "")?.title ?? "";
      return nullsLast(s(a), s(b), () => naturalCompare(s(a), s(b)));
    }
    case "lastAttempt":
      return nullsLast(a.lastAttemptAt, b.lastAttemptAt, () => a.lastAttemptAt!.localeCompare(b.lastAttemptAt!));
    case "reviewDue":
      return nullsLast(a.reviewDue, b.reviewDue, () => a.reviewDue!.localeCompare(b.reviewDue!));
    case "updated":
      return a.updatedAt.localeCompare(b.updatedAt) * dir;
    case "created":
      return a.createdAt.localeCompare(b.createdAt) * dir;
  }
}

/** Default "library order": course, lecture, original number, then creation time. */
export function libraryOrder(a: ProblemSummary, b: ProblemSummary, index: LibraryIndex): number {
  const keys: SortSpec[] = [
    { key: "course", dir: "asc" },
    { key: "lecture", dir: "asc" },
    { key: "number", dir: "asc" },
    { key: "created", dir: "asc" },
  ];
  for (const k of keys) {
    const c = compareProblems(a, b, k, index);
    if (c !== 0) return c;
  }
  return 0;
}

export function sortProblems(
  list: ProblemSummary[],
  sort: SortSpec | null,
  index: LibraryIndex,
  searchHits?: Map<string, number> | null,
): ProblemSummary[] {
  const out = [...list];
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (!sort && searchHits) {
      const d = (searchHits.get(b.id) ?? 0) - (searchHits.get(a.id) ?? 0);
      if (d) return d;
    }
    if (sort) {
      const c = compareProblems(a, b, sort, index);
      if (c !== 0) return c;
    }
    return libraryOrder(a, b, index);
  });
  return out;
}

export function problemLabel(p: Pick<ProblemSummary, "title" | "sourceNumber" | "preview">): string {
  const num = p.sourceNumber ? `Problem ${p.sourceNumber}` : "";
  if (p.title && num) return `${num} — ${p.title}`;
  if (p.title) return p.title;
  if (num) return num;
  const pre = p.preview.replace(/\s+/g, " ").trim();
  return pre ? (pre.length > 60 ? pre.slice(0, 60) + "…" : pre) : "Untitled problem";
}

export function lectureLabel(l: Pick<Lecture, "number" | "title">): string {
  if (l.number && l.title) return `Lecture ${l.number} — ${l.title}`;
  if (l.number) return `Lecture ${l.number}`;
  return l.title || "Untitled lecture";
}

export function courseLabel(c: Pick<Course, "code" | "title">): string {
  if (c.code && c.title) return `${c.code} — ${c.title}`;
  return c.code || c.title || "Untitled course";
}
