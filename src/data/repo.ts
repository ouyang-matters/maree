// Repository: every read and write of the library goes through here.
// Writes are composed into statement lists and executed atomically via `batch`.

import type { Row, SqlDriver, SqlParam, Statement } from "./driver";
import { WriteQueue } from "./driver";
import { newId, nowIso } from "./ids";
import { aggregateStatus } from "../domain/status";
import type {
  Attachment,
  Attempt,
  Category,
  Course,
  HistoryEvent,
  ImportFlag,
  Lecture,
  NewPart,
  NewProblem,
  Outcome,
  PartPatch,
  Problem,
  ProblemCore,
  ProblemPart,
  ProblemPatch,
  ProblemSummary,
  SavedView,
  Source,
  Status,
  Topic,
} from "./types";

// ------------------------------------------------------------------ helpers

const str = (v: unknown, d = ""): string => (v === null || v === undefined ? d : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, d = 0): number => (v === null || v === undefined || v === "" ? d : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === "1";

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

export function nextPartLabel(existing: string[]): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (const l of letters) if (!existing.includes(l)) return l;
  return String(existing.length + 1);
}

// ---------------------------------------------------------------- mappers

export function mapCourse(r: Row): Course {
  return {
    id: str(r.id),
    code: str(r.code),
    title: str(r.title),
    term: str(r.term),
    description: str(r.description),
    color: strOrNull(r.color),
    archived: bool(r.archived),
    sortOrder: num(r.sort_order),
    isSample: bool(r.is_sample),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function mapLecture(r: Row): Lecture {
  return {
    id: str(r.id),
    courseId: str(r.course_id),
    number: str(r.number),
    title: str(r.title),
    date: strOrNull(r.date),
    description: str(r.description),
    sortOrder: num(r.sort_order),
    isSample: bool(r.is_sample),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function mapTopic(r: Row): Topic {
  return {
    id: str(r.id),
    parentId: strOrNull(r.parent_id),
    name: str(r.name),
    description: str(r.description),
    keywords: str(r.keywords),
    sortOrder: num(r.sort_order),
    isSample: bool(r.is_sample),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function mapSource(r: Row): Source {
  return {
    id: str(r.id),
    title: str(r.title),
    kind: str(r.kind, "other") as Source["kind"],
    format: str(r.format) as Source["format"],
    author: str(r.author),
    section: str(r.section),
    url: str(r.url),
    fileName: strOrNull(r.file_name),
    storedPath: strOrNull(r.stored_path),
    originalPath: strOrNull(r.original_path),
    fileHash: strOrNull(r.file_hash),
    fileSize: numOrNull(r.file_size),
    pageCount: numOrNull(r.page_count),
    courseId: strOrNull(r.course_id),
    importedAt: strOrNull(r.imported_at),
    notes: str(r.notes),
    isSample: bool(r.is_sample),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function mapProblemCore(r: Row): ProblemCore {
  return {
    id: str(r.id),
    title: str(r.title),
    statement: str(r.statement),
    courseId: strOrNull(r.course_id),
    sourceId: strOrNull(r.source_id),
    sourceNumber: str(r.source_number),
    sourcePage: numOrNull(r.source_page),
    sourceSection: str(r.source_section),
    sourceExcerpt: strOrNull(r.source_excerpt),
    difficulty: numOrNull(r.difficulty),
    priority: num(r.priority),
    category: strOrNull(r.category) as Category | null,
    status: str(r.status, "not_started") as Status,
    solution: str(r.solution),
    referenceSolution: str(r.reference_solution),
    notes: str(r.notes),
    lastAttemptAt: strOrNull(r.last_attempt_at),
    reviewDue: strOrNull(r.review_due),
    importFlags: parseJson<ImportFlag[]>(r.import_flags, []),
    pinned: bool(r.pinned),
    isSample: bool(r.is_sample),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: strOrNull(r.deleted_at),
  };
}

function mapPart(r: Row): ProblemPart {
  return {
    id: str(r.id),
    problemId: str(r.problem_id),
    label: str(r.label),
    sortOrder: num(r.sort_order),
    statement: str(r.statement),
    status: str(r.status, "not_started") as Status,
    solution: str(r.solution),
    referenceSolution: str(r.reference_solution),
    notes: str(r.notes),
    lastAttemptAt: strOrNull(r.last_attempt_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function mapAttempt(r: Row): Attempt {
  return {
    id: str(r.id),
    problemId: str(r.problem_id),
    partId: strOrNull(r.part_id),
    content: str(r.content),
    outcome: str(r.outcome, "incomplete") as Outcome,
    note: str(r.note),
    createdAt: str(r.created_at),
  };
}

function mapHistory(r: Row): HistoryEvent {
  return {
    id: str(r.id),
    problemId: str(r.problem_id),
    partId: strOrNull(r.part_id),
    kind: str(r.kind) as HistoryEvent["kind"],
    fromValue: strOrNull(r.from_value),
    toValue: strOrNull(r.to_value),
    note: str(r.note),
    createdAt: str(r.created_at),
  };
}

function mapAttachment(r: Row): Attachment {
  return {
    id: str(r.id),
    problemId: str(r.problem_id),
    fileName: str(r.file_name),
    storedPath: str(r.stored_path),
    mime: str(r.mime),
    size: num(r.size),
    hash: str(r.hash),
    caption: str(r.caption),
    createdAt: str(r.created_at),
  };
}

function mapView(r: Row): SavedView {
  return {
    id: str(r.id),
    name: str(r.name),
    filter: parseJson(r.filter, {}),
    sort: parseJson(r.sort, null),
    sortOrder: num(r.sort_order),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

const SUMMARY_SQL = `
SELECT p.id, p.title, substr(p.statement, 1, 600) AS preview, p.course_id, p.source_id,
  p.source_number, p.source_page, p.difficulty, p.priority, p.category, p.status,
  p.last_attempt_at, p.review_due, p.pinned, p.is_sample, p.created_at, p.updated_at, p.deleted_at,
  (length(p.solution) > 0 OR EXISTS (SELECT 1 FROM problem_parts x WHERE x.problem_id = p.id AND length(x.solution) > 0)) AS has_solution,
  (length(p.reference_solution) > 0) AS has_reference,
  (p.import_flags <> '[]') AS needs_import_review,
  (SELECT COUNT(*) FROM problem_parts x WHERE x.problem_id = p.id) AS part_count,
  (SELECT COUNT(*) FROM problem_parts x WHERE x.problem_id = p.id AND x.status IN ('completed','mastered')) AS parts_done,
  (SELECT COUNT(*) FROM attempts a WHERE a.problem_id = p.id) AS attempt_count,
  (SELECT a.outcome FROM attempts a WHERE a.problem_id = p.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_outcome
FROM problems p`;

function mapSummary(r: Row, lectures: string[], topics: string[]): ProblemSummary {
  return {
    id: str(r.id),
    title: str(r.title),
    preview: str(r.preview),
    courseId: strOrNull(r.course_id),
    sourceId: strOrNull(r.source_id),
    sourceNumber: str(r.source_number),
    sourcePage: numOrNull(r.source_page),
    difficulty: numOrNull(r.difficulty),
    priority: num(r.priority),
    category: strOrNull(r.category) as Category | null,
    status: str(r.status, "not_started") as Status,
    lastAttemptAt: strOrNull(r.last_attempt_at),
    reviewDue: strOrNull(r.review_due),
    hasSolution: bool(r.has_solution),
    hasReference: bool(r.has_reference),
    needsImportReview: bool(r.needs_import_review),
    pinned: bool(r.pinned),
    isSample: bool(r.is_sample),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: strOrNull(r.deleted_at),
    lectureIds: lectures,
    topicIds: topics,
    partCount: num(r.part_count),
    partsDone: num(r.parts_done),
    attemptCount: num(r.attempt_count),
    lastOutcome: strOrNull(r.last_outcome) as Outcome | null,
  };
}

/** Statements that rebuild the full-text index entry of one problem. */
export function ftsStatements(problemId: string): Statement[] {
  return [
    {
      sql: "DELETE FROM problem_fts WHERE docid IN (SELECT docid FROM fts_map WHERE problem_id = ?)",
      params: [problemId],
    },
    {
      sql: `INSERT OR REPLACE INTO fts_map (problem_id, docid) VALUES (?,
              COALESCE((SELECT docid FROM fts_map WHERE problem_id = ?),
                       (SELECT COALESCE(MAX(docid), 0) + 1 FROM fts_map)))`,
      params: [problemId, problemId],
    },
    {
      sql: `INSERT INTO problem_fts (docid, problem_id, title, statement, work, meta)
        SELECT (SELECT docid FROM fts_map WHERE problem_id = p.id), p.id,
          p.title || ' ' || p.source_number,
          p.statement || ' ' || COALESCE((SELECT group_concat(x.label || ' ' || x.statement, ' ') FROM problem_parts x WHERE x.problem_id = p.id), ''),
          p.solution || ' ' || p.reference_solution || ' ' || p.notes || ' ' ||
            COALESCE((SELECT group_concat(x.solution || ' ' || x.reference_solution || ' ' || x.notes, ' ') FROM problem_parts x WHERE x.problem_id = p.id), '') || ' ' ||
            COALESCE((SELECT group_concat(a.content || ' ' || a.note, ' ') FROM attempts a WHERE a.problem_id = p.id), ''),
          COALESCE((SELECT c.code || ' ' || c.title FROM courses c WHERE c.id = p.course_id), '') || ' ' ||
            COALESCE((SELECT group_concat('Lecture ' || l.number || ' ' || l.title, ' ') FROM problem_lectures pl JOIN lectures l ON l.id = pl.lecture_id WHERE pl.problem_id = p.id), '') || ' ' ||
            COALESCE((SELECT group_concat(t.name || ' ' || t.keywords, ' ') FROM problem_topics pt JOIN topics t ON t.id = pt.topic_id WHERE pt.problem_id = p.id), '') || ' ' ||
            COALESCE((SELECT s.title || ' ' || s.author || ' ' || s.section || ' ' || COALESCE(s.file_name, '') FROM sources s WHERE s.id = p.source_id), '') || ' ' ||
            p.source_section || ' ' || COALESCE(p.category, '')
        FROM problems p WHERE p.id = ?`,
      params: [problemId],
    },
  ];
}

function ftsDeleteStatements(problemId: string): Statement[] {
  return [
    {
      sql: "DELETE FROM problem_fts WHERE docid IN (SELECT docid FROM fts_map WHERE problem_id = ?)",
      params: [problemId],
    },
    { sql: "DELETE FROM fts_map WHERE problem_id = ?", params: [problemId] },
  ];
}

/** Converts free text into an FTS4 query: every word must match as a prefix. */
export function toFtsQuery(text: string): string | null {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.slice(0, 12).map((t) => `${t}*`).join(" ");
}

// -------------------------------------------------------------- repository

export interface CourseInput {
  code?: string;
  title?: string;
  term?: string;
  description?: string;
  color?: string | null;
  isSample?: boolean;
}

export interface LectureInput {
  courseId: string;
  number?: string;
  title?: string;
  date?: string | null;
  description?: string;
  isSample?: boolean;
}

export interface TopicInput {
  name: string;
  parentId?: string | null;
  description?: string;
  keywords?: string;
  isSample?: boolean;
}

export type SourceInput = Partial<Omit<Source, "id">> & { title: string; id?: string };

export interface BulkUpdate {
  addTopicIds?: string[];
  removeTopicIds?: string[];
  addLectureIds?: string[];
  removeLectureIds?: string[];
  courseId?: string | null;
  difficulty?: number | null;
  category?: Category | null;
  priority?: number;
  status?: Status;
  reviewDue?: string | null;
  sourceId?: string | null;
}

export class Repo {
  readonly writes = new WriteQueue();

  constructor(readonly db: SqlDriver) {}

  private tx(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return Promise.resolve();
    return this.writes.run(() => this.db.batch(statements));
  }

  /** Waits until all queued writes have reached the database. */
  idle(): Promise<void> {
    return this.writes.idle();
  }

  // ------------------------------------------------------------ settings

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.select<{ key: string; value: string }>("SELECT key, value FROM settings");
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = parseJson(r.value, null);
    return out;
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.tx([
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", params: [key, JSON.stringify(value)] },
    ]);
  }

  // ------------------------------------------------------------- courses

  async listCourses(): Promise<Course[]> {
    const rows = await this.db.select("SELECT * FROM courses ORDER BY archived, sort_order, code, title");
    return rows.map(mapCourse);
  }

  async createCourse(input: CourseInput): Promise<Course> {
    const id = newId("crs");
    const now = nowIso();
    const max = await this.db.select<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM courses");
    await this.tx([
      {
        sql: `INSERT INTO courses (id, code, title, term, description, color, archived, sort_order, is_sample, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        params: [
          id,
          (input.code ?? "").trim(),
          (input.title ?? "").trim(),
          input.term ?? "",
          input.description ?? "",
          input.color ?? null,
          num(max[0]?.m, 0) + 1,
          input.isSample ? 1 : 0,
          now,
          now,
        ],
      },
    ]);
    return (await this.getCourse(id))!;
  }

  async getCourse(id: string): Promise<Course | null> {
    const rows = await this.db.select("SELECT * FROM courses WHERE id = ?", [id]);
    return rows[0] ? mapCourse(rows[0]) : null;
  }

  async updateCourse(id: string, patch: Partial<CourseInput & { archived: boolean; sortOrder: number }>): Promise<void> {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    const map: Record<string, string> = {
      code: "code",
      title: "title",
      term: "term",
      description: "description",
      color: "color",
      archived: "archived",
      sortOrder: "sort_order",
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        const v = (patch as Record<string, unknown>)[k];
        params.push(typeof v === "boolean" ? (v ? 1 : 0) : (v as SqlParam));
      }
    }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    const stmts: Statement[] = [{ sql: `UPDATE courses SET ${sets.join(", ")} WHERE id = ?`, params }];
    if ("code" in patch || "title" in patch) stmts.push(...(await this.reindexWhere("course_id = ?", [id])));
    await this.tx(stmts);
  }

  /** Deletes a course and its lectures. Problems are kept (unassigned) or moved to the trash. */
  async deleteCourse(id: string, problems: "keep" | "trash"): Promise<void> {
    const now = nowIso();
    const stmts: Statement[] = [];
    if (problems === "trash") {
      stmts.push({
        sql: "UPDATE problems SET deleted_at = ?, updated_at = ? WHERE course_id = ? AND deleted_at IS NULL",
        params: [now, now, id],
      });
    }
    stmts.push({ sql: "DELETE FROM courses WHERE id = ?", params: [id] });
    await this.tx(stmts);
  }

  // ------------------------------------------------------------ lectures

  async listLectures(): Promise<Lecture[]> {
    const rows = await this.db.select("SELECT * FROM lectures ORDER BY course_id, sort_order");
    return rows.map(mapLecture);
  }

  async createLectures(inputs: LectureInput[]): Promise<Lecture[]> {
    if (!inputs.length) return [];
    const now = nowIso();
    const maxByCourse = new Map<string, number>();
    const rows = await this.db.select<{ course_id: string; m: number }>(
      "SELECT course_id, MAX(sort_order) AS m FROM lectures GROUP BY course_id",
    );
    for (const r of rows) maxByCourse.set(r.course_id, num(r.m));
    const ids: string[] = [];
    const stmts: Statement[] = inputs.map((input) => {
      const id = newId("lec");
      ids.push(id);
      const order = (maxByCourse.get(input.courseId) ?? 0) + 1;
      maxByCourse.set(input.courseId, order);
      return {
        sql: `INSERT INTO lectures (id, course_id, number, title, date, description, sort_order, is_sample, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          input.courseId,
          (input.number ?? "").trim(),
          (input.title ?? "").trim(),
          input.date ?? null,
          input.description ?? "",
          order,
          input.isSample ? 1 : 0,
          now,
          now,
        ],
      };
    });
    await this.tx(stmts);
    const all = await this.listLectures();
    return ids.map((id) => all.find((l) => l.id === id)!);
  }

  async createLecture(input: LectureInput): Promise<Lecture> {
    return (await this.createLectures([input]))[0];
  }

  async updateLecture(
    id: string,
    patch: Partial<Pick<Lecture, "number" | "title" | "date" | "description" | "sortOrder" | "courseId">>,
  ): Promise<void> {
    const map: Record<string, string> = {
      number: "number",
      title: "title",
      date: "date",
      description: "description",
      sortOrder: "sort_order",
      courseId: "course_id",
    };
    const sets: string[] = [];
    const params: SqlParam[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        params.push((patch as Record<string, SqlParam>)[k]);
      }
    }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    const stmts: Statement[] = [{ sql: `UPDATE lectures SET ${sets.join(", ")} WHERE id = ?`, params }];
    if ("number" in patch || "title" in patch) {
      stmts.push(...(await this.reindexWhere("id IN (SELECT problem_id FROM problem_lectures WHERE lecture_id = ?)", [id])));
    }
    await this.tx(stmts);
  }

  async reorderLectures(orderedIds: string[]): Promise<void> {
    await this.tx(
      orderedIds.map((id, i) => ({ sql: "UPDATE lectures SET sort_order = ? WHERE id = ?", params: [i + 1, id] })),
    );
  }

  async deleteLecture(id: string): Promise<void> {
    await this.tx([{ sql: "DELETE FROM lectures WHERE id = ?", params: [id] }]);
  }

  // -------------------------------------------------------------- topics

  async listTopics(): Promise<Topic[]> {
    const rows = await this.db.select("SELECT * FROM topics ORDER BY sort_order, name");
    return rows.map(mapTopic);
  }

  async createTopics(inputs: TopicInput[]): Promise<Topic[]> {
    if (!inputs.length) return [];
    const now = nowIso();
    const max = await this.db.select<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM topics");
    let order = num(max[0]?.m, 0);
    const ids: string[] = [];
    const stmts = inputs.map((t) => {
      const id = newId("top");
      ids.push(id);
      order++;
      return {
        sql: `INSERT INTO topics (id, parent_id, name, description, keywords, sort_order, is_sample, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, t.parentId ?? null, t.name.trim(), t.description ?? "", t.keywords ?? "", order, t.isSample ? 1 : 0, now, now],
      };
    });
    await this.tx(stmts);
    const all = await this.listTopics();
    return ids.map((id) => all.find((t) => t.id === id)!);
  }

  async createTopic(input: TopicInput): Promise<Topic> {
    return (await this.createTopics([input]))[0];
  }

  async updateTopic(
    id: string,
    patch: Partial<Pick<Topic, "name" | "parentId" | "description" | "keywords" | "sortOrder">>,
  ): Promise<void> {
    if (patch.parentId) {
      // Refuse cycles: the new parent may not be the topic itself or one of its descendants.
      const all = await this.listTopics();
      let cur: string | null = patch.parentId;
      while (cur) {
        if (cur === id) throw new Error("A topic cannot be nested inside itself.");
        cur = all.find((t) => t.id === cur)?.parentId ?? null;
      }
    }
    const map: Record<string, string> = {
      name: "name",
      parentId: "parent_id",
      description: "description",
      keywords: "keywords",
      sortOrder: "sort_order",
    };
    const sets: string[] = [];
    const params: SqlParam[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        params.push((patch as Record<string, SqlParam>)[k]);
      }
    }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    const stmts: Statement[] = [{ sql: `UPDATE topics SET ${sets.join(", ")} WHERE id = ?`, params }];
    if ("name" in patch || "keywords" in patch) {
      stmts.push(...(await this.reindexWhere("id IN (SELECT problem_id FROM problem_topics WHERE topic_id = ?)", [id])));
    }
    await this.tx(stmts);
  }

  async deleteTopic(id: string): Promise<void> {
    const affected = await this.db.select<{ problem_id: string }>(
      "SELECT problem_id FROM problem_topics WHERE topic_id = ?",
      [id],
    );
    const stmts: Statement[] = [{ sql: "DELETE FROM topics WHERE id = ?", params: [id] }];
    for (const a of affected) stmts.push(...ftsStatements(a.problem_id));
    await this.tx(stmts);
  }

  // ------------------------------------------------------------- sources

  async listSources(): Promise<Source[]> {
    const rows = await this.db.select("SELECT * FROM sources ORDER BY imported_at DESC, title");
    return rows.map(mapSource);
  }

  async findSourcesByHash(hash: string): Promise<Source[]> {
    const rows = await this.db.select("SELECT * FROM sources WHERE file_hash = ?", [hash]);
    return rows.map(mapSource);
  }

  sourceInsert(input: SourceInput, now = nowIso()): { id: string; statement: Statement } {
    const id = input.id ?? newId("src");
    return {
      id,
      statement: {
        sql: `INSERT INTO sources (id, title, kind, format, author, section, url, file_name, stored_path, original_path,
                file_hash, file_size, page_count, course_id, imported_at, notes, is_sample, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          input.title.trim() || "Untitled source",
          input.kind ?? "other",
          input.format ?? "",
          input.author ?? "",
          input.section ?? "",
          input.url ?? "",
          input.fileName ?? null,
          input.storedPath ?? null,
          input.originalPath ?? null,
          input.fileHash ?? null,
          input.fileSize ?? null,
          input.pageCount ?? null,
          input.courseId ?? null,
          input.importedAt ?? null,
          input.notes ?? "",
          input.isSample ? 1 : 0,
          input.createdAt ?? now,
          input.updatedAt ?? now,
        ],
      },
    };
  }

  async createSource(input: SourceInput): Promise<Source> {
    const { id, statement } = this.sourceInsert(input);
    await this.tx([statement]);
    const rows = await this.db.select("SELECT * FROM sources WHERE id = ?", [id]);
    return mapSource(rows[0]);
  }

  async updateSource(
    id: string,
    patch: Partial<Pick<Source, "title" | "kind" | "author" | "section" | "url" | "notes" | "courseId">>,
  ): Promise<void> {
    const map: Record<string, string> = {
      title: "title",
      kind: "kind",
      author: "author",
      section: "section",
      url: "url",
      notes: "notes",
      courseId: "course_id",
    };
    const sets: string[] = [];
    const params: SqlParam[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        params.push((patch as Record<string, SqlParam>)[k]);
      }
    }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    const stmts: Statement[] = [{ sql: `UPDATE sources SET ${sets.join(", ")} WHERE id = ?`, params }];
    stmts.push(...(await this.reindexWhere("source_id = ?", [id])));
    await this.tx(stmts);
  }

  /** Removes the source record. Problems keep their number/page provenance fields. */
  async deleteSource(id: string): Promise<void> {
    const affected = await this.db.select<{ id: string }>("SELECT id FROM problems WHERE source_id = ?", [id]);
    const stmts: Statement[] = [{ sql: "DELETE FROM sources WHERE id = ?", params: [id] }];
    for (const a of affected) stmts.push(...ftsStatements(a.id));
    await this.tx(stmts);
  }

  // ------------------------------------------------------------ problems

  async listSummaries(): Promise<ProblemSummary[]> {
    const [rows, pl, pt] = await Promise.all([
      this.db.select(SUMMARY_SQL),
      this.db.select<{ problem_id: string; lecture_id: string }>("SELECT problem_id, lecture_id FROM problem_lectures"),
      this.db.select<{ problem_id: string; topic_id: string }>("SELECT problem_id, topic_id FROM problem_topics"),
    ]);
    const lec = new Map<string, string[]>();
    for (const r of pl) (lec.get(r.problem_id) ?? lec.set(r.problem_id, []).get(r.problem_id)!).push(r.lecture_id);
    const top = new Map<string, string[]>();
    for (const r of pt) (top.get(r.problem_id) ?? top.set(r.problem_id, []).get(r.problem_id)!).push(r.topic_id);
    return rows.map((r) => mapSummary(r, lec.get(str(r.id)) ?? [], top.get(str(r.id)) ?? []));
  }

  async getSummaries(ids: string[]): Promise<ProblemSummary[]> {
    if (!ids.length) return [];
    const out: ProblemSummary[] = [];
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const ph = placeholders(chunk.length);
      const [rows, pl, pt] = await Promise.all([
        this.db.select(`${SUMMARY_SQL} WHERE p.id IN (${ph})`, chunk),
        this.db.select<{ problem_id: string; lecture_id: string }>(
          `SELECT problem_id, lecture_id FROM problem_lectures WHERE problem_id IN (${ph})`,
          chunk,
        ),
        this.db.select<{ problem_id: string; topic_id: string }>(
          `SELECT problem_id, topic_id FROM problem_topics WHERE problem_id IN (${ph})`,
          chunk,
        ),
      ]);
      for (const r of rows) {
        const id = str(r.id);
        out.push(
          mapSummary(
            r,
            pl.filter((x) => x.problem_id === id).map((x) => x.lecture_id),
            pt.filter((x) => x.problem_id === id).map((x) => x.topic_id),
          ),
        );
      }
    }
    return out;
  }

  async getProblem(id: string): Promise<Problem | null> {
    const rows = await this.db.select("SELECT * FROM problems WHERE id = ?", [id]);
    if (!rows[0]) return null;
    const [lectures, topics, parts, attempts, history, attachments] = await Promise.all([
      this.db.select<{ lecture_id: string }>("SELECT lecture_id FROM problem_lectures WHERE problem_id = ?", [id]),
      this.db.select<{ topic_id: string }>("SELECT topic_id FROM problem_topics WHERE problem_id = ?", [id]),
      this.db.select("SELECT * FROM problem_parts WHERE problem_id = ? ORDER BY sort_order, label", [id]),
      this.db.select("SELECT * FROM attempts WHERE problem_id = ? ORDER BY created_at DESC, id DESC", [id]),
      this.db.select("SELECT * FROM history WHERE problem_id = ? ORDER BY created_at DESC, id DESC", [id]),
      this.db.select("SELECT * FROM attachments WHERE problem_id = ? ORDER BY created_at", [id]),
    ]);
    return {
      ...mapProblemCore(rows[0]),
      lectureIds: lectures.map((l) => l.lecture_id),
      topicIds: topics.map((t) => t.topic_id),
      parts: parts.map(mapPart),
      attempts: attempts.map(mapAttempt),
      history: history.map(mapHistory),
      attachments: attachments.map(mapAttachment),
    };
  }

  /** Statements that insert a complete problem (with parts, links, history and index). */
  problemInsert(input: NewProblem, now = nowIso()): { id: string; statements: Statement[] } {
    const id = input.id ?? newId("prb");
    const created = input.createdAt ?? now;
    const statements: Statement[] = [
      {
        sql: `INSERT INTO problems (id, title, statement, course_id, source_id, source_number, source_page, source_section,
                source_excerpt, difficulty, priority, category, status, solution, reference_solution, notes,
                last_attempt_at, review_due, import_flags, pinned, is_sample, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)`,
        params: [
          id,
          input.title ?? "",
          input.statement ?? "",
          input.courseId ?? null,
          input.sourceId ?? null,
          input.sourceNumber ?? "",
          input.sourcePage ?? null,
          input.sourceSection ?? "",
          input.sourceExcerpt ?? null,
          input.difficulty ?? null,
          input.priority ?? 0,
          input.category ?? null,
          input.status ?? "not_started",
          input.solution ?? "",
          input.referenceSolution ?? "",
          input.notes ?? "",
          input.reviewDue ?? null,
          JSON.stringify(input.importFlags ?? []),
          input.isSample ? 1 : 0,
          created,
          now,
        ],
      },
    ];
    for (const l of new Set(input.lectureIds ?? [])) {
      statements.push({ sql: "INSERT OR IGNORE INTO problem_lectures (problem_id, lecture_id) VALUES (?, ?)", params: [id, l] });
    }
    for (const t of new Set(input.topicIds ?? [])) {
      statements.push({ sql: "INSERT OR IGNORE INTO problem_topics (problem_id, topic_id) VALUES (?, ?)", params: [id, t] });
    }
    (input.parts ?? []).forEach((p, i) => statements.push(this.partInsert(id, p, i + 1, now).statement));
    statements.push(this.historyInsert(id, null, input.historyKind ?? "created", null, null, "", created));
    statements.push(...ftsStatements(id));
    return { id, statements };
  }

  private partInsert(problemId: string, p: NewPart, order: number, now: string): { id: string; statement: Statement } {
    const id = newId("prt");
    return {
      id,
      statement: {
        sql: `INSERT INTO problem_parts (id, problem_id, label, sort_order, statement, status, solution, reference_solution, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          problemId,
          p.label,
          order,
          p.statement ?? "",
          p.status ?? "not_started",
          p.solution ?? "",
          p.referenceSolution ?? "",
          p.notes ?? "",
          now,
          now,
        ],
      },
    };
  }

  private historyInsert(
    problemId: string,
    partId: string | null,
    kind: HistoryEvent["kind"],
    from: string | null,
    to: string | null,
    note = "",
    at = nowIso(),
  ): Statement {
    return {
      sql: "INSERT INTO history (id, problem_id, part_id, kind, from_value, to_value, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [newId("his"), problemId, partId, kind, from, to, note, at],
    };
  }

  async createProblem(input: NewProblem): Promise<string> {
    const { id, statements } = this.problemInsert(input);
    await this.tx(statements);
    return id;
  }

  /** Applies a partial update. Status and review-date changes are recorded in the history. */
  async updateProblem(id: string, patch: ProblemPatch, opts: { reindex?: boolean } = {}): Promise<void> {
    const stmts = await this.problemUpdateStatements(id, patch, opts.reindex ?? true);
    await this.tx(stmts);
  }

  private async problemUpdateStatements(id: string, patch: ProblemPatch, reindex: boolean): Promise<Statement[]> {
    const now = nowIso();
    const map: Record<string, string> = {
      title: "title",
      statement: "statement",
      courseId: "course_id",
      sourceId: "source_id",
      sourceNumber: "source_number",
      sourcePage: "source_page",
      sourceSection: "source_section",
      difficulty: "difficulty",
      priority: "priority",
      category: "category",
      status: "status",
      solution: "solution",
      referenceSolution: "reference_solution",
      notes: "notes",
      lastAttemptAt: "last_attempt_at",
      reviewDue: "review_due",
      importFlags: "import_flags",
      pinned: "pinned",
    };
    const stmts: Statement[] = [];
    let before: Row | undefined;
    if (patch.status !== undefined || patch.reviewDue !== undefined) {
      before = (await this.db.select("SELECT status, review_due, last_attempt_at FROM problems WHERE id = ?", [id]))[0];
    }
    const sets: string[] = [];
    const params: SqlParam[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (!(k in patch)) continue;
      let v = (patch as Record<string, unknown>)[k];
      if (k === "importFlags") v = JSON.stringify(v ?? []);
      if (typeof v === "boolean") v = v ? 1 : 0;
      sets.push(`${col} = ?`);
      params.push((v ?? null) as SqlParam);
    }
    if (patch.status !== undefined && before && before.status !== patch.status) {
      stmts.push(this.historyInsert(id, null, "status", str(before.status), patch.status, "", now));
      if (patch.status !== "not_started" && !("lastAttemptAt" in patch)) {
        sets.push("last_attempt_at = ?");
        params.push(now);
      }
    }
    if (patch.reviewDue !== undefined && before && strOrNull(before.review_due) !== patch.reviewDue) {
      stmts.push(this.historyInsert(id, null, "review-date", strOrNull(before.review_due), patch.reviewDue, "", now));
    }
    if (sets.length || patch.lectureIds || patch.topicIds) {
      sets.push("updated_at = ?");
      params.push(now, id);
      stmts.unshift({ sql: `UPDATE problems SET ${sets.join(", ")} WHERE id = ?`, params });
    }
    if (patch.lectureIds) {
      stmts.push({ sql: "DELETE FROM problem_lectures WHERE problem_id = ?", params: [id] });
      for (const l of new Set(patch.lectureIds)) {
        stmts.push({ sql: "INSERT OR IGNORE INTO problem_lectures (problem_id, lecture_id) VALUES (?, ?)", params: [id, l] });
      }
    }
    if (patch.topicIds) {
      stmts.push({ sql: "DELETE FROM problem_topics WHERE problem_id = ?", params: [id] });
      for (const t of new Set(patch.topicIds)) {
        stmts.push({ sql: "INSERT OR IGNORE INTO problem_topics (problem_id, topic_id) VALUES (?, ?)", params: [id, t] });
      }
    }
    if (reindex && stmts.length) stmts.push(...ftsStatements(id));
    return stmts;
  }

  async setStatus(ids: string[], status: Status): Promise<void> {
    const stmts: Statement[] = [];
    for (const id of ids) stmts.push(...(await this.problemUpdateStatements(id, { status }, false)));
    await this.tx(stmts);
  }

  async bulkUpdate(ids: string[], op: BulkUpdate): Promise<void> {
    if (!ids.length) return;
    const now = nowIso();
    const stmts: Statement[] = [];
    for (const id of ids) {
      const patch: ProblemPatch = {};
      if (op.courseId !== undefined) patch.courseId = op.courseId;
      if (op.difficulty !== undefined) patch.difficulty = op.difficulty;
      if (op.category !== undefined) patch.category = op.category;
      if (op.priority !== undefined) patch.priority = op.priority;
      if (op.status !== undefined) patch.status = op.status;
      if (op.reviewDue !== undefined) patch.reviewDue = op.reviewDue;
      if (op.sourceId !== undefined) patch.sourceId = op.sourceId;
      stmts.push(...(await this.problemUpdateStatements(id, patch, false)));
      for (const t of op.addTopicIds ?? []) {
        stmts.push({ sql: "INSERT OR IGNORE INTO problem_topics (problem_id, topic_id) VALUES (?, ?)", params: [id, t] });
      }
      for (const t of op.removeTopicIds ?? []) {
        stmts.push({ sql: "DELETE FROM problem_topics WHERE problem_id = ? AND topic_id = ?", params: [id, t] });
      }
      for (const l of op.addLectureIds ?? []) {
        stmts.push({ sql: "INSERT OR IGNORE INTO problem_lectures (problem_id, lecture_id) VALUES (?, ?)", params: [id, l] });
      }
      for (const l of op.removeLectureIds ?? []) {
        stmts.push({ sql: "DELETE FROM problem_lectures WHERE problem_id = ? AND lecture_id = ?", params: [id, l] });
      }
      stmts.push({ sql: "UPDATE problems SET updated_at = ? WHERE id = ?", params: [now, id] });
      stmts.push(...ftsStatements(id));
    }
    await this.tx(stmts);
  }

  async duplicateProblem(id: string): Promise<string> {
    const p = await this.getProblem(id);
    if (!p) throw new Error("Problem not found");
    return this.createProblem({
      title: p.title ? `${p.title} (copy)` : "",
      statement: p.statement,
      courseId: p.courseId,
      sourceId: p.sourceId,
      sourceNumber: p.sourceNumber,
      sourcePage: p.sourcePage,
      sourceSection: p.sourceSection,
      difficulty: p.difficulty,
      priority: p.priority,
      category: p.category,
      referenceSolution: p.referenceSolution,
      lectureIds: p.lectureIds,
      topicIds: p.topicIds,
      parts: p.parts.map((x) => ({ label: x.label, statement: x.statement, referenceSolution: x.referenceSolution })),
    });
  }

  async trashProblems(ids: string[]): Promise<void> {
    const now = nowIso();
    await this.tx(
      ids.map((id) => ({ sql: "UPDATE problems SET deleted_at = ?, updated_at = ? WHERE id = ?", params: [now, now, id] })),
    );
  }

  async restoreProblems(ids: string[]): Promise<void> {
    const now = nowIso();
    const stmts: Statement[] = [];
    for (const id of ids) {
      stmts.push({ sql: "UPDATE problems SET deleted_at = NULL, updated_at = ? WHERE id = ?", params: [now, id] });
      stmts.push(this.historyInsert(id, null, "restored", null, null, "", now));
    }
    await this.tx(stmts);
  }

  /** Permanent deletion; only offered from the trash. */
  async purgeProblems(ids: string[]): Promise<void> {
    const stmts: Statement[] = [];
    for (const id of ids) {
      stmts.push(...ftsDeleteStatements(id));
      stmts.push({ sql: "DELETE FROM problems WHERE id = ?", params: [id] });
    }
    await this.tx(stmts);
  }

  async emptyTrash(): Promise<number> {
    const rows = await this.db.select<{ id: string }>("SELECT id FROM problems WHERE deleted_at IS NOT NULL");
    await this.purgeProblems(rows.map((r) => r.id));
    return rows.length;
  }

  // --------------------------------------------------------------- parts

  async addPart(problemId: string, part?: Partial<NewPart>): Promise<string> {
    const existing = await this.db.select<{ label: string; sort_order: number }>(
      "SELECT label, sort_order FROM problem_parts WHERE problem_id = ?",
      [problemId],
    );
    const label = part?.label ?? nextPartLabel(existing.map((e) => e.label));
    const order = existing.reduce((m, e) => Math.max(m, num(e.sort_order)), 0) + 1;
    const now = nowIso();
    const { id, statement } = this.partInsert(problemId, { ...part, label }, order, now);
    await this.tx([
      statement,
      { sql: "UPDATE problems SET updated_at = ? WHERE id = ?", params: [now, problemId] },
      ...ftsStatements(problemId),
    ]);
    return id;
  }

  /** Updates a part; when its status changes the parent status is re-derived from all parts. */
  async updatePart(partId: string, patch: PartPatch, opts: { reindex?: boolean } = {}): Promise<Status | null> {
    const rows = await this.db.select("SELECT * FROM problem_parts WHERE id = ?", [partId]);
    if (!rows[0]) throw new Error("Part not found");
    const part = mapPart(rows[0]);
    const now = nowIso();
    const map: Record<string, string> = {
      label: "label",
      statement: "statement",
      status: "status",
      solution: "solution",
      referenceSolution: "reference_solution",
      notes: "notes",
      sortOrder: "sort_order",
      lastAttemptAt: "last_attempt_at",
    };
    const sets: string[] = [];
    const params: SqlParam[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        params.push((patch as Record<string, SqlParam>)[k]);
      }
    }
    if (!sets.length) return null;
    const stmts: Statement[] = [];
    let newParentStatus: Status | null = null;
    if (patch.status && patch.status !== part.status) {
      if (patch.status !== "not_started" && !("lastAttemptAt" in patch)) {
        sets.push("last_attempt_at = ?");
        params.push(now);
      }
      stmts.push(this.historyInsert(part.problemId, partId, "status", part.status, patch.status, `Part (${part.label})`, now));
      const siblings = await this.db.select<{ id: string; status: Status }>(
        "SELECT id, status FROM problem_parts WHERE problem_id = ?",
        [part.problemId],
      );
      const statuses = siblings.map((s) => (s.id === partId ? patch.status! : s.status));
      const agg = aggregateStatus(statuses);
      const parent = (await this.db.select<{ status: Status }>("SELECT status FROM problems WHERE id = ?", [part.problemId]))[0];
      if (agg && parent && agg !== parent.status) {
        newParentStatus = agg;
        stmts.push({
          sql: "UPDATE problems SET status = ?, last_attempt_at = ?, updated_at = ? WHERE id = ?",
          params: [agg, now, now, part.problemId],
        });
        stmts.push(this.historyInsert(part.problemId, null, "status", parent.status, agg, "Derived from parts", now));
      }
    }
    sets.push("updated_at = ?");
    params.push(now, partId);
    stmts.unshift({ sql: `UPDATE problem_parts SET ${sets.join(", ")} WHERE id = ?`, params });
    stmts.push({ sql: "UPDATE problems SET updated_at = ? WHERE id = ?", params: [now, part.problemId] });
    if (opts.reindex ?? true) stmts.push(...ftsStatements(part.problemId));
    await this.tx(stmts);
    return newParentStatus;
  }

  async deletePart(partId: string): Promise<void> {
    const rows = await this.db.select<{ problem_id: string }>("SELECT problem_id FROM problem_parts WHERE id = ?", [partId]);
    if (!rows[0]) return;
    await this.tx([
      { sql: "DELETE FROM problem_parts WHERE id = ?", params: [partId] },
      { sql: "UPDATE problems SET updated_at = ? WHERE id = ?", params: [nowIso(), rows[0].problem_id] },
      ...ftsStatements(rows[0].problem_id),
    ]);
  }

  // ------------------------------------------------------------ attempts

  /** Records a finished attempt (a snapshot of the proof as written at that moment). */
  async addAttempt(problemId: string, partId: string | null, content: string, outcome: Outcome, note = ""): Promise<string> {
    const id = newId("atm");
    const now = nowIso();
    const stmts: Statement[] = [
      {
        sql: "INSERT INTO attempts (id, problem_id, part_id, content, outcome, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [id, problemId, partId, content, outcome, note, now],
      },
      this.historyInsert(problemId, partId, "attempt", null, outcome, note, now),
      {
        sql: `UPDATE problems SET last_attempt_at = ?, updated_at = ?,
                status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END
              WHERE id = ?`,
        params: [now, now, problemId],
      },
    ];
    if (partId) {
      stmts.push({ sql: "UPDATE problem_parts SET last_attempt_at = ?, updated_at = ? WHERE id = ?", params: [now, now, partId] });
    }
    stmts.push(...ftsStatements(problemId));
    await this.tx(stmts);
    return id;
  }

  async deleteAttempt(id: string): Promise<void> {
    const rows = await this.db.select<{ problem_id: string }>("SELECT problem_id FROM attempts WHERE id = ?", [id]);
    if (!rows[0]) return;
    await this.tx([{ sql: "DELETE FROM attempts WHERE id = ?", params: [id] }, ...ftsStatements(rows[0].problem_id)]);
  }

  // --------------------------------------------------------- attachments

  private attachmentInsert(a: Omit<Attachment, "id" | "createdAt">, now: string): { id: string; statement: Statement } {
    const id = newId("att");
    return {
      id,
      statement: {
        sql: `INSERT INTO attachments (id, problem_id, file_name, stored_path, mime, size, hash, caption, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, a.problemId, a.fileName, a.storedPath, a.mime, a.size, a.hash, a.caption, now],
      },
    };
  }

  /** Creates a problem together with its attachments (e.g. a cropped photo of the statement). */
  async createProblemWithAttachments(input: NewProblem, attachments: Omit<Attachment, "id" | "createdAt" | "problemId">[]): Promise<string> {
    const now = nowIso();
    const { id, statements } = this.problemInsert(input, now);
    for (const a of attachments) statements.push(this.attachmentInsert({ ...a, problemId: id }, now).statement);
    await this.tx(statements);
    return id;
  }

  /** Adds an attachment and applies a patch (e.g. referencing it in the solution) in one transaction. */
  async addAttachmentWithPatch(a: Omit<Attachment, "id" | "createdAt">, patch: ProblemPatch): Promise<string> {
    const { id, statement } = this.attachmentInsert(a, nowIso());
    await this.tx([statement, ...(await this.problemUpdateStatements(a.problemId, patch, true))]);
    return id;
  }

  async addAttachment(a: Omit<Attachment, "id" | "createdAt">): Promise<string> {
    const id = newId("att");
    const now = nowIso();
    await this.tx([
      {
        sql: `INSERT INTO attachments (id, problem_id, file_name, stored_path, mime, size, hash, caption, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, a.problemId, a.fileName, a.storedPath, a.mime, a.size, a.hash, a.caption, now],
      },
      { sql: "UPDATE problems SET updated_at = ? WHERE id = ?", params: [now, a.problemId] },
    ]);
    return id;
  }

  async updateAttachment(id: string, caption: string): Promise<void> {
    await this.tx([{ sql: "UPDATE attachments SET caption = ? WHERE id = ?", params: [caption, id] }]);
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.tx([{ sql: "DELETE FROM attachments WHERE id = ?", params: [id] }]);
  }

  // --------------------------------------------------------- saved views

  async listViews(): Promise<SavedView[]> {
    const rows = await this.db.select("SELECT * FROM saved_views ORDER BY sort_order, name");
    return rows.map(mapView);
  }

  async saveView(view: Pick<SavedView, "name" | "filter" | "sort"> & { id?: string }): Promise<string> {
    const now = nowIso();
    if (view.id) {
      await this.tx([
        {
          sql: "UPDATE saved_views SET name = ?, filter = ?, sort = ?, updated_at = ? WHERE id = ?",
          params: [view.name, JSON.stringify(view.filter), view.sort ? JSON.stringify(view.sort) : null, now, view.id],
        },
      ]);
      return view.id;
    }
    const id = newId("vw");
    const max = await this.db.select<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM saved_views");
    await this.tx([
      {
        sql: "INSERT INTO saved_views (id, name, filter, sort, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [id, view.name, JSON.stringify(view.filter), view.sort ? JSON.stringify(view.sort) : null, num(max[0]?.m) + 1, now, now],
      },
    ]);
    return id;
  }

  async deleteView(id: string): Promise<void> {
    await this.tx([{ sql: "DELETE FROM saved_views WHERE id = ?", params: [id] }]);
  }

  // -------------------------------------------------------------- recent

  async touchRecent(problemId: string): Promise<void> {
    await this.tx([
      { sql: "INSERT OR REPLACE INTO recent_views (problem_id, viewed_at) VALUES (?, ?)", params: [problemId, nowIso()] },
      {
        sql: "DELETE FROM recent_views WHERE problem_id NOT IN (SELECT problem_id FROM recent_views ORDER BY viewed_at DESC LIMIT 50)",
      },
    ]);
  }

  async listRecent(): Promise<string[]> {
    const rows = await this.db.select<{ problem_id: string }>("SELECT problem_id FROM recent_views ORDER BY viewed_at DESC");
    return rows.map((r) => r.problem_id);
  }

  // -------------------------------------------------------------- search

  /** Full-text search. Returns problem ids mapped to a relevance score (title hits rank higher). */
  async search(text: string): Promise<Map<string, number>> {
    const q = toFtsQuery(text);
    const out = new Map<string, number>();
    if (!q) return out;
    const all = await this.db.select<{ problem_id: string }>(
      "SELECT problem_id FROM problem_fts WHERE problem_fts MATCH ?",
      [q],
    );
    for (const r of all) out.set(r.problem_id, 1);
    const titleQ = q
      .split(" ")
      .map((t) => `title:${t}`)
      .join(" ");
    const titled = await this.db.select<{ problem_id: string }>(
      "SELECT problem_id FROM problem_fts WHERE problem_fts MATCH ?",
      [titleQ],
    );
    for (const r of titled) out.set(r.problem_id, 2);
    return out;
  }

  private async reindexWhere(where: string, params: SqlParam[]): Promise<Statement[]> {
    const rows = await this.db.select<{ id: string }>(`SELECT id FROM problems WHERE ${where}`, params);
    return rows.flatMap((r) => ftsStatements(r.id));
  }

  async reindexAll(): Promise<number> {
    const rows = await this.db.select<{ id: string }>("SELECT id FROM problems");
    await this.tx([
      { sql: "DELETE FROM problem_fts" },
      { sql: "DELETE FROM fts_map" },
      ...rows.flatMap((r) => ftsStatements(r.id)),
    ]);
    return rows.length;
  }

  /** Raw statements of all problems, for duplicate detection during import. */
  async listStatements(): Promise<{ id: string; title: string; statement: string; sourceId: string | null; sourceNumber: string }[]> {
    // Part statements are included so multi-part problems compare as a whole.
    const rows = await this.db.select(
      `SELECT p.id, p.title, p.source_id, p.source_number,
         p.statement || ' ' || COALESCE((SELECT group_concat(x.label || ' ' || x.statement, ' ')
           FROM problem_parts x WHERE x.problem_id = p.id), '') AS statement
       FROM problems p WHERE p.deleted_at IS NULL`,
    );
    return rows.map((r) => ({
      id: str(r.id),
      title: str(r.title),
      statement: str(r.statement),
      sourceId: strOrNull(r.source_id),
      sourceNumber: str(r.source_number),
    }));
  }

  /** Executes externally composed statements atomically (import commit, library restore, sample data). */
  run(statements: Statement[]): Promise<void> {
    return this.tx(statements);
  }

  // ---------------------------------------------------------- sample data

  async hasSample(): Promise<boolean> {
    const rows = await this.db.select<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM courses WHERE is_sample = 1) + (SELECT COUNT(*) FROM problems WHERE is_sample = 1) +
              (SELECT COUNT(*) FROM topics WHERE is_sample = 1) AS n`,
    );
    return num(rows[0]?.n) > 0;
  }

  /** Removes everything marked as sample data. User-created items are never touched. */
  async removeSample(): Promise<void> {
    const ids = await this.db.select<{ id: string }>("SELECT id FROM problems WHERE is_sample = 1");
    const stmts: Statement[] = [];
    for (const r of ids) stmts.push(...ftsDeleteStatements(r.id));
    stmts.push(
      { sql: "DELETE FROM problems WHERE is_sample = 1" },
      { sql: "DELETE FROM sources WHERE is_sample = 1" },
      { sql: "DELETE FROM lectures WHERE is_sample = 1" },
      { sql: "DELETE FROM courses WHERE is_sample = 1" },
      { sql: "DELETE FROM topics WHERE is_sample = 1" },
    );
    // Topics still referenced by user problems survive the sample removal.
    const keep = await this.db.select<{ id: string }>(
      `SELECT DISTINCT t.id FROM topics t JOIN problem_topics pt ON pt.topic_id = t.id
       JOIN problems p ON p.id = pt.problem_id WHERE t.is_sample = 1 AND p.is_sample = 0`,
    );
    if (keep.length) {
      stmts.splice(stmts.length - 1, 0, {
        sql: `UPDATE topics SET is_sample = 0 WHERE id IN (${placeholders(keep.length)})`,
        params: keep.map((k) => k.id),
      });
    }
    await this.tx(stmts);
  }
}
