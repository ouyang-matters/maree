// Markdown and LaTeX export of problems and collections. The original LaTeX of every
// formula is copied verbatim; only the surrounding Markdown is translated for .tex output.

import type { Problem } from "../data/types";
import type { LibraryIndex } from "../domain/filters";
import { courseLabel, lectureLabel, naturalCompare } from "../domain/filters";
import { CATEGORY_LABEL, DIFFICULTY_LABEL, OUTCOME_LABEL, STATUS_LABEL } from "../domain/status";
import { splitMath } from "../math/segments";
import { fmtDateTime } from "../i18n";

export interface ExportOptions {
  title: string;
  subtitle?: string;
  includeSolution: boolean;
  includeReference: boolean;
  includeNotes: boolean;
  includeAttempts: boolean;
  includeMetadata: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = {
  title: "Marée export",
  includeSolution: true,
  includeReference: false,
  includeNotes: false,
  includeAttempts: false,
  includeMetadata: true,
};

export function problemHeading(p: Pick<Problem, "sourceNumber" | "title">): string {
  if (p.sourceNumber && p.title) return `Problem ${p.sourceNumber} — ${p.title}`;
  if (p.sourceNumber) return `Problem ${p.sourceNumber}`;
  return p.title || "Problem";
}

export function metadataLine(p: Problem, index: LibraryIndex): string {
  const bits: string[] = [];
  const c = p.courseId ? index.courses.get(p.courseId) : undefined;
  if (c) bits.push(c.code || c.title);
  const lecs = p.lectureIds.map((id) => index.lectures.get(id)).filter(Boolean);
  if (lecs.length) bits.push(lecs.map((l) => (l!.number ? `Lecture ${l!.number}` : l!.title)).join(", "));
  const topics = p.topicIds.map((id) => index.topics.get(id)?.name).filter(Boolean);
  if (topics.length) bits.push(`Topics: ${topics.join(", ")}`);
  const src = p.sourceId ? index.sources.get(p.sourceId) : undefined;
  if (src) bits.push(`Source: ${src.title}${p.sourcePage ? `, p. ${p.sourcePage}` : ""}`);
  if (p.difficulty) bits.push(`Difficulty ${p.difficulty}/4 (${DIFFICULTY_LABEL[p.difficulty]})`);
  if (p.category) bits.push(CATEGORY_LABEL[p.category]);
  bits.push(STATUS_LABEL[p.status]);
  return bits.join(" · ");
}

// ---------------------------------------------------------------- Markdown

export function problemToMarkdown(p: Problem, index: LibraryIndex, opts: ExportOptions, level = 2): string {
  const h = "#".repeat(level);
  const out: string[] = [`${h} ${problemHeading(p)}`];
  if (opts.includeMetadata) out.push(`*${metadataLine(p, index)}*`);
  if (p.statement.trim()) out.push(p.statement.trim());
  for (const part of p.parts) {
    out.push(`**(${part.label})** ${part.statement.trim()}`);
  }
  const section = (title: string, body: string) => {
    if (body.trim()) out.push(`${h}# ${title}`, body.trim());
  };
  if (opts.includeSolution) {
    section("My solution", p.solution);
    for (const part of p.parts) section(`My solution (${part.label})`, part.solution);
  }
  if (opts.includeReference) {
    section("Reference solution", p.referenceSolution);
    for (const part of p.parts) section(`Reference solution (${part.label})`, part.referenceSolution);
  }
  if (opts.includeNotes) {
    section("Notes", p.notes);
    for (const part of p.parts) section(`Notes (${part.label})`, part.notes);
  }
  if (opts.includeAttempts && p.attempts.length) {
    out.push(`${h}# Attempts`);
    for (const a of p.attempts) {
      out.push(`**${fmtDateTime(a.createdAt)} — ${OUTCOME_LABEL[a.outcome]}**${a.note ? ` — ${a.note}` : ""}`, a.content.trim() || "*(empty)*");
    }
  }
  return out.join("\n\n");
}

/** Groups problems by course and lecture, in library order. */
export function groupForExport(problems: Problem[], index: LibraryIndex): { heading: string; problems: Problem[] }[] {
  const groups = new Map<string, { heading: string; order: string; problems: Problem[] }>();
  for (const p of problems) {
    const c = p.courseId ? index.courses.get(p.courseId) : undefined;
    const lec = p.lectureIds
      .map((id) => index.lectures.get(id))
      .filter(Boolean)
      .sort((a, b) => a!.sortOrder - b!.sortOrder)[0];
    const key = `${c?.id ?? "~"}|${lec?.id ?? "~"}`;
    const heading = [c ? courseLabel(c) : "", lec ? lectureLabel(lec) : ""].filter(Boolean).join(" · ") || "Other problems";
    const order = `${c ? String(c.sortOrder).padStart(6, "0") : "999999"}|${lec ? String(lec.sortOrder).padStart(6, "0") : "999999"}`;
    if (!groups.has(key)) groups.set(key, { heading, order, problems: [] });
    groups.get(key)!.problems.push(p);
  }
  return [...groups.values()]
    .sort((a, b) => a.order.localeCompare(b.order))
    .map((g) => ({
      heading: g.heading,
      problems: g.problems.sort((a, b) => naturalCompare(a.sourceNumber, b.sourceNumber) || a.createdAt.localeCompare(b.createdAt)),
    }));
}

export function collectionToMarkdown(problems: Problem[], index: LibraryIndex, opts: ExportOptions): string {
  const out: string[] = [`# ${opts.title}`];
  if (opts.subtitle) out.push(`*${opts.subtitle}*`);
  const groups = groupForExport(problems, index);
  for (const g of groups) {
    if (groups.length > 1) out.push(`## ${g.heading}`);
    for (const p of g.problems) out.push(problemToMarkdown(p, index, opts, groups.length > 1 ? 3 : 2), "---");
  }
  return out.join("\n\n").replace(/\n\n---$/, "") + "\n";
}

// ------------------------------------------------------------------- LaTeX

function escapeTextLatex(s: string): string {
  return s
    .replace(/([%#&])/g, "\\$1")
    .replace(/(^|[^\\])_/g, "$1\\_")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/(^|[^\\])\^/g, "$1\\textasciicircum{}");
}

function inlineMdToLatex(s: string): string {
  return escapeTextLatex(s)
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "\\textbf{\\emph{$1}}")
    .replace(/\*\*([^*\n]+)\*\*/g, "\\textbf{$1}")
    .replace(/(^|[^*\\])\*([^*\n]+)\*/g, "$1\\emph{$2}")
    .replace(/`([^`\n]+)`/g, "\\texttt{$1}")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 (\\url{$2})");
}

/** Converts LaTeX-flavoured Markdown to LaTeX. Math segments are copied unchanged. */
export function markdownToLatex(src: string): string {
  // Fenced code blocks first.
  const blocks = src.split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/m);
  return blocks
    .map((block) => {
      if (/^```/.test(block)) {
        return `\\begin{verbatim}\n${block.replace(/^```[^\n]*\n/, "").replace(/```\s*$/, "")}\\end{verbatim}`;
      }
      const segs = splitMath(block);
      const converted = segs
        .map((s) => {
          if (s.type === "math") {
            if (s.raw.startsWith("$$")) return `\\[${s.body}\\]`;
            return s.raw;
          }
          return s.raw
            .split("\n")
            .map((line) => {
              const h = /^(#{1,6})\s+(.*)$/.exec(line);
              if (h) return `\\paragraph{${inlineMdToLatex(h[2])}}`;
              if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return "\\medskip\\hrule\\medskip";
              const q = /^>\s?(.*)$/.exec(line);
              if (q) return `\\begin{quote}${inlineMdToLatex(q[1])}\\end{quote}`;
              return inlineMdToLatex(line);
            })
            .join("\n");
        })
        .join("");
      return convertLists(converted);
    })
    .join("");
}

