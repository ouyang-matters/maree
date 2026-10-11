// DOCX extraction: paragraphs, headings, list numbering and Word equations (OMML → LaTeX).

import JSZip from "jszip";
import type { ExtractedDocument, ExtractedLine } from "./types";
import { ommlToLatex } from "./omml";
import type { ImportFlag } from "../data/types";

interface Level {
  fmt: string;
  text: string;
  start: number;
}

function attr(el: Element | undefined | null, name: string): string | null {
  if (!el) return null;
  return el.getAttribute(`w:${name}`) ?? el.getAttribute(name);
}

function childEl(el: Element, name: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === name);
}

function parseNumbering(xml: string | null): Map<string, Level[]> {
  const out = new Map<string, Level[]>();
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const abstract = new Map<string, Level[]>();
  for (const a of Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "abstractNum")) {
    const levels: Level[] = [];
    for (const lvl of Array.from(a.children).filter((c) => c.localName === "lvl")) {
      const i = parseInt(attr(lvl, "ilvl") ?? "0", 10);
      levels[i] = {
        fmt: attr(childEl(lvl, "numFmt"), "val") ?? "decimal",
        text: attr(childEl(lvl, "lvlText"), "val") ?? `%${i + 1}.`,
        start: parseInt(attr(childEl(lvl, "start"), "val") ?? "1", 10),
      };
    }
    abstract.set(attr(a, "abstractNumId") ?? "", levels);
  }
  for (const n of Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "num")) {
    const absId = attr(childEl(n, "abstractNumId"), "val") ?? "";
    const levels = (abstract.get(absId) ?? []).map((l) => ({ ...l }));
    for (const ov of Array.from(n.children).filter((c) => c.localName === "lvlOverride")) {
      const i = parseInt(attr(ov, "ilvl") ?? "0", 10);
      const so = attr(childEl(ov, "startOverride"), "val");
      if (so && levels[i]) levels[i].start = parseInt(so, 10);
    }
    out.set(attr(n, "numId") ?? "", levels);
  }
  return out;
}

const ROMAN_PAIRS: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN_PAIRS) while (n >= v) (out += s), (n -= v);
  return out;
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter":
      return String.fromCharCode(96 + (((n - 1) % 26) + 1));
    case "upperLetter":
      return String.fromCharCode(64 + (((n - 1) % 26) + 1));
    case "lowerRoman":
      return roman(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "bullet":
    case "none":
      return "";
    default:
      return String(n);
  }
}

function headingLevel(styleId: string | null, styleNames: Map<string, string>): number | undefined {
  if (!styleId) return undefined;
  const name = (styleNames.get(styleId) ?? styleId).toLowerCase();
  if (name === "title") return 1;
  const m = /heading\s*(\d)/.exec(name);
  return m ? Math.min(6, parseInt(m[1], 10)) : undefined;
}

