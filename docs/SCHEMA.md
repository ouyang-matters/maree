# Marée data formats

Marée stores everything locally. This document describes the three formats you may
meet outside the application: the **problem-set JSON** you can write by hand and import,
the **library JSON** used for exports and backups, and the **backup archive**. The SQLite
schema is described at the end for completeness.

All text fields that contain mathematics use *LaTeX-flavoured Markdown*: Markdown with
LaTeX formulas in `\( … \)`, `$ … $`, `\[ … \]`, `$$ … $$` or AMS environments such as
`\begin{align*} … \end{align*}`. Formulas are stored exactly as written.

---

## 1. Problem-set JSON (`"format": "maree-problems"`)

A lightweight format for writing or generating exercises outside Marée. Import it with
**File › Import Exercises…** (or drag the file into the window); it goes through the
normal import review, so you can still check classification before saving.

```json
{
  "format": "maree-problems",
  "version": 1,
  "course": "MATH 147",
  "source": { "title": "Problem Set 4", "kind": "problem-set", "author": "" },
  "problems": [
    {
      "number": "4",
      "title": "A recursive sequence",
      "statement": "Let \\(x_1 = 1\\) and \\(x_{n+1} = \\sqrt{2 + x_n}\\).",
      "parts": [
        { "label": "a", "statement": "Show that \\((x_n)\\) is increasing." },
        { "label": "b", "statement": "Find \\(\\lim x_n\\)." }
      ],
      "lecture": "9",
      "topics": ["MCT", "Recursive Sequences"],
      "difficulty": 3,
      "category": "proof",
      "referenceSolution": "",
      "notes": "",
      "page": 2
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `format` | `"maree-problems"` | Optional but recommended. A bare array of problems is also accepted. |
| `version` | number | Currently `1`. |
| `course` | string | Course code or title; matched against existing courses. |
| `source.title`, `source.kind`, `source.author` | string | Provenance. `kind` is one of `lecture-notes`, `problem-set`, `assignment`, `textbook`, `exam`, `article`, `web`, `manual`, `other`. |
| `problems[].statement` | string | **Required** (unless `parts` is given). Also accepted: `text`, `problem`. |
| `problems[].number` | string | Original problem number, kept verbatim (`"2.3.7"`, `"4b"`). |
| `problems[].parts[]` | `{label, statement}` | Sub-questions with their own status and solutions. |
| `problems[].lecture` | string | Lecture number; mapped to the course's lectures (or created). |
| `problems[].topics` | string[] | Topic names; existing topics are matched, others are offered for creation. |
| `problems[].difficulty` | 1–4 | 1 routine · 2 moderate · 3 challenging · 4 hard. |
| `problems[].category` | string | `proof`, `calculation`, `conceptual` or `application`. |
| `problems[].referenceSolution` | string | Also accepted: `solution`. Hidden by default in the app. |
| `problems[].page` | number | Page in the original document. |

---

## 2. Library JSON (`"format": "maree-library"`)

A complete, lossless description of a library. Produced by **File › Export Library as
JSON…** and contained in every backup archive. Importing it (**File › Import Library
(JSON)…** or **Restore Library Backup…**) offers two modes:

* **Merge** — inserts what is missing; rows that already exist (same `id`) are left alone.
* **Restore** — rows that exist in both are updated to the version in the file.

Neither mode deletes anything, and a database snapshot is taken first.

```jsonc
{
  "format": "maree-library",
  "version": 1,
  "exportedAt": "2026-10-11T09:30:00.000Z",
  "app": "Marée 1.0.0",
  "courses":  [ Course ],
  "lectures": [ Lecture ],
  "topics":   [ Topic ],
  "sources":  [ Source ],
  "problems": [ Problem ],
  "savedViews": [ SavedView ],
  "settings": { "katexMacros": { "\\R": "\\mathbb{R}" } }
}
```

Identifiers are opaque strings (`crs_…`, `lec_…`, `top_…`, `src_…`, `prb_…`); timestamps
are ISO 8601 (UTC); review dates are calendar days (`YYYY-MM-DD`).

### Course
`id, code, title, term, description, color, archived, sortOrder, isSample, createdAt, updatedAt`

### Lecture
`id, courseId, number, title, date (YYYY-MM-DD | null), description, sortOrder, isSample, createdAt, updatedAt`

### Topic
`id, parentId (null for top level), name, description, keywords (comma-separated aliases), sortOrder, isSample, createdAt, updatedAt`

### Source (provenance of imported documents)
`id, title, kind, format (pdf|markdown|latex|text|docx|json|image|""), author, section, url,
fileName, storedPath, originalPath, fileHash (SHA-256), fileSize, pageCount, courseId,
importedAt, notes, isSample, createdAt, updatedAt`

`storedPath` is relative to the library's `files/` directory (content-addressed:
`sources/ab/<sha256>.pdf`).

### Problem
| Field | Notes |
|---|---|
| `id, title, statement` | |
| `courseId, lectureIds[], topicIds[]` | Lectures and topics are many-to-many. |
| `sourceId, sourceNumber, sourcePage, sourceSection` | Provenance; `sourceNumber` is the original problem number. |
| `sourceExcerpt` | The text exactly as extracted at import time (never modified). |
| `difficulty` | 1–4 or `null`. |
| `priority` | 0 none · 1 low · 2 medium · 3 high. |
| `category` | `proof`, `calculation`, `conceptual`, `application` or `null`. |
| `status` | `not_started`, `in_progress`, `completed`, `needs_review`, `mastered`. |
| `solution, referenceSolution, notes` | The current draft, the (hidden) reference solution, and notes. |
| `lastAttemptAt, reviewDue` | |
| `importFlags[]` | `{code, message}` items still to be checked after import. |
| `pinned, isSample, createdAt, updatedAt, deletedAt` | `deletedAt` is set while the problem is in the Trash. |
| `parts[]` | `{id, label, sortOrder, statement, status, solution, referenceSolution, notes, lastAttemptAt, createdAt, updatedAt}` |
| `attempts[]` | `{id, partId, content, outcome (incomplete|incorrect|unsure|correct), note, createdAt}` — immutable snapshots. |
| `history[]` | `{id, partId, kind (created|imported|status|attempt|review-date|restored), fromValue, toValue, note, createdAt}` |
| `attachments[]` | `{id, fileName, storedPath, mime, size, hash, caption, createdAt}` |

### SavedView
`id, name, filter (FilterSpec), sort ({key, dir} | null), sortOrder, createdAt, updatedAt`

`FilterSpec` fields (all optional, combined with AND): `text, courseIds[], lectureIds[],
lectureMode (any|all), topicIds[], topicMode (any|all), includeSubtopics, sourceIds[],
statuses[], difficulties[] (0 = unrated), categories[] ("none" allowed), priorities[],
review (due|scheduled|unscheduled), flags[] (import-review, has-solution, no-solution,
has-reference, pinned, sample, has-parts), attemptedWithinDays, neverAttempted`.

---

## 3. Backup archive (`Maree-backup-YYYY-MM-DD.zip`)

```
library.json    the library JSON described above (including the Trash)
maree.sqlite    a point-in-time copy of the database (SQLite, VACUUM INTO)
files/          original source documents and attachments, content-addressed
README.txt
```

Restoring copies any missing files into the library and imports `library.json`; existing
files are never overwritten. `maree.sqlite` is there for disaster recovery: it can be
opened with any SQLite tool.

---

## 4. SQLite schema (version 1)

The database lives at `%APPDATA%\com.maree.library\maree.db` (or in `MareeData\` next to
the executable in portable mode). Migrations are append-only (`src/data/schema.ts`), run in
a transaction together with `PRAGMA user_version`, and an existing database is
snapshotted to `backups\` before any migration touches it. A database created by a newer
Marée is refused rather than modified.

| Table | Purpose |
|---|---|
| `courses`, `lectures`, `topics`, `sources` | Organisation and provenance. |
| `problems`, `problem_parts` | Exercises and their sub-questions. |
| `problem_lectures`, `problem_topics` | Many-to-many links (cascade on delete). |
| `attempts`, `history`, `attachments` | Per-problem records (cascade on delete). |
| `saved_views`, `recent_views`, `settings` | Interface state. |
| `problem_fts` (FTS4, unicode61, diacritics removed) + `fts_map` | Full-text index over titles, statements, solutions, notes and metadata. |

Foreign keys are enforced; WAL journaling is used; every multi-row change runs inside a
single transaction.
