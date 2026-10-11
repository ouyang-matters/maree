// Near-duplicate detection for imported problems.

import { plainText } from "../math/segments";

export function fingerprint(statement: string): string {
  return plainText(statement)
    .toLowerCase()
    .replace(/\\(?:left|right|displaystyle|,|;|!|quad|qquad)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function shingles(statement: string, k = 3): Set<string> {
  const words = plainText(statement)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out = new Set<string>();
  if (words.length < k) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ExistingStatement {
  id: string;
  label: string;
  statement: string;
}

export class DuplicateIndex {
  private items: { id: string; label: string; fp: string; sh: Set<string> }[];
  private byFp = new Map<string, string>();

  constructor(existing: ExistingStatement[]) {
    this.items = existing
      .filter((e) => e.statement.trim())
      .map((e) => ({ id: e.id, label: e.label, fp: fingerprint(e.statement), sh: shingles(e.statement) }));
    for (const it of this.items) if (it.fp.length >= 12) this.byFp.set(it.fp, it.id);
  }

  find(statement: string, threshold = 0.8): { id: string; label: string; similarity: number } | null {
    const fp = fingerprint(statement);
    if (fp.length < 12) return null;
    const exact = this.byFp.get(fp);
    if (exact) return { id: exact, label: this.items.find((i) => i.id === exact)!.label, similarity: 1 };
    const sh = shingles(statement);
    if (sh.size < 4) return null;
    let best: { id: string; label: string; similarity: number } | null = null;
    for (const it of this.items) {
      const s = jaccard(sh, it.sh);
      if (s >= threshold && (!best || s > best.similarity)) best = { id: it.id, label: it.label, similarity: s };
    }
    return best;
  }
}
