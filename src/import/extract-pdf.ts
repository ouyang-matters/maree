// PDF text extraction with layout reconstruction (lines, paragraphs, headings,
// indentation) and detection of raised/lowered glyphs (super/subscripts).
//
// PDF text never carries LaTeX. The plain text is kept exactly as extracted; an
// "assisted" LaTeX version is produced separately and is always flagged for review.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ImportFlag } from "../data/types";
import { assistedLatex, garbledRatio, hasMathUnicode, normalizeExtracted } from "../math/unicode";
import type { ExtractedDocument, ExtractedLine } from "./types";

export interface PdfjsLike {
  getDocument(src: { data: Uint8Array; [k: string]: unknown }): { promise: Promise<PDFDocumentProxy> };
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

type Script = "base" | "sup" | "sub";

interface Line {
  y: number;
  size: number;
  minX: number;
  maxX: number;
  items: (Item & { script: Script })[];
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function buildLines(items: Item[], body: number): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  const small: Item[] = [];
  for (const it of sorted) {
    if (it.size < body * 0.82) {
      small.push(it);
      continue;
    }
    let target: Line | undefined;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
      const l = lines[i];
      if (Math.abs(l.y - it.y) <= 0.4 * Math.max(l.size, it.size)) {
        target = l;
        break;
      }
    }
    if (!target) {
      target = { y: it.y, size: it.size, minX: it.x, maxX: it.x + it.w, items: [] };
      lines.push(target);
    }
    target.items.push({ ...it, script: "base" });
    target.size = Math.max(target.size, it.size);
    target.minX = Math.min(target.minX, it.x);
    target.maxX = Math.max(target.maxX, it.x + it.w);
  }
  for (const it of small) {
    let best: Line | undefined;
    let bestDy = Infinity;
    for (const l of lines) {
      const dy = it.y - l.y;
      if (dy < -0.55 * l.size || dy > 0.75 * l.size) continue;
      if (it.x < l.minX - l.size || it.x > l.maxX + 2 * l.size) continue;
      if (Math.abs(dy) < bestDy) {
        bestDy = Math.abs(dy);
        best = l;
      }
    }
    if (best) {
      const dy = it.y - best.y;
      const script: Script = dy > 0.12 * best.size ? "sup" : dy < -0.08 * best.size ? "sub" : "base";
      best.items.push({ ...it, script });
      best.minX = Math.min(best.minX, it.x);
      best.maxX = Math.max(best.maxX, it.x + it.w);
    } else {
      lines.push({ y: it.y, size: it.size, minX: it.x, maxX: it.x + it.w, items: [{ ...it, script: "base" }] });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function lineTexts(l: Line): { plain: string; marked: string; scripts: boolean } {
  let plain = "";
  let marked = "";
  let scripts = false;
  let prev: (Item & { script: Script }) | null = null;
  let open: Script = "base";
  const close = () => {
    if (open !== "base") marked += "}";
    open = "base";
  };
  for (const it of l.items) {
    const str = normalizeExtracted(it.str);
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const needSpace = gap > 0.15 * l.size && !/\s$/.test(prev.str) && !/^\s/.test(str);
      if (needSpace) {
        plain += " ";
        if (it.script === open) marked += " ";
      }
    }
    if (it.script !== open) {
      close();
      if (it.script !== "base") {
        scripts = true;
        marked += it.script === "sup" ? "^{" : "_{";
        open = it.script;
      } else if (prev && it.x - (prev.x + prev.w) > 0.15 * l.size) marked += " ";
    }
    plain += str;
    marked += it.script === "base" ? str : str.trim();
    prev = { ...it, str };
  }
  close();
  return { plain: plain.replace(/\s+/g, " ").trim(), marked: marked.replace(/\s+/g, " ").trim(), scripts };
}

const PAGE_NUMBER = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

export interface PdfProgress {
  (page: number, total: number): void;
}

export async function extractPdf(
  fileName: string,
  bytes: Uint8Array,
  pdfjs: PdfjsLike,
  onProgress?: PdfProgress,
): Promise<ExtractedDocument> {
  // pdf.js may transfer (detach) the buffer it is given; work on a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false })
    .promise;
  const numPages = doc.numPages;
  const pageItems: { items: Item[]; height: number }[] = [];
  const sizeWeights = new Map<number, number>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of tc.items) {
      if (!("str" in raw)) continue;
      if (!raw.str) continue;
      const t = raw.transform as number[];
      const size = Math.hypot(t[2], t[3]) || raw.height || 10;
      if (size < 2) continue;
      items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width, size });
      const key = Math.round(size * 2) / 2;
      sizeWeights.set(key, (sizeWeights.get(key) ?? 0) + raw.str.length);
    }
    pageItems.push({ items, height: vp.height });
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  let body = 10;
  let bestW = -1;
  for (const [s, w] of sizeWeights) if (w > bestW) (bestW = w), (body = s);

  let title = "";
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string } | undefined;
    if (info?.Title && info.Title.trim().length > 3 && !/^untitled|\.(tex|dvi|pdf)$/i.test(info.Title.trim())) title = info.Title.trim();
  } catch {
    /* metadata is optional */
  }

  const out: ExtractedLine[] = [];
  const emptyPages: number[] = [];
  // Header/footer lines repeated on many pages (e.g. "MATH 147 — Fall 2026").
  const edgeCounts = new Map<string, number>();
  const perPage: { page: number; lines: Line[]; height: number }[] = [];
  pageItems.forEach(({ items, height }, idx) => {
    const lines = buildLines(items, body);
    perPage.push({ page: idx + 1, lines, height });
    const edge = new Set<string>();
    for (const l of lines) {
      if (l.y > height * 0.92 || l.y < height * 0.08) edge.add(lineTexts(l).plain.replace(/\d+/g, "#"));
    }
    for (const e of edge) edgeCounts.set(e, (edgeCounts.get(e) ?? 0) + 1);
  });
  const repeated = new Set([...edgeCounts].filter(([, n]) => n >= Math.max(3, perPage.length * 0.5)).map(([t]) => t));

  for (const { page, lines, height } of perPage) {
    const kept = lines.filter((l) => {
      const t = lineTexts(l).plain;
      const atEdge = l.y > height * 0.92 || l.y < height * 0.08;
      if (atEdge && (PAGE_NUMBER.test(t) || repeated.has(t.replace(/\d+/g, "#")))) return false;
      return t.length > 0;
    });
    const totalChars = kept.reduce((n, l) => n + lineTexts(l).plain.length, 0);
    if (totalChars < 5) {
      emptyPages.push(page);
      continue;
    }
    const margin = percentile(
      kept.map((l) => l.minX),
      0.1,
    );
    const gaps: number[] = [];
    for (let i = 1; i < kept.length; i++) {
      const g = kept[i - 1].y - kept[i].y;
      if (g > 0 && Math.abs(kept[i].size - body) < 1 && Math.abs(kept[i - 1].size - body) < 1) gaps.push(g);
    }
    const lineGap = median(gaps) || body * 1.2;
    let first = true;
    for (let i = 0; i < kept.length; i++) {
      const l = kept[i];
      const { plain, marked, scripts } = lineTexts(l);
      if (i > 0) {
        const gap = kept[i - 1].y - l.y;
        if (gap > lineGap * 1.45) out.push({ text: "", page });
      } else if (!first) out.push({ text: "", page });
      first = false;
      const flags: ImportFlag[] = [];
      if (hasMathUnicode(plain)) flags.push({ code: "math-unicode", message: "Contains mathematical symbols extracted as Unicode text." });
      if (scripts) flags.push({ code: "lost-scripts", message: "Raised or lowered characters (exponents, indices) were detected; they appear inline in the extracted text." });
      if (garbledRatio(plain) > 0.02) flags.push({ code: "garbled", message: "Some characters could not be decoded from the PDF font." });
      const heading = l.size >= body * 1.6 ? 1 : l.size >= body * 1.35 ? 2 : l.size >= body * 1.18 ? 3 : undefined;
      const indent = Math.max(0, Math.round((l.minX - margin) / (body * 1.2)));
      const prev = out[out.length - 1];
      // Re-join words hyphenated across lines.
      if (prev && prev.page === page && prev.text && /[a-z]-$/.test(prev.text) && /^[a-z]/.test(plain) && !heading && !prev.heading) {
        prev.text = prev.text.slice(0, -1) + plain;
        prev.assisted = (prev.assisted ?? "").replace(/-$/, "") + assistedLatex(marked);
        if (flags.length) prev.flags = [...(prev.flags ?? []), ...flags];
        continue;
      }
      if (heading && !title && page === 1) title = plain;
      out.push({
        text: plain,
        assisted: assistedLatex(marked),
        page,
        indent,
        heading,
        flags: flags.length ? flags : undefined,
      });
    }
  }

  const warnings: string[] = [];
  if (emptyPages.length === numPages) {
    warnings.push(
      "This PDF has no text layer (it is probably scanned). Marée does not perform OCR: problems can be created page by page and transcribed while viewing the original.",
    );
  } else if (emptyPages.length) {
    warnings.push(`Pages without extractable text: ${emptyPages.join(", ")}.`);
  }
  warnings.push("Text extracted from a PDF loses mathematical structure. Each problem shows its source page so the LaTeX can be checked and corrected.");
  await doc.destroy();
  return {
    fileName,
    format: "pdf",
    title: title || fileName.replace(/\.[^.]+$/, ""),
    lines: out,
    pageCount: numPages,
    reliability: "uncertain",
    warnings,
    emptyPages,
  };
}
