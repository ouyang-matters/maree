// PDF text extraction with layout reconstruction (lines, paragraphs, headings,
// indentation) and detection of raised/lowered glyphs (super/subscripts).
//
// PDF text never carries LaTeX. The plain text is kept exactly as extracted; an
// "assisted" LaTeX version is produced separately and is always flagged for review.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ImportFlag } from "../data/types";
import { assistedLatex, garbledRatio, hasMathUnicode, hasTexControlDelimiters, normalizeExtracted } from "../math/unicode";
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

/** Position of a glyph relative to its line: small raised/lowered glyphs are scripts;
 * full-size glyphs above/below the baseline belong to fractions, radicals or big delimiters. */
type Script = "base" | "sup" | "sub" | "raised" | "lowered";

interface Line {
  y: number;
  size: number;
  minX: number;
  maxX: number;
  items: (Item & { script: Script })[];
  baselineFixed: boolean;
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

/**
 * Builds lines in content-stream order. TeX (and most generators) emit glyphs in reading
 * order, so a glyph that is merely raised or lowered (a radical sign, a numerator, a big
 * parenthesis, an exponent) stays in the line it belongs to. A new line starts only on a
 * genuine carriage return: moving down and back to the left, or a large vertical jump.
 */
function buildLines(items: Item[], body: number, textWidth: number): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let prev: Item | null = null;
  for (const it of items) {
    const blank = !it.str.trim();
    if (cur && prev) {
      const size = Math.max(prev.size, body * 0.82);
      const dy = it.y - prev.y;
      const backwards = it.x < prev.x + prev.w - 0.3 * textWidth || it.x <= cur.minX + 0.6 * size;
      const newLine = dy < -2 * size || dy > 2 * size || (Math.abs(dy) > 0.9 * size && backwards);
      if (!newLine || blank) {
        cur.items.push({ ...it, script: "base" });
        if (!blank) {
          cur.minX = Math.min(cur.minX, it.x);
          cur.maxX = Math.max(cur.maxX, it.x + it.w);
          prev = it;
        }
        continue;
      }
    }
    if (blank) continue;
    cur = { y: it.y, size: it.size, minX: it.x, maxX: it.x + it.w, items: [{ ...it, script: "base" }], baselineFixed: false };
    lines.push(cur);
    prev = it;
  }
  for (const l of lines) {
    // Baseline and size: the height carrying most of the full-size text.
    const weight = new Map<number, number>();
    let maxSize = 0;
    for (const it of l.items) if (it.str.trim()) maxSize = Math.max(maxSize, it.size);
    for (const it of l.items) {
      if (!it.str.trim() || it.size < maxSize * 0.82) continue;
      const k = Math.round(it.y * 2) / 2;
      weight.set(k, (weight.get(k) ?? 0) + it.str.trim().length);
    }
    let best = l.y;
    let bw = -1;
    for (const [k, w] of weight) if (w > bw) (bw = w), (best = k);
    l.y = best;
    l.size = maxSize || l.size;
    for (const it of l.items) {
      if (!it.str.trim()) continue;
      const dy = it.y - l.y;
      if (it.size < l.size * 0.82) it.script = dy > 0.12 * l.size ? "sup" : dy < -0.08 * l.size ? "sub" : "base";
      else it.script = dy > 0.3 * l.size ? "raised" : dy < -0.3 * l.size ? "lowered" : "base";
    }
  }
  return lines;
}

interface Group {
  script: Script;
  text: string;
  x0: number;
  x1: number;
}

function lineTexts(l: Line): { plain: string; marked: string; scripts: boolean } {
  // Plain text: glyphs in reading order, with spaces where the layout has gaps.
  let plain = "";
  let prev: Item | null = null;
  for (const it of l.items) {
    const str = normalizeExtracted(it.str);
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if ((gap > 0.15 * l.size || gap < -0.5 * l.size) && !/\s$/.test(plain) && !/^\s/.test(str)) plain += " ";
    }
    plain += str;
    if (str.trim()) prev = it;
  }

  // Assisted text: group consecutive glyphs by position and rebuild scripts and fractions.
  const groups: Group[] = [];
  for (const it of l.items) {
    const str = normalizeExtracted(it.str);
    const g = groups[groups.length - 1];
    const script = str.trim() ? it.script : (g?.script ?? "base");
    if (g && g.script === script && it.x >= g.x1 - 0.5 * l.size) {
      const gap = it.x - g.x1;
      g.text += (gap > 0.15 * l.size && !/\s$/.test(g.text) && !/^\s/.test(str) ? " " : "") + str;
      if (str.trim()) g.x1 = Math.max(g.x1, it.x + it.w);
    } else {
      groups.push({ script, text: str, x0: it.x, x1: it.x + it.w });
    }
  }
  let marked = "";
  let scripts = false;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const next = groups[i + 1];
    const text = g.text.trim();
    const prevG = groups[i - 1];
    const spaced = prevG && g.x0 - prevG.x1 > 0.15 * l.size ? " " : "";
    if (!text) {
      marked += " ";
      continue;
    }
    if ((g.script === "sup" || g.script === "sub") && !(g.script === "sup" && next?.script === "sub" && next.x0 < g.x1 && next.x1 > g.x0)) {
      scripts = true;
      marked += `${g.script === "sup" ? "^" : "_"}{${text}}`;
    } else if (
      ((g.script === "raised" && next?.script === "lowered") || (g.script === "sup" && next?.script === "sub")) &&
      next.x0 < g.x1 &&
      next.x1 > g.x0
    ) {
      // A numerator immediately followed by an overlapping denominator (display or inline fraction).
      scripts = true;
      marked += `${spaced}\\frac{${text}}{${next.text.trim()}}`;
      i++;
    } else {
      marked += spaced + text;
    }
  }
  return { plain: plain.replace(/\s+/g, " ").trim(), marked: marked.replace(/\s+/g, " ").trim(), scripts: scripts || l.items.some((x) => x.script === "raised" || x.script === "lowered") };
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
  const pageItems: { items: Item[]; height: number; width: number }[] = [];
  const sizeWeights = new Map<number, number>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of tc.items) {
      if (!("str" in raw)) continue;
      if (!raw.str) continue;
      // Keep stream order: it is reading order for TeX-generated documents.
      const t = raw.transform as number[];
      const size = Math.hypot(t[2], t[3]) || raw.height || 10;
      if (size < 2) continue;
      items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width, size });
      const key = Math.round(size * 2) / 2;
      sizeWeights.set(key, (sizeWeights.get(key) ?? 0) + raw.str.length);
    }
    pageItems.push({ items, height: vp.height, width: vp.width });
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
  pageItems.forEach(({ items, height, width }, idx) => {
    const lines = buildLines(items, body, width * 0.7);
    perPage.push({ page: idx + 1, lines, height });
    const edge = new Set<string>();
    for (const l of lines) {
      if (l.y > height * 0.92 || l.y < height * 0.08) edge.add(lineTexts(l).plain.replace(/\d+/g, "#"));
    }
    for (const e of edge) edgeCounts.set(e, (edgeCounts.get(e) ?? 0) + 1);
  });
  // A line at the top or bottom edge that recurs on at least half the pages (and on at
  // least two) is a running header or footer.
  const repeated = new Set([...edgeCounts].filter(([, n]) => n >= Math.max(2, perPage.length * 0.5)).map(([t]) => t));

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
      if (hasTexControlDelimiters(l.items.map((x) => x.str).join("")))
        flags.push({ code: "garbled", message: "Large brackets drawn from a TeX extension font were decoded heuristically." });
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
