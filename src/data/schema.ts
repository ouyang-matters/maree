// Versioned, append-only schema migrations. Never edit a published migration:
// add a new one instead. `PRAGMA user_version` records the applied version.

import type { SqlDriver } from "./driver";

export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

const common = `is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial library schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        term TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        color TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        sort_order REAL NOT NULL DEFAULT 0,
        ${common}
      )`,
      `CREATE TABLE lectures (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        number TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        date TEXT,
        description TEXT NOT NULL DEFAULT '',
        sort_order REAL NOT NULL DEFAULT 0,
        ${common}
      )`,
      `CREATE INDEX idx_lectures_course ON lectures(course_id)`,
      `CREATE TABLE topics (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        keywords TEXT NOT NULL DEFAULT '',
        sort_order REAL NOT NULL DEFAULT 0,
        ${common}
      )`,
      `CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        format TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        section TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        file_name TEXT,
        stored_path TEXT,
        original_path TEXT,
        file_hash TEXT,
        file_size INTEGER,
        page_count INTEGER,
        course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
        imported_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        ${common}
      )`,
      `CREATE INDEX idx_sources_hash ON sources(file_hash)`,
      `CREATE TABLE problems (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        statement TEXT NOT NULL DEFAULT '',
        course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        source_number TEXT NOT NULL DEFAULT '',
        source_page INTEGER,
        source_section TEXT NOT NULL DEFAULT '',
        source_excerpt TEXT,
        difficulty INTEGER,
        priority INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'not_started',
        solution TEXT NOT NULL DEFAULT '',
        reference_solution TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        last_attempt_at TEXT,
        review_due TEXT,
        import_flags TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        ${common}
      )`,
      `CREATE INDEX idx_problems_course ON problems(course_id)`,
      `CREATE INDEX idx_problems_source ON problems(source_id)`,
      `CREATE INDEX idx_problems_status ON problems(status)`,
      `CREATE TABLE problem_parts (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT '',
        sort_order REAL NOT NULL DEFAULT 0,
        statement TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'not_started',
        solution TEXT NOT NULL DEFAULT '',
        reference_solution TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        last_attempt_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_parts_problem ON problem_parts(problem_id)`,
      `CREATE TABLE problem_lectures (
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
        PRIMARY KEY (problem_id, lecture_id)
      )`,
      `CREATE INDEX idx_pl_lecture ON problem_lectures(lecture_id)`,
      `CREATE TABLE problem_topics (
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        PRIMARY KEY (problem_id, topic_id)
      )`,
      `CREATE INDEX idx_pt_topic ON problem_topics(topic_id)`,
      `CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        part_id TEXT REFERENCES problem_parts(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL DEFAULT 'incomplete',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_attempts_problem ON attempts(problem_id)`,
      `CREATE TABLE history (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        part_id TEXT,
        kind TEXT NOT NULL,
        from_value TEXT,
        to_value TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_history_problem ON history(problem_id)`,
      `CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        hash TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_attachments_problem ON attachments(problem_id)`,
      `CREATE TABLE saved_views (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filter TEXT NOT NULL DEFAULT '{}',
        sort TEXT,
        sort_order REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE recent_views (
        problem_id TEXT PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
        viewed_at TEXT NOT NULL
      )`,
      // Stable docid per problem: FTS4 docids survive VACUUM, problems' implicit rowids do not.
      `CREATE TABLE fts_map (
        problem_id TEXT PRIMARY KEY,
        docid INTEGER NOT NULL UNIQUE
      )`,
      `CREATE VIRTUAL TABLE problem_fts USING fts4(
        problem_id, title, statement, work, meta,
        notindexed=problem_id,
        tokenize=unicode61 "remove_diacritics=2"
      )`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function currentVersion(db: SqlDriver): Promise<number> {
  const rows = await db.select<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: number[];
  backup: string | null;
}

/**
 * Applies pending migrations. Each migration runs in its own transaction together
 * with the version bump, so a failure leaves the database at the previous version.
 * Existing databases are snapshotted before any migration touches them.
 */
export async function migrate(db: SqlDriver): Promise<MigrationReport> {
  const from = await currentVersion(db);
  if (from > LATEST_VERSION) {
    throw new Error(
      `This library was created by a newer version of Marée (schema v${from}; this build supports v${LATEST_VERSION}). ` +
        `Please update Marée — the library has not been modified.`,
    );
  }
  const pending = MIGRATIONS.filter((m) => m.version > from);
  let backup: string | null = null;
  if (pending.length && from > 0 && db.snapshot) {
    backup = await db.snapshot(`pre-migration-v${from}-to-v${LATEST_VERSION}`);
  }
  for (const m of pending) {
    await db.batch([...m.statements.map((sql) => ({ sql })), { sql: `PRAGMA user_version = ${m.version}` }]);
  }
  return { from, to: LATEST_VERSION, applied: pending.map((m) => m.version), backup };
}
