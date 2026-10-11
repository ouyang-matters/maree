// Markdown and plain-text extraction. Mathematics in these formats is already
// LaTeX source, so the text is kept verbatim (reliability "exact").

import type { ExtractedDocument, ExtractedLine } from "./types";

function indentLevel(line: string): number {
  const m = /^[ \t]*/.exec(line)![0];
  const width = [...m].reduce((w, c) => w + (c === "\t" ? 4 : 1), 0);
  return Math.floor(width / 2);
}

export function stripFrontMatter(src: string): { body: string; meta: Record<string, string> } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (!m) return { body: src, meta: {} };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { body: src.slice(m[0].length), meta };
}

export function extractMarkdown(fileName: string, src: string): ExtractedDocument {
  const { body, meta } = stripFrontMatter(src.replace(/\r\n?/g, "\n"));
  const lines: ExtractedLine[] = [];
  let inFence = false;
  let title = meta.title ?? "";
  for (const raw of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    const h = !inFence ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw) : null;
    if (h) {
      if (!title && h[1].length === 1) title = h[2];
      lines.push({ text: h[2], heading: h[1].length });
      continue;
    }
    // Setext headings: "Title\n=====".
    if (!inFence && /^\s*(=+|-+)\s*$/.test(raw) && lines.length && lines[lines.length - 1].text.trim() && raw.trim().length >= 3) {
      const prev = lines[lines.length - 1];
      if (!prev.heading && !/^\s*[-*+]\s/.test(prev.text)) {
        prev.heading = raw.trim()[0] === "=" ? 1 : 2;
        if (!title && prev.heading === 1) title = prev.text.trim();
        continue;
      }
    }
    lines.push({ text: inFence ? raw : raw.replace(/\s+$/, ""), indent: inFence ? 99 : indentLevel(raw) });
  }
  return {
    fileName,
    format: "markdown",
    title: title || fileName.replace(/\.[^.]+$/, ""),
    lines,
    reliability: "exact",
    warnings: [],
    meta: { course: meta.course, sourceTitle: meta.source ?? meta.title, author: meta.author },
  };
}

export function extractPlainText(fileName: string, src: string): ExtractedDocument {
  const doc = extractMarkdown(fileName, src);
  return { ...doc, format: "text" };
}
