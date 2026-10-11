// Domain types shared by the repository, state store, importers and exporters.

export type Status = "not_started" | "in_progress" | "completed" | "needs_review" | "mastered";
export const STATUSES: Status[] = ["not_started", "in_progress", "completed", "needs_review", "mastered"];

export type Category = "proof" | "calculation" | "conceptual" | "application";
export const CATEGORIES: Category[] = ["proof", "calculation", "conceptual", "application"];

export type Outcome = "incomplete" | "incorrect" | "unsure" | "correct";
export const OUTCOMES: Outcome[] = ["incomplete", "incorrect", "unsure", "correct"];

export type SourceKind =
  | "lecture-notes"
  | "problem-set"
  | "assignment"
  | "textbook"
  | "exam"
  | "article"
  | "web"
  | "manual"
  | "other";
export const SOURCE_KINDS: SourceKind[] = [
  "lecture-notes",
  "problem-set",
  "assignment",
  "textbook",
  "exam",
  "article",
  "web",
  "manual",
  "other",
];

export type SourceFormat = "pdf" | "markdown" | "latex" | "text" | "docx" | "json" | "image" | "";

export interface Course {
  id: string;
  code: string;
  title: string;
  term: string;
  description: string;
  color: string | null;
  archived: boolean;
  sortOrder: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Lecture {
  id: string;
  courseId: string;
  number: string;
  title: string;
  date: string | null;
  description: string;
  sortOrder: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Topic {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  /** Comma- or newline-separated aliases used by the import classifier. */
  keywords: string;
  sortOrder: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  title: string;
  kind: SourceKind;
  format: SourceFormat;
  author: string;
  section: string;
  url: string;
  fileName: string | null;
  storedPath: string | null;
  originalPath: string | null;
  fileHash: string | null;
  fileSize: number | null;
  pageCount: number | null;
  courseId: string | null;
  importedAt: string | null;
  notes: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportFlag {
  code:
    | "math-unicode"
    | "lost-scripts"
    | "garbled"
    | "assisted-latex"
    | "no-text"
    | "long"
    | "short"
    | "low-confidence"
    | "docx-math-partial"
    | "possible-duplicate";
  message: string;
}

export interface ProblemPart {
  id: string;
  problemId: string;
  label: string;
  sortOrder: number;
  statement: string;
  status: Status;
  solution: string;
  referenceSolution: string;
  notes: string;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attempt {
  id: string;
  problemId: string;
  partId: string | null;
  content: string;
  outcome: Outcome;
  note: string;
  createdAt: string;
}

export interface HistoryEvent {
  id: string;
  problemId: string;
  partId: string | null;
  kind: "created" | "imported" | "status" | "attempt" | "review-date" | "restored";
  fromValue: string | null;
  toValue: string | null;
  note: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  problemId: string;
  fileName: string;
  storedPath: string;
  mime: string;
  size: number;
  hash: string;
  caption: string;
  createdAt: string;
}

/** Columns of the `problems` table, used for both full records and list summaries. */
export interface ProblemCore {
  id: string;
  title: string;
  statement: string;
  courseId: string | null;
  sourceId: string | null;
  sourceNumber: string;
  sourcePage: number | null;
  sourceSection: string;
  sourceExcerpt: string | null;
  difficulty: number | null;
  priority: number;
  category: Category | null;
  status: Status;
  solution: string;
  referenceSolution: string;
  notes: string;
  lastAttemptAt: string | null;
  reviewDue: string | null;
  importFlags: ImportFlag[];
  pinned: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Problem extends ProblemCore {
  lectureIds: string[];
  topicIds: string[];
  parts: ProblemPart[];
  attempts: Attempt[];
  history: HistoryEvent[];
  attachments: Attachment[];
}

/** Lightweight row kept in memory for the problem list, filters and review queue. */
export interface ProblemSummary {
  id: string;
  title: string;
  preview: string;
  courseId: string | null;
  sourceId: string | null;
  sourceNumber: string;
  sourcePage: number | null;
  difficulty: number | null;
  priority: number;
  category: Category | null;
  status: Status;
  lastAttemptAt: string | null;
  reviewDue: string | null;
  hasSolution: boolean;
  hasReference: boolean;
  needsImportReview: boolean;
  pinned: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lectureIds: string[];
  topicIds: string[];
  partCount: number;
  partsDone: number;
  attemptCount: number;
  lastOutcome: Outcome | null;
}

export type ProblemPatch = Partial<
  Pick<
    ProblemCore,
    | "title"
    | "statement"
    | "courseId"
    | "sourceId"
    | "sourceNumber"
    | "sourcePage"
    | "sourceSection"
    | "difficulty"
    | "priority"
    | "category"
    | "status"
    | "solution"
    | "referenceSolution"
    | "notes"
    | "lastAttemptAt"
    | "reviewDue"
    | "importFlags"
    | "pinned"
  >
> & { lectureIds?: string[]; topicIds?: string[] };

export type PartPatch = Partial<
  Pick<ProblemPart, "label" | "statement" | "status" | "solution" | "referenceSolution" | "notes" | "sortOrder" | "lastAttemptAt">
>;

export interface NewPart {
  label: string;
  statement?: string;
  status?: Status;
  solution?: string;
  referenceSolution?: string;
  notes?: string;
}

export interface NewProblem {
  id?: string;
  title?: string;
  statement?: string;
  courseId?: string | null;
  sourceId?: string | null;
  sourceNumber?: string;
  sourcePage?: number | null;
  sourceSection?: string;
  sourceExcerpt?: string | null;
  difficulty?: number | null;
  priority?: number;
  category?: Category | null;
  status?: Status;
  solution?: string;
  referenceSolution?: string;
  notes?: string;
  reviewDue?: string | null;
  importFlags?: ImportFlag[];
  lectureIds?: string[];
  topicIds?: string[];
  parts?: NewPart[];
  isSample?: boolean;
  createdAt?: string;
  historyKind?: "created" | "imported";
}

export type TopicMode = "any" | "all";

/** A combinable, serialisable filter. Empty arrays / undefined mean "no constraint". */
export interface FilterSpec {
  text?: string;
  courseIds?: string[];
  lectureIds?: string[];
  lectureMode?: TopicMode;
  topicIds?: string[];
  topicMode?: TopicMode;
  includeSubtopics?: boolean;
  sourceIds?: string[];
  statuses?: Status[];
  /** 0 represents "no difficulty set". */
  difficulties?: number[];
  categories?: (Category | "none")[];
  priorities?: number[];
  review?: "due" | "scheduled" | "unscheduled";
  flags?: ("import-review" | "has-solution" | "no-solution" | "has-reference" | "pinned" | "sample" | "has-parts")[];
  attemptedWithinDays?: number;
  neverAttempted?: boolean;
}

export type SortKey =
  | "number"
  | "title"
  | "course"
  | "lecture"
  | "topic"
  | "difficulty"
  | "priority"
  | "status"
  | "category"
  | "source"
  | "lastAttempt"
  | "reviewDue"
  | "updated"
  | "created";

export interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}

export interface SavedView {
  id: string;
  name: string;
  filter: FilterSpec;
  sort: SortSpec | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
