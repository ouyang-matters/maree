// The photo inbox and the phone link: photos arrive from the phone (or a watched folder),
// are cropped into problems and answers, and problems are copied out for ChatGPT.

import { get, set, toast, useStore } from "./store";
import * as A from "./actions";
import { repo } from "./actions";
import { flushAutosave } from "./autosave";
import { platform } from "../platform";
import type { InboxItem } from "../platform/types";
import { t, fmtDate } from "../i18n";
import { appendBlock, imageMarkdown, photoFileName, readingOrder, type Region } from "../domain/photos";
import { crop, decodeImage, rotated, toBytes, type Quarter } from "../image/photo";
import { buildChatGptPayload } from "../export/chatgpt";
import { addToTray, openTray } from "./tray";

let started = false;
let folderTimer: number | null = null;
let contextTimer: number | null = null;

export async function refreshInbox(): Promise<void> {
  try {
    set({ inbox: await platform().inbox.list() });
  } catch (e) {
    console.error(e);
  }
}

/** Called once after start-up. */
export function initInbox(): void {
  if (started) return;
  started = true;
  void refreshInbox();
  platform().inbox.onChanged(() => void refreshInbox());
  if (get().settings.phoneLink) void startPhoneLink();
  scheduleFolder();
  window.addEventListener("focus", () => void collectFolder(false));
  // Keep the phone's list of problems (for "answer for …") current.
  let last = get().problems;
  useStore.subscribe((s) => {
    if (s.problems !== last) {
      last = s.problems;
      queueContext();
    }
  });
}

function queueContext(): void {
  if (!get().phone.status) return;
  if (contextTimer) window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => void pushContext(), 1200);
}

/** What the phone shows: recent problems first, then each course in order. */
export function phoneContext(): string {
  const s = get();
  const live = s.problems.filter((p) => !p.deletedAt);
  const label = (p: (typeof live)[number]) => `${p.sourceNumber ? `${p.sourceNumber} · ` : ""}${p.title || t("Untitled problem")}`;
  const recent = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const rows: { id: string; label: string; group: string }[] = recent.map((p) => ({ id: p.id, label: label(p), group: t("Recent") }));
  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  for (const c of s.courses.filter((c) => !c.archived)) {
    const list = live.filter((p) => p.courseId === c.id).sort((a, b) => num(a.sourceNumber) - num(b.sourceNumber) || a.title.localeCompare(b.title));
    for (const p of list.slice(0, 400)) rows.push({ id: p.id, label: label(p), group: c.code || c.title });
  }
  return JSON.stringify({ locale: s.settings.locale, problems: rows });
}

async function pushContext(): Promise<void> {
  try {
    await platform().inbox.setContext(phoneContext());
  } catch {
    /* the link may have stopped */
  }
}

