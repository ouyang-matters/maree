// Handwritten answers: drawn on the pad, saved as a PNG attachment (which keeps its strokes
// for later editing) and shown in My Solution like a photographed answer.

import { get, set, toast } from "./store";
import * as A from "./actions";
import { repo } from "./actions";
import { flushAutosave } from "./autosave";
import { platform } from "../platform";
import { t } from "../i18n";
import { appendBlock, imageMarkdown } from "../domain/photos";
import { inkFileName, type Ink } from "../domain/ink";
import { exportInkPng, readInkFromPng } from "../image/ink";

export function openHandwriting(problemId: string, partId: string | null = null): void {
  set({ dialog: { kind: "ink", problemId, partId } });
}

/** Reopens a handwritten answer on the pad (from a double-click on it). */
export function editHandwriting(problemId: string, partId: string | null, fileName: string): void {
  const p = get().problemCache[problemId];
  const att = p?.attachments.find((a) => a.fileName === fileName);
  if (!att) return;
  set({ dialog: { kind: "ink", problemId, partId, edit: { attachmentId: att.id, fileName } } });
}

export async function loadInk(problemId: string, fileName: string): Promise<Ink | null> {
  const att = get().problemCache[problemId]?.attachments.find((a) => a.fileName === fileName);
  if (!att) return null;
  return readInkFromPng(await platform().readStored(att.storedPath));
}

function replaceReference(text: string, oldName: string, newName: string): string {
  return text.split(`attachment:${encodeURIComponent(oldName)}`).join(`attachment:${encodeURIComponent(newName)}`).split(`attachment:${oldName}`).join(`attachment:${encodeURIComponent(newName)}`);
}

/** Stores the drawing and puts it into My Solution (or replaces the version being edited). */
export async function saveHandwriting(problemId: string, partId: string | null, ink: Ink, edit?: { attachmentId: string; fileName: string }): Promise<void> {
  await flushAutosave();
  const p = await repo.getProblem(problemId);
  if (!p) return;
  const bytes = await exportInkPng(ink);
  const name = inkFileName(new Date(), new Set(p.attachments.map((a) => a.fileName)));
  const stored = await platform().storeFile("attachments", name, bytes, null);
  const current = partId ? (p.parts.find((x) => x.id === partId)?.solution ?? "") : p.solution;
  const replaced = edit ? replaceReference(current, edit.fileName, name) : current;
  // A new drawing, or one whose old image is no longer in the text, is added at the end.
  const solution = replaced !== current ? replaced : appendBlock(current, imageMarkdown(name, t("My answer")));
  await repo.saveInk({
    att: { problemId, fileName: name, storedPath: stored.storedPath, mime: "image/png", size: stored.size, hash: stored.hash, caption: "" },
    partId,
    solution,
    replaces: edit?.attachmentId ?? null,
  });
  await A.refreshProblems([problemId], { full: true });
  toast(edit ? t("Handwriting updated") : t("Handwriting added to My Solution"), "success");
}