function convertLists(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let open: "itemize" | "enumerate" | null = null;
  for (const line of lines) {
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const kind = bullet ? "itemize" : num ? "enumerate" : null;
    if (kind) {
      if (open !== kind) {
        if (open) out.push(`\\end{${open}}`);
        out.push(`\\begin{${kind}}`);
        open = kind;
      }
      out.push(`  \\item ${(bullet ?? num)![1]}`);
      continue;
    }
    if (open && line.trim() === "") {
      out.push(`\\end{${open}}`);
      open = null;
    } else if (open && /^\s{2,}\S/.test(line)) {
      out.push(line);
      continue;
    } else if (open) {
      out.push(`\\end{${open}}`);
      open = null;
    }
    out.push(line);
  }
  if (open) out.push(`\\end{${open}}`);
  return out.join("\n");
}

export function macrosToLatexPreamble(macros: Record<string, string>): string {
  return Object.entries(macros)
    .map(([name, body]) => {
      const args = Math.max(0, ...[...body.matchAll(/#(\d)/g)].map((m) => Number(m[1])));
      return `\\providecommand{${name}}${args ? `[${args}]` : ""}{${body}}`;
    })
    .join("\n");
}

function latexEscapePlain(s: string): string {
  return s.replace(/\\/g, "\\textbackslash{}").replace(/([%#&_{}$])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
}

export function collectionToLatex(problems: Problem[], index: LibraryIndex, opts: ExportOptions, macros: Record<string, string>): string {
  const out: string[] = [
    "% Exported from Marée. Formulas are reproduced verbatim from the library.",
    "\\documentclass[11pt]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{lmodern}",
    "\\usepackage{amsmath,amssymb,amsthm}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{enumitem}",
    "\\usepackage{url}",
    "\\setlength{\\parindent}{0pt}",
    "\\setlength{\\parskip}{0.6em}",
    "\\theoremstyle{definition}",
    ...["theorem", "lemma", "proposition", "corollary", "definition", "example", "remark", "claim", "exercise", "problem", "solution", "note", "hint"].map(
      (e) => `\\newtheorem*{${e}}{${e[0].toUpperCase()}${e.slice(1)}}`,
    ),
    macrosToLatexPreamble(macros),
    `\\title{${latexEscapePlain(opts.title)}}`,
    `\\date{${latexEscapePlain(opts.subtitle ?? "")}}`,
    "\\begin{document}",
    "\\maketitle",
  ];
  const groups = groupForExport(problems, index);
  for (const g of groups) {
    if (groups.length > 1) out.push(`\\section*{${latexEscapePlain(g.heading)}}`);
    for (const p of g.problems) {
      out.push(`\\subsection*{${latexEscapePlain(problemHeading(p))}}`);
      if (opts.includeMetadata) out.push(`{\\small\\itshape ${latexEscapePlain(metadataLine(p, index))}}\n`);
      if (p.statement.trim()) out.push(markdownToLatex(p.statement.trim()));
      if (p.parts.length) {
        out.push("\\begin{enumerate}[label=(\\alph*)]");
        for (const part of p.parts) out.push(`\\item[(${part.label})] ${markdownToLatex(part.statement.trim())}`);
        out.push("\\end{enumerate}");
      }
      const block = (title: string, body: string) => {
        if (body.trim()) out.push(`\\paragraph{${title}}`, markdownToLatex(body.trim()));
      };
      if (opts.includeSolution) {
        block("My solution.", p.solution);
        for (const part of p.parts) block(`My solution (${part.label}).`, part.solution);
      }
      if (opts.includeReference) {
        block("Reference solution.", p.referenceSolution);
        for (const part of p.parts) block(`Reference solution (${part.label}).`, part.referenceSolution);
      }
      if (opts.includeNotes) {
        block("Notes.", p.notes);
        for (const part of p.parts) block(`Notes (${part.label}).`, part.notes);
      }
    }
  }
  out.push("\\end{document}", "");
  return out.join("\n");
}

export function safeFileName(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "export"
  );
}
