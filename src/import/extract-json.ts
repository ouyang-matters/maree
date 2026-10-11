// JSON problem sets ("maree-problems" format, see docs/SCHEMA.md).

import type { Category, SourceKind } from "../data/types";
import type { ExtractedDocument, StructuredProblem } from "./types";

const CATS: Category[] = ["proof", "calculation", "conceptual", "application"];

function asString(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

export function isLibraryJson(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { format?: string }).format === "maree-library";
}

export function extractProblemSetJson(fileName: string, value: unknown): ExtractedDocument {
  const root = (Array.isArray(value) ? { problems: value } : value) as Record<string, unknown>;
  const list = Array.isArray(root.problems) ? root.problems : null;
  if (!list) {
    throw new Error('Unrecognised JSON. Expected a Marée problem set ({"format": "maree-problems", "problems": [...]}) or a library export.');
  }
  const src = (root.source ?? {}) as Record<string, unknown>;
  const structured: StructuredProblem[] = list.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const statement = asString(p.statement ?? p.text ?? p.problem);
    if (!statement && !Array.isArray(p.parts)) throw new Error(`Problem ${i + 1} has no "statement".`);
    const difficulty = typeof p.difficulty === "number" && p.difficulty >= 1 && p.difficulty <= 4 ? Math.round(p.difficulty) : null;
    const category = CATS.includes(p.category as Category) ? (p.category as Category) : null;
    return {
      number: asString(p.number ?? p.id),
      title: asString(p.title),
      statement,
      parts: Array.isArray(p.parts)
        ? p.parts.map((x: Record<string, unknown>, j: number) => ({
            label: asString(x.label) || "abcdefghijklmnopqrstuvwxyz"[j],
            statement: asString(x.statement ?? x.text),
          }))
        : undefined,
      lecture: asString(p.lecture),
      topics: Array.isArray(p.topics) ? p.topics.map(asString).filter(Boolean) : undefined,
      difficulty,
      category,
      referenceSolution: asString(p.referenceSolution ?? p.solution),
      notes: asString(p.notes),
      page: typeof p.page === "number" ? p.page : null,
    };
  });
  return {
    fileName,
    format: "json",
    title: asString(src.title) || asString(root.title) || fileName.replace(/\.[^.]+$/, ""),
    lines: [],
    reliability: "exact",
    warnings: [],
    structured,
    meta: {
      course: asString(root.course),
      sourceTitle: asString(src.title),
      sourceKind: (asString(src.kind) || undefined) as SourceKind | undefined,
      author: asString(src.author),
    },
  };
}