function newKey(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function startPhoneLink(): Promise<void> {
  const s = get().settings;
  let key = s.phoneKey;
  if (!key) {
    key = newKey();
    await A.updateSettings({ phoneKey: key });
  }
  try {
    const status = await platform().inbox.start(key, s.phonePort);
    set({ phone: { status, error: null } });
    if (!s.phoneLink) await A.updateSettings({ phoneLink: true });
    await pushContext();
  } catch (e) {
    set({ phone: { status: null, error: e instanceof Error ? e.message : String(e) } });
  }
}

export async function stopPhoneLink(): Promise<void> {
  await platform().inbox.stop();
  set({ phone: { status: null, error: null } });
  await A.updateSettings({ phoneLink: false });
}

/** A new key: phones paired before can no longer send photos. */
export async function resetPhoneKey(): Promise<void> {
  await A.updateSettings({ phoneKey: newKey() });
  if (get().settings.phoneLink) await startPhoneLink();
  toast(t("Previously paired phones have been disconnected."), "info");
}

function scheduleFolder(): void {
  if (folderTimer) window.clearInterval(folderTimer);
  folderTimer = null;
  if (!get().settings.inboxFolder) return;
  void collectFolder(false);
  folderTimer = window.setInterval(() => void collectFolder(false), 60_000);
}

export async function setInboxFolder(folder: string): Promise<void> {
  await A.updateSettings({ inboxFolder: folder });
  scheduleFolder();
  if (folder) await collectFolder(true);
}

export async function chooseInboxFolder(): Promise<void> {
  const folder = await platform().pickFolder?.(t("Folder your phone uploads photos to"));
  if (folder) await setInboxFolder(folder);
}

export async function collectFolder(report: boolean): Promise<void> {
  const folder = get().settings.inboxFolder;
  if (!folder) return;
  try {
    const r = await platform().inbox.collectFolder(folder);
    if (r.added) await refreshInbox();
    if (report || r.added) {
      if (r.added) toast(t("{n} photo(s) collected from the folder", { n: r.added }), "success");
      else if (report) toast(t("No new photos in the folder"), "info");
    }
    if (r.skippedHeic && report) toast(t("{n} HEIC photo(s) skipped. Set the phone camera to JPEG (Most Compatible), or send photos through Marée's phone page.", { n: r.skippedHeic }), "info");
  } catch (e) {
    if (report) toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function openInbox(): void {
  A.openTab({ id: "inbox", kind: "inbox" });
}

/** Adds photos from this computer (file picker or drag and drop). */
export async function addPhotos(files?: { name: string; read(): Promise<Uint8Array> }[]): Promise<void> {
  const picked =
    files ??
    (await platform().pickFiles({ multiple: true, filters: [{ name: t("Images"), extensions: ["jpg", "jpeg", "png", "webp"] }], title: t("Add Photos to Inbox") }));
  let added = 0;
  for (const f of picked) {
    try {
      await platform().inbox.add(f.name, await f.read(), "unknown");
      added++;
    } catch (e) {
      toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }
  if (added) await refreshInbox();
}

export async function discardPhoto(item: InboxItem): Promise<void> {
  await platform().inbox.archive(item.id);
  await refreshInbox();
  toast(t("Photo removed from the inbox"), "info", {
    label: t("Undo"),
    run: () => void platform().inbox.restore(item.id).then(refreshInbox),
  });
}

export interface PhotoDefaults {
  courseId: string | null;
  lectureId: string | null;
}

/** Number of problems a region list will create, and answers still missing a problem. */
export function regionProblems(regions: Region[]): { questions: number; unassigned: number } {
  return {
    questions: regions.filter((r) => r.kind === "question").length,
    unassigned: regions.filter((r) => r.kind === "answer" && !r.target).length,
  };
}

/**
 * Turns a photo into problems (cropped statements) and answers (cropped solutions appended
 * to "My Solution"). With no regions, the whole photo is used as one piece of `item.kind`.
 */
export async function commitPhoto(item: InboxItem, quarter: Quarter, regions: Region[], defaults: PhotoDefaults): Promise<string[]> {
  await flushAutosave();
  const bytes = await platform().inbox.read(item.id);
  const mime = item.fileName.endsWith(".png") ? "image/png" : item.fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const bitmap = await decodeImage(bytes, mime);
  const image = rotated(bitmap, quarter);
  bitmap.close();
  const pieces: Region[] = regions.length
    ? readingOrder(regions)
    : [{ id: "whole", x: 0, y: 0, w: 1, h: 1, kind: item.kind === "answer" ? "answer" : "question", target: item.problemId, title: "" }];
  const when = new Date(item.receivedAt || Date.now());
  const created = new Map<string, string>();
  const touched = new Set<string>();
  const s = get();
  const lecture = defaults.lectureId ? s.index.lectures.get(defaults.lectureId) : undefined;
  const courseId = lecture?.courseId ?? defaults.courseId;
  let n = 0;
  const store = async (region: Region) => {
    const name = photoFileName(when, ++n);
    const jpeg = await toBytes(crop(image, region), "image/jpeg", 0.9);
    const stored = await platform().storeFile("attachments", name, jpeg, null);
    return { fileName: name, storedPath: stored.storedPath, mime: "image/jpeg", size: stored.size, hash: stored.hash, caption: "" };
  };
  let q = 0;
  for (const r of pieces.filter((x) => x.kind === "question")) {
    const att = await store(r);
    q++;
    const id = await repo.createProblemWithAttachments(
      {
        title: r.title.trim() || t("Photo {date} · {n}", { date: fmtDate(when), n: q }),
        statement: imageMarkdown(att.fileName, t("Problem")),
        courseId,
        lectureIds: lecture ? [lecture.id] : [],
      },
      [att],
    );
    created.set(r.id, id);
  }
  for (const r of pieces.filter((x) => x.kind === "answer")) {
    const target = r.target?.startsWith("region:") ? created.get(r.target.slice(7)) : r.target;
    if (!target) continue;
    const att = await store(r);
    const current = await repo.getProblem(target);
    if (!current) continue;
    await repo.addAttachmentWithPatch({ ...att, problemId: target }, { solution: appendBlock(current.solution, imageMarkdown(att.fileName, t("My answer"))) });
    touched.add(target);
  }
  await platform().inbox.archive(item.id);
  const ids = [...created.values()];
  await A.refreshProblems([...ids, ...touched], { full: true });
  await refreshInbox();
  // Everything from this photo is gathered for ChatGPT, each problem with its answer.
  await addToTray([...ids, ...[...touched].filter((id) => !ids.includes(id))], { quiet: true });
  const msg =
    ids.length && touched.size
      ? t("{q} problem(s) created, {a} answer(s) attached", { q: ids.length, a: touched.size })
      : ids.length
        ? t("{q} problem(s) created", { q: ids.length })
        : t("{a} answer(s) attached", { a: touched.size });
  toast(`${msg} · ${t("added to To ChatGPT")}`, "success", { label: t("Open To ChatGPT"), run: openTray });
  return ids;
}

/** ChatGPT accepts about this many files in one message. */
export const CHATGPT_FILE_LIMIT = 10;

/** Puts the problems and my answers on the clipboard as images for a chat with ChatGPT. */
export async function copyForChatGpt(problemIds: string | string[]): Promise<void> {
  const ids = Array.isArray(problemIds) ? problemIds : [problemIds];
  if (!ids.length) return;
  await flushAutosave();
  const problems = [];
  for (const id of ids) {
    const p = await A.loadProblem(id, true);
    if (p && !p.deletedAt) problems.push(p);
  }
  if (!problems.length) return;
  try {
    const payload = await buildChatGptPayload(problems, (a) => platform().readStored(a.storedPath), { problem: t("problem"), answer: t("my answer") });
    if (!payload.files.length) {
      toast(t("This problem has no statement or answer to copy yet."), "info");
      return;
    }
    await platform().copyImages(payload.files, payload.combined);
    const n = payload.files.length;
    let msg =
      problems.length > 1
        ? t("{p} problems copied ({n} images). Paste into ChatGPT with Ctrl+V.", { p: problems.length, n })
        : payload.answerCount
          ? t("Problem and answer copied ({n} images). Paste into ChatGPT with Ctrl+V.", { n })
          : t("Problem copied ({n} images). Paste into ChatGPT with Ctrl+V.", { n });
    if (n > CHATGPT_FILE_LIMIT) msg += " " + t("ChatGPT takes about {max} files per message; copy fewer problems if it refuses some.", { max: CHATGPT_FILE_LIMIT });
    toast(msg, n > CHATGPT_FILE_LIMIT ? "info" : "success");
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}
