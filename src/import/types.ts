import type { Category, ImportFlag, SourceFormat, SourceKind } from "../data/types";

/** One logical line of an extracted document. An empty `text` marks a paragraph break. */
export interface ExtractedLine {
  /** Content as it will appear in the statement (Markdown + LaTeX). */
  text: string;
  /** PDF only: best-effort LaTeX reconstruction of the same line (always flagged). */
  assisted?: string;
  page?: number;
  /** Indentation level relative to the left margin (0 = flush). */
  indent?: number;
  /** Heading level (1–6) when the line is a heading. */
  heading?: number;
  /** Structural markers supplied by structured formats (LaTeX environments, DOCX numbering). */
  marker?:
    | { kind: "problem"; number?: string; title?: string }
    | { kind: "part"; label: string }
    | { kind: "end" };
  /** Explicit list label from the document structure, e.g. "3." or "(a)". */
  listLabel?: string;
  listLevel?: number;
  /** Lines inside a solution environment become the reference solution. */
  role?: "solution";
  flags?: ImportFlag[];
}

export interface ExtractedDocument {
  fileName: string;
  format: SourceFormat;
  title: string;
  lines: ExtractedLine[];
  pageCount?: number;
  /** How faithfully the text reflects the original mathematics. */
  reliability: "exact" | "structured" | "uncertain";
  warnings: string[];
  /** Images (e.g. an image file imported as a problem attachment). */
  images?: { name: string; bytes: Uint8Array; mime: string }[];
  /** PDF: pages without a usable text layer (likely scanned). */
  emptyPages?: number[];
  /** Pre-built problems from structured JSON problem sets. */
  structured?: StructuredProblem[];
  /** Extra metadata suggested by the file (JSON problem sets). */
  meta?: { course?: string; sourceTitle?: string; sourceKind?: SourceKind; author?: string };
}

export interface StructuredProblem {
  number?: string;
  title?: string;
  statement: string;
  parts?: { label: string; statement: string }[];
  lecture?: string;
  topics?: string[];
  difficulty?: number | null;
  category?: Category | null;
  referenceSolution?: string;
  notes?: string;
  page?: number | null;
}

export interface SegmentedProblem {
  number: string;
  title: string;
  /** All original lines of the problem, including its marker line. */
  raw: ExtractedLine[];
  lines: ExtractedLine[];
  parts: { label: string; lines: ExtractedLine[] }[];
  solution: ExtractedLine[];
  page: number | null;
  pageEnd: number | null;
  lecture: { number: string; title: string } | null;
  section: string;
  confidence: "high" | "medium" | "low";
}

export interface Segmentation {
  style: "structured" | "keyword" | "numbered" | "headings" | "single";
  preamble: ExtractedLine[];
  problems: SegmentedProblem[];
  lectures: { number: string; title: string; page: number | null }[];
}

export interface CandidatePart {
  label: string;
  statement: string;
}

/** An editable problem proposed by the import wizard. */
export interface Candidate {
  key: string;
  include: boolean;
  number: string;
  title: string;
  /** Working copy of the statement (what will be saved). */
  statement: string;
  /** Plain statement with parts inline; used for duplicate detection. */
  wholeStatement: string;
  /** The text exactly as segmented (before any user edits or assisted conversion). */
  plain: { statement: string; parts: CandidatePart[] };
  /** Exact text as extracted; stored as provenance and never modified. */
  rawText: string;
  /** PDF only: assisted conversion of the statement, offered to the user. */
  assistedStatement: string | null;
  assistedParts: CandidatePart[] | null;
  usingAssisted: boolean;
  /** Working copy of the parts (empty when `splitParts` is false). */
  parts: CandidatePart[];
  splitParts: boolean;
  referenceSolution: string;
  notes: string;
  page: number | null;
  pageEnd: number | null;
  section: string;
  lectureRef: string | null;
  confidence: "high" | "medium" | "low";
  flags: ImportFlag[];
  /** Set once the user has checked/corrected the text; review flags are then not stored. */
  reviewed: boolean;
  lectureIds: string[];
  topicIds: string[];
  suggestedTopicNames: string[];
  category: Category | null;
  difficulty: number | null;
  duplicateOf: { id: string; label: string; similarity: number } | null;
  /** Attachment images to store with the problem (image imports). */
  images?: { name: string; bytes: Uint8Array; mime: string }[];
}