export async function extractDocx(fileName: string, bytes: Uint8Array): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("This file is not a valid Word document (word/document.xml is missing).");
  const numbering = parseNumbering((await zip.file("word/numbering.xml")?.async("string")) ?? null);
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  const styleNames = new Map<string, string>();
  if (stylesXml) {
    const sdoc = new DOMParser().parseFromString(stylesXml, "application/xml");
    for (const s of Array.from(sdoc.getElementsByTagName("*")).filter((e) => e.localName === "style")) {
      const id = attr(s, "styleId");
      const name = attr(childEl(s, "name") ?? null, "val");
      if (id && name) styleNames.set(id, name);
    }
  }

  const doc = new DOMParser().parseFromString(docXml, "application/xml");
  const body = Array.from(doc.getElementsByTagName("*")).find((e) => e.localName === "body");
  const lines: ExtractedLine[] = [];
  const counters = new Map<string, number[]>();
  const unsupported = new Set<string>();
  let images = 0;
  let title = "";

  const runText = (r: Element): string => {
    let t = "";
    for (const c of Array.from(r.children)) {
      if (c.localName === "t") t += c.textContent ?? "";
      else if (c.localName === "tab") t += " ";
      else if (c.localName === "br" || c.localName === "cr") t += "\n";
      else if (c.localName === "noBreakHyphen") t += "-";
      else if (c.localName === "drawing" || c.localName === "pict" || c.localName === "object") {
        images++;
        t += " [figure] ";
      }
    }
    const rPr = childEl(r, "rPr");
    const bold = rPr && childEl(rPr, "b") && attr(childEl(rPr, "b"), "val") !== "0";
    const italic = rPr && childEl(rPr, "i") && attr(childEl(rPr, "i"), "val") !== "0";
    if (!t.trim()) return t;
    const lead = /^\s*/.exec(t)![0];
    const trail = /\s*$/.exec(t)![0];
    const core = t.trim();
    if (bold && italic) return `${lead}***${core}***${trail}`;
    if (bold) return `${lead}**${core}**${trail}`;
    if (italic) return `${lead}*${core}*${trail}`;
    return t;
  };

  const paragraphText = (p: Element): string => {
    let out = "";
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        switch (c.localName) {
          case "r":
            out += runText(c);
            break;
          case "oMath": {
            const res = ommlToLatex(c);
            res.unsupported.forEach((u) => unsupported.add(u));
            out += `\\(${res.latex}\\)`;
            break;
          }
          case "oMathPara": {
            const maths = Array.from(c.children).filter((x) => x.localName === "oMath");
            for (const m of maths) {
              const res = ommlToLatex(m);
              res.unsupported.forEach((u) => unsupported.add(u));
              out += `\n\\[${res.latex}\\]\n`;
            }
            break;
          }
          case "hyperlink":
          case "ins":
          case "smartTag":
          case "sdt":
          case "sdtContent":
          case "fldSimple":
            walk(c);
            break;
          case "del":
          case "pPr":
            break;
          default:
            break;
        }
      }
    };
    walk(p);
    // Merge adjacent identical emphasis markers produced by split runs ("**a****b**").
    return out.replace(/\*\*\*\*/g, "").replace(/(?<!\*)\*\*(?!\*)\s*\*\*(?!\*)/g, " ");
  };

  const handleParagraph = (p: Element) => {
    const pPr = childEl(p, "pPr");
    const styleId = attr(childEl(pPr ?? p, "pStyle") ?? null, "val");
    const heading = pPr ? headingLevel(styleId, styleNames) : undefined;
    let listLabel: string | undefined;
    let listLevel: number | undefined;
    const numPr = pPr ? childEl(pPr, "numPr") : undefined;
    if (numPr) {
      const numId = attr(childEl(numPr, "numId"), "val") ?? "";
      const ilvl = parseInt(attr(childEl(numPr, "ilvl"), "val") ?? "0", 10);
      const levels = numbering.get(numId);
      if (levels && numId !== "0") {
        const ctr = counters.get(numId) ?? [];
        for (let i = 0; i <= ilvl; i++) if (ctr[i] === undefined) ctr[i] = (levels[i]?.start ?? 1) - 1;
        ctr[ilvl]++;
        ctr.length = ilvl + 1;
        counters.set(numId, ctr);
        const lvl = levels[ilvl];
        if (lvl && lvl.fmt !== "bullet" && lvl.fmt !== "none") {
          listLabel = lvl.text.replace(/%(\d)/g, (_, k: string) => {
            const i = parseInt(k, 10) - 1;
            return formatNumber(ctr[i] ?? 1, levels[i]?.fmt ?? "decimal");
          });
        } else if (lvl?.fmt === "bullet") listLabel = "-";
        listLevel = ilvl;
      }
    }
    const text = paragraphText(p);
    for (const [i, piece] of text.split("\n").entries()) {
      const flags: ImportFlag[] = [];
      if (i === 0 && heading === 1 && !title) title = piece.replace(/\*+/g, "").trim();
      lines.push({
        text: i === 0 && listLabel === "-" ? `- ${piece}` : piece,
        heading: i === 0 ? heading : undefined,
        listLabel: i === 0 && listLabel !== "-" ? listLabel : undefined,
        listLevel: i === 0 ? listLevel : undefined,
        flags: flags.length ? flags : undefined,
      });
    }
    lines.push({ text: "" });
  };

  const walkBody = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.localName === "p") handleParagraph(c);
      else if (c.localName === "tbl") {
        for (const p of Array.from(c.getElementsByTagName("*")).filter((e) => e.localName === "p")) handleParagraph(p);
      } else if (c.localName === "sdt" || c.localName === "sdtContent" || c.localName === "customXml") walkBody(c);
    }
  };
  if (body) walkBody(body);

  const warnings: string[] = [];
  if (unsupported.size) warnings.push(`Some equation elements were converted approximately (${[...unsupported].join(", ")}). Please check the formulas.`);
  if (images) warnings.push(`${images} embedded figure(s) are not imported; they are marked “[figure]” in the text.`);
  return {
    fileName,
    format: "docx",
    title: title || fileName.replace(/\.[^.]+$/, ""),
    lines: lines.map((l) =>
      l.listLabel && (l.listLevel ?? 0) === 0 && !/^\(?\d+[.)]?$/.test(l.listLabel)
        ? { ...l, text: `${l.listLabel} ${l.text}`, listLabel: undefined }
        : l,
    ),
    reliability: unsupported.size ? "uncertain" : "structured",
    warnings,
  };
}
