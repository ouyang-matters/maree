// Full-library JSON format ("maree-library", version 1). Documented in docs/SCHEMA.md.
// Used for backups, restores and moving a library between machines.

import type { Repo } from "../data/repo";
import type { SqlParam, Statement } from "../data/driver";
import type {
  Attachment,
  Attempt,
  Course,
  HistoryEvent,
  Lecture,
  ProblemCore,
  ProblemPart,
  SavedView,
  Source,
  Topic,
} from "../data/types";

export const LIBRARY_FORMAT = "maree-library";
export const LIBRARY_VERSION = 1;

export interface LibraryProblem extends ProblemCore {
  lectureIds: string[];
  topicIds: string[];
  parts: ProblemPart[];
  attempts: Attempt[];
  history: HistoryEvent[];
  attachments: Attachment[];
}

export interface LibraryJson {
  format: typeof LIBRARY_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  courses: Course[];
  lectures: Lecture[];
  topics: Topic[];
  sources: Source[];
  problems: LibraryProblem[];
  savedViews: SavedView[];
  settings: Record<string, unknown>;
}

/** Settings that describe the library (not the window) and travel with it. */
const PORTABLE_SETTINGS = ["katexMacros"];

export async function exportLibrary(repo: Repo, appVersion: string, opts: { includeTrash?: boolean } = {}): Promise<LibraryJson> {
  const [courses, lectures, topics, sources, summaries, views, settings] = await Promise.all([
    repo.listCourses(),
    repo.listLectures(),
    repo.listTopics(),
    repo.listSources(),
    repo.listSummaries(),
    repo.listViews(),
    repo.getSettings(),
  ]);
  const problems: LibraryProblem[] = [];
  for (const s of summaries) {
    if (s.deletedAt && !opts.includeTrash) continue;
    const p = await repo.getProblem(s.id);
    if (p) problems.push(p);
  }
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exportedAt: new Date().toISOString(),
    app: `Marée ${appVersion}`,
    courses,
    lectures,
    topics,
    sources,
    problems,
    savedViews: views,
    settings: Object.fromEntries(Object.entries(settings).filter(([k]) => PORTABLE_SETTINGS.includes(k))),
  };
}

export function validateLibrary(value: unknown): LibraryJson {
  const v = value as Partial<LibraryJson>;
  if (!v || v.format !== LIBRARY_FORMAT) throw new Error("Not a Marée library file.");
  if (typeof v.version !== "number" || v.version > LIBRARY_VERSION) {
    throw new Error(`This library was exported by a newer version of Marée (format v${v.version}). Please update Marée.`);
  }
  for (const key of ["courses", "lectures", "topics", "sources", "problems"] as const) {
    if (!Array.isArray(v[key])) throw new Error(`The library file is incomplete: “${key}” is missing.`);
  }
  return {
    ...(v as LibraryJson),
    savedViews: Array.isArray(v.savedViews) ? v.savedViews : [],
    settings: v.settings && typeof v.settings === "object" ? v.settings : {},
  };
}

export interface ImportSummary {
  courses: number;
  lectures: number;
  topics: number;
  sources: number;
  problems: number;
  existingProblems: number;
}

export async function summarizeLibraryImport(repo: Repo, lib: LibraryJson): Promise<ImportSummary> {
  const existing = new Set((await repo.listSummaries()).map((s) => s.id));
  return {
    courses: lib.courses.length,
    lectures: lib.lectures.length,
    topics: lib.topics.length,
    sources: lib.sources.length,
    problems: lib.problems.length,
    existingProblems: lib.problems.filter((p) => existing.has(p.id)).length,
  };
}

const b = (v: boolean) => (v ? 1 : 0);

/**
 * Builds an UPSERT. "keep" leaves rows that already exist untouched; "overwrite"
 * updates them in place. Rows are never deleted, so no cascade can remove data.
 */
