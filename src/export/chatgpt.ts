// "Copy for ChatGPT": the problem and my answer as images on the clipboard, ready to be
// pasted into a chat with one Ctrl+V. Photos are sent unchanged; typed text (with its
// mathematics typeset) is rendered to a picture so that everything arrives together.

import { toCanvas } from "html-to-image";
import type { Attachment, Problem } from "../data/types";
import { attachmentImages, withoutAttachmentImages } from "../domain/photos";
import { renderMarkdown } from "../math/render";
import { canvasBmp, decodeImage, fit, stack, toBytes } from "../image/photo";
import type { ClipboardImage } from "../platform/types";

export interface ChatGptSection {
  /** Typed text left after removing attachment images (may be empty). */
  text: string;
  images: Attachment[];
}

/** Splits a problem into what is asked and what I answered. */
export function chatGptSections(p: Problem): { question: ChatGptSection; answer: ChatGptSection } {
  const byName = new Map(p.attachments.map((a) => [a.fileName, a]));
  const section = (pieces: { label: string; md: string }[]): ChatGptSection => {
    const images: Attachment[] = [];
    const texts: string[] = [];
    for (const { label, md } of pieces) {
      for (const name of attachmentImages(md)) {
        const a = byName.get(name);
        if (a && a.mime.startsWith("image/") && !images.includes(a)) images.push(a);
      }
      const rest = withoutAttachmentImages(md);
      if (rest) texts.push(label ? `**(${label})** ${rest}` : rest);
    }
    return { text: texts.join("\n\n"), images };
  };
  const parts = [...p.parts].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    question: section([{ label: "", md: p.statement }, ...parts.map((pt) => ({ label: pt.label, md: pt.statement }))]),
    answer: section([{ label: "", md: p.solution }, ...parts.map((pt) => ({ label: pt.label, md: pt.solution }))]),
  };
}

/** Typesets Markdown + LaTeX into a white picture. */
export async function renderTextImage(md: string, width = 820): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  host.dataset.theme = "maree";
  host.className = "snapshot-host";
  host.style.width = `${width}px`;
  host.innerHTML = `<div class="prose">${renderMarkdown(md)}</div>`;
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    // The host sits off-screen; the copy that is drawn must not.
    return await toCanvas(host, { pixelRatio: 2, backgroundColor: "#ffffff", style: { position: "static", left: "0", top: "0" } });
  } finally {
    host.remove();
  }
}

export interface ChatGptPayload {
  files: ClipboardImage[];
  combined: { png: Uint8Array; bmp: Uint8Array | null } | null;
  questionCount: number;
  answerCount: number;
}

/** "Limit with a 1/n bound" → "Limit with a 1n bound", short enough for a file name. */
export function fileTitle(title: string, max = 40): string {
  const clean = title.replace(/[\\/:*?"<>|${}^_]/g, "").replace(/[,·]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * File names for the pictures, in paste order. One problem: "1 problem.jpg", "2 my answer.jpg".
 * Several: "01 Q1 Uniqueness - problem.jpg", "02 Q1 Uniqueness - my answer.jpg", "03 Q2 …".
 */
export function chatGptFileName(seq: number, total: number, q: { index: number; title: string } | null, label: string, nth: number, ext: string): string {
  const more = nth > 1 ? ` ${nth}` : "";
  if (!q) return `${seq} ${label}${more}.${ext}`;
  const width = String(total).length < 2 ? 2 : String(total).length;
  const title = fileTitle(q.title);
  return `${String(seq).padStart(width, "0")} Q${q.index}${title ? ` ${title}` : ""} - ${label}${more}.${ext}`;
}

/** Builds the clipboard payload for one or more problems; `read` loads a stored attachment. */
export async function buildChatGptPayload(
  problems: Problem | Problem[],
  read: (a: Attachment) => Promise<Uint8Array>,
  labels: { problem: string; answer: string },
): Promise<ChatGptPayload> {
  const list = Array.isArray(problems) ? problems : [problems];
  const plan: { q: { index: number; title: string } | null; label: string; nth: number; text?: string; image?: Attachment }[] = [];
  let questionCount = 0;
  let answerCount = 0;
  list.forEach((p, i) => {
    const { question, answer } = chatGptSections(p);
    const q = list.length > 1 ? { index: i + 1, title: p.title } : null;
    for (const [sec, label, isAnswer] of [[question, labels.problem, false], [answer, labels.answer, true]] as const) {
      let nth = 0;
      if (sec.text) plan.push({ q, label, nth: ++nth, text: sec.text });
      for (const a of sec.images) plan.push({ q, label, nth: ++nth, image: a });
      if (isAnswer) answerCount += nth;
      else questionCount += nth;
    }
  });
  const files: ClipboardImage[] = [];
  const pictures: (HTMLCanvasElement | ImageBitmap)[] = [];
  let seq = 0;
  for (const item of plan) {
    seq++;
    if (item.text) {
      const c = await renderTextImage(item.text);
      files.push({ name: chatGptFileName(seq, plan.length, item.q, item.label, item.nth, "png"), bytes: await toBytes(c, "image/png") });
      pictures.push(c);
    } else if (item.image) {
      const bytes = await read(item.image);
      const ext = item.image.fileName.split(".").pop()?.toLowerCase() || "png";
      files.push({ name: chatGptFileName(seq, plan.length, item.q, item.label, item.nth, ext), bytes });
      try {
        pictures.push(await decodeImage(bytes, item.image.mime));
      } catch {
        /* still sent as a file */
      }
    }
  }
  let combined: ChatGptPayload["combined"] = null;
  if (pictures.length) {
    const sheet = fit(stack(pictures, 1400), 4000);
    combined = { png: await toBytes(sheet, "image/png"), bmp: sheet.width * sheet.height <= 16_000_000 ? canvasBmp(sheet) : null };
  }
  return { files, combined, questionCount, answerCount };
}
