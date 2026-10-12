// The problems the list shows, in its order — shared by the list and by ‹ › navigation.

import type { ProblemSummary } from "../data/types";
import { applyFilter, sortProblems } from "../domain/filters";
import { reviewGroups } from "../domain/review";
import { todayLocal } from "../data/ids";
import type { State } from "./store";

export function visibleProblems(s: Pick<State, "problems" | "filter" | "searchHits" | "sort" | "index" | "listMode">): ProblemSummary[] {
  const { problems, filter, searchHits: hits, sort, index, listMode: mode } = s;
  const today = todayLocal();
  if (mode === "trash") return problems.filter((p) => p.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  if (mode === "recent") {
    const live = applyFilter(problems, filter, { index, searchHits: hits, today });
    return [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 60);
  }
  if (mode === "review") {
    const live = applyFilter(problems, filter, { index, searchHits: hits, today });
    return reviewGroups(live, today).flatMap((g) => g.problems);
  }
  return sortProblems(applyFilter(problems, filter, { index, searchHits: hits, today }), sort, index, hits);
}