function upsert(table: string, row: Record<string, SqlParam>, mode: "keep" | "overwrite"): Statement {
  const cols = Object.keys(row);
  const conflict =
    mode === "keep"
      ? "DO NOTHING"
      : `DO UPDATE SET ${cols
          .filter((c) => c !== "id")
          .map((c) => `${c} = excluded.${c}`)
          .join(", ")}`;
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT(id) ${conflict}`,
    params: cols.map((c) => row[c]),
  };
}

export function libraryStatements(lib: LibraryJson, mode: "keep" | "overwrite"): Statement[] {
  const s: Statement[] = [];
  for (const c of lib.courses) {
    s.push(
      upsert(
        "courses",
        {
          id: c.id, code: c.code ?? "", title: c.title ?? "", term: c.term ?? "", description: c.description ?? "",
          color: c.color ?? null, archived: b(!!c.archived), sort_order: c.sortOrder ?? 0, is_sample: b(!!c.isSample),
          created_at: c.createdAt, updated_at: c.updatedAt,
        },
        mode,
      ),
    );
  }
  // Parents first so that topic hierarchies satisfy their foreign keys.
  const topics = [...lib.topics].sort((a, b2) => (a.parentId ? 1 : 0) - (b2.parentId ? 1 : 0));
  for (const t of topics) {
    s.push(
      upsert(
        "topics",
        {
          id: t.id, parent_id: t.parentId ?? null, name: t.name, description: t.description ?? "", keywords: t.keywords ?? "",
          sort_order: t.sortOrder ?? 0, is_sample: b(!!t.isSample), created_at: t.createdAt, updated_at: t.updatedAt,
        },
        mode,
      ),
    );
  }
  for (const l of lib.lectures) {
    s.push(
      upsert(
        "lectures",
        {
          id: l.id, course_id: l.courseId, number: l.number ?? "", title: l.title ?? "", date: l.date ?? null,
          description: l.description ?? "", sort_order: l.sortOrder ?? 0, is_sample: b(!!l.isSample),
          created_at: l.createdAt, updated_at: l.updatedAt,
        },
        mode,
      ),
    );
  }
  for (const x of lib.sources) {
    s.push(
      upsert(
        "sources",
        {
          id: x.id, title: x.title, kind: x.kind ?? "other", format: x.format ?? "", author: x.author ?? "",
          section: x.section ?? "", url: x.url ?? "", file_name: x.fileName ?? null, stored_path: x.storedPath ?? null,
          original_path: x.originalPath ?? null, file_hash: x.fileHash ?? null, file_size: x.fileSize ?? null,
          page_count: x.pageCount ?? null, course_id: x.courseId ?? null, imported_at: x.importedAt ?? null,
          notes: x.notes ?? "", is_sample: b(!!x.isSample), created_at: x.createdAt, updated_at: x.updatedAt,
        },
        mode,
      ),
    );
  }
  for (const p of lib.problems) {
    s.push(
      upsert(
        "problems",
        {
          id: p.id, title: p.title ?? "", statement: p.statement ?? "", course_id: p.courseId ?? null,
          source_id: p.sourceId ?? null, source_number: p.sourceNumber ?? "", source_page: p.sourcePage ?? null,
          source_section: p.sourceSection ?? "", source_excerpt: p.sourceExcerpt ?? null, difficulty: p.difficulty ?? null,
          priority: p.priority ?? 0, category: p.category ?? null, status: p.status ?? "not_started",
          solution: p.solution ?? "", reference_solution: p.referenceSolution ?? "", notes: p.notes ?? "",
          last_attempt_at: p.lastAttemptAt ?? null, review_due: p.reviewDue ?? null,
          import_flags: JSON.stringify(p.importFlags ?? []), pinned: b(!!p.pinned), deleted_at: p.deletedAt ?? null,
          is_sample: b(!!p.isSample), created_at: p.createdAt, updated_at: p.updatedAt,
        },
        mode,
      ),
    );
    for (const l of p.lectureIds ?? []) {
      s.push({ sql: "INSERT OR IGNORE INTO problem_lectures (problem_id, lecture_id) VALUES (?, ?)", params: [p.id, l] });
    }
    for (const t of p.topicIds ?? []) {
      s.push({ sql: "INSERT OR IGNORE INTO problem_topics (problem_id, topic_id) VALUES (?, ?)", params: [p.id, t] });
    }
    for (const x of p.parts ?? []) {
      s.push(
        upsert(
          "problem_parts",
          {
            id: x.id, problem_id: p.id, label: x.label ?? "", sort_order: x.sortOrder ?? 0, statement: x.statement ?? "",
            status: x.status ?? "not_started", solution: x.solution ?? "", reference_solution: x.referenceSolution ?? "",
            notes: x.notes ?? "", last_attempt_at: x.lastAttemptAt ?? null, created_at: x.createdAt, updated_at: x.updatedAt,
          },
          mode,
        ),
      );
    }
    for (const a of p.attempts ?? []) {
      s.push(
        upsert(
          "attempts",
          { id: a.id, problem_id: p.id, part_id: a.partId ?? null, content: a.content ?? "", outcome: a.outcome ?? "incomplete", note: a.note ?? "", created_at: a.createdAt },
          mode,
        ),
      );
    }
    for (const h of p.history ?? []) {
      s.push(
        upsert(
          "history",
          {
            id: h.id, problem_id: p.id, part_id: h.partId ?? null, kind: h.kind, from_value: h.fromValue ?? null,
            to_value: h.toValue ?? null, note: h.note ?? "", created_at: h.createdAt,
          },
          mode,
        ),
      );
    }
    for (const a of p.attachments ?? []) {
      s.push(
        upsert(
          "attachments",
          {
            id: a.id, problem_id: p.id, file_name: a.fileName, stored_path: a.storedPath, mime: a.mime ?? "",
            size: a.size ?? 0, hash: a.hash ?? "", caption: a.caption ?? "", created_at: a.createdAt,
          },
          mode,
        ),
      );
    }
  }
  for (const v of lib.savedViews ?? []) {
    s.push(
      upsert(
        "saved_views",
        {
          id: v.id, name: v.name, filter: JSON.stringify(v.filter ?? {}), sort: v.sort ? JSON.stringify(v.sort) : null,
          sort_order: v.sortOrder ?? 0, created_at: v.createdAt, updated_at: v.updatedAt,
        },
        mode,
      ),
    );
  }
  for (const [k, v] of Object.entries(lib.settings ?? {})) {
    if (!PORTABLE_SETTINGS.includes(k)) continue;
    s.push({
      sql: mode === "keep" ? "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)" : "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      params: [k, JSON.stringify(v)],
    });
  }
  return s;
}

/** Imports a library export atomically, then rebuilds the search index. */
export async function importLibrary(repo: Repo, lib: LibraryJson, mode: "keep" | "overwrite"): Promise<void> {
  if (repo.db.snapshot) await repo.db.snapshot("pre-library-import");
  await repo.run(libraryStatements(lib, mode));
  await repo.reindexAll();
}
