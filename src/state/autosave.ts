// Debounced autosave for text edits. Edits are applied to the in-memory cache
// immediately and written to SQLite shortly after typing pauses (or at the latest
// every MAX_WAIT ms during continuous typing). `flushAutosave` forces a write and is
// called before closing tabs, exporting, and when the window closes.

import type { PartPatch, ProblemPatch } from "../data/types";
import { get, set } from "./store";

const DEBOUNCE = 650;
const MAX_WAIT = 4000;

interface Pending {
  problem: ProblemPatch;
  parts: Map<string, PartPatch>;
}

const pending = new Map<string, Pending>();
let timer: ReturnType<typeof setTimeout> | null = null;
let firstQueuedAt = 0;
let flushing: Promise<void> | null = null;

type Writer = (problemId: string, patch: ProblemPatch, parts: Map<string, PartPatch>) => Promise<void>;
let writer: Writer | null = null;
let afterWrite: ((ids: string[]) => Promise<void>) | null = null;

export function configureAutosave(w: Writer, after: (ids: string[]) => Promise<void>): void {
  writer = w;
  afterWrite = after;
}

export function hasPendingEdits(): boolean {
  return pending.size > 0;
}

function schedule() {
  const now = Date.now();
  if (!firstQueuedAt) firstQueuedAt = now;
  if (timer) clearTimeout(timer);
  const wait = Math.max(0, Math.min(DEBOUNCE, MAX_WAIT - (now - firstQueuedAt)));
  timer = setTimeout(() => void flushAutosave(), wait);
  if (get().saveState !== "saving") set({ saveState: "pending" });
}

export function queueProblemPatch(problemId: string, patch: ProblemPatch): void {
  const p = pending.get(problemId) ?? { problem: {}, parts: new Map() };
  Object.assign(p.problem, patch);
  pending.set(problemId, p);
  schedule();
}

export function queuePartPatch(problemId: string, partId: string, patch: PartPatch): void {
  const p = pending.get(problemId) ?? { problem: {}, parts: new Map() };
  p.parts.set(partId, { ...(p.parts.get(partId) ?? {}), ...patch });
  pending.set(problemId, p);
  schedule();
}

export async function flushAutosave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing) {
    await flushing;
    if (pending.size) return flushAutosave();
    return;
  }
  if (!pending.size || !writer) return;
  const batch = new Map(pending);
  pending.clear();
  firstQueuedAt = 0;
  set({ saveState: "saving" });
  flushing = (async () => {
    const done: string[] = [];
    try {
      for (const [id, p] of batch) {
        await writer!(id, p.problem, p.parts);
        done.push(id);
      }
      set({ saveState: pending.size ? "pending" : "saved", lastSavedAt: new Date().toISOString() });
    } catch (e) {
      // Put unsaved edits back (newer edits win) and retry shortly.
      for (const [id, p] of batch) {
        if (done.includes(id)) continue;
        const cur = pending.get(id);
        if (!cur) pending.set(id, p);
        else {
          cur.problem = { ...p.problem, ...cur.problem };
          for (const [k, v] of p.parts) cur.parts.set(k, { ...v, ...(cur.parts.get(k) ?? {}) });
        }
      }
      set({ saveState: "error" });
      console.error("autosave failed", e);
      timer = setTimeout(() => void flushAutosave(), 3000);
    } finally {
      flushing = null;
      if (done.length && afterWrite) await afterWrite(done).catch(() => undefined);
    }
  })();
  await flushing;
}
