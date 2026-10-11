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

/** Builds the clipboard payload; `read` loads a stored attachment. */
export async function buildChatGptPayload(p: Problem, read: (a: Attachment) => Promise<Uint8Array>, labels: { problem: string; answer: string }): Promise<ChatGptPayload> {
  const { question, answer } = chatGptSections(p);
  const files: ClipboardImage[] = [];
  const pictures: (HTMLCanvasElement | ImageBitmap)[] = [];
  let n = 0;
  const add = async (sec: ChatGptSection, label: string): Promise<number> => {
    let count = 0;
    const name = (ext: string) => `${++n} ${label}${count ? ` ${count + 1}` : ""}.${ext}`;
    if (sec.text) {
      const c = await renderTextImage(sec.text);
      files.push({ name: name("png"), bytes: await toBytes(c, "image/png") });
      pictures.push(c);
      count++;
    }
    for (const a of sec.images) {
      const bytes = await read(a);
      const ext = a.fileName.split(".").pop()?.toLowerCase() || "png";
      files.push({ name: name(ext), bytes });
      try {
        pictures.push(await decodeImage(bytes, a.mime));
      } catch {
        /* still sent as a file */
      }
      count++;
    }
    return count;
  };
  const questionCount = await add(question, labels.problem);
  const answerCount = await add(answer, labels.answer);
  let combined: ChatGptPayload["combined"] = null;
  if (pictures.length) {
    const sheet = fit(stack(pictures, 1400), 4000);
    combined = { png: await toBytes(sheet, "image/png"), bmp: sheet.width * sheet.height <= 16_000_000 ? canvasBmp(sheet) : null };
  }
  return { files, combined, questionCount, answerCount };
}
