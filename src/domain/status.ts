import type { Category, Outcome, Status } from "../data/types";

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  needs_review: "Needs Review",
  mastered: "Mastered",
};

/** Single-key shortcuts used in the list and problem view (Alt+1 … Alt+5). */
export const STATUS_KEYS: Record<Status, string> = {
  not_started: "1",
  in_progress: "2",
  completed: "3",
  needs_review: "4",
  mastered: "5",
};

export const STATUS_RANK: Record<Status, number> = {
  not_started: 0,
  in_progress: 1,
  needs_review: 2,
  completed: 3,
  mastered: 4,
};

export const CATEGORY_LABEL: Record<Category, string> = {
  proof: "Proof",
  calculation: "Calculation",
  conceptual: "Conceptual",
  application: "Application",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  incomplete: "Incomplete",
  incorrect: "Incorrect",
  unsure: "Unsure",
  correct: "Correct",
};

export const PRIORITY_LABEL: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
};

export const DIFFICULTY_LABEL: Record<number, string> = {
  1: "Routine",
  2: "Moderate",
  3: "Challenging",
  4: "Hard",
};

export function isDone(s: Status): boolean {
  return s === "completed" || s === "mastered";
}

/**
 * Status of a multi-part problem derived from its parts. Applied whenever a
 * part's status changes; the parent status can still be set directly.
 */
export function aggregateStatus(parts: Status[]): Status | null {
  if (parts.length === 0) return null;
  if (parts.every((s) => s === "mastered")) return "mastered";
  if (parts.some((s) => s === "needs_review")) return "needs_review";
  if (parts.every(isDone)) return "completed";
  if (parts.some((s) => s !== "not_started")) return "in_progress";
  return "not_started";
}
