// LaTeX (.tex) extraction. Mathematics is kept byte-for-byte; only document
// structure (problem environments, enumerate items, sections, solutions) is interpreted.

import type { ExtractedDocument, ExtractedLine } from "./types";

const PROBLEM_ENV = /^(problem|exercise|question|prob|exo|ex|homework|task|exercice|hw)s?\*?$/i;
const SOLUTION_ENV = /^(solution|sol|answer|proof)\*?$/i;
const LIST_ENV = /^(enumerate|itemize)$/;

export function stripComments(src: string): string {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") {
        i++;
        continue;
      }
      if (line[i] === "%") {
        cut = i;
        break;
      }
    }
    if (cut < 0) out.push(line);
    else if (line.slice(0, cut).trim()) out.push(line.slice(0, cut).replace(/\s+$/, ""));
    // Whole-line comments disappear without leaving a paragraph break.
  }
  return out.join("\n");
}

function braced(src: string, from: number): { content: string; end: number } | null {
  if (src[from] !== "{") return null;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "\\") {
      i++;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return { content: src.slice(from + 1, i), end: i + 1 };
  }
  return null;
}

function commandArg(src: string, name: string): string | null {
  const i = src.search(new RegExp(`\\\\${name}\\s*\\{`));
  if (i < 0) return null;
  const open = src.indexOf("{", i);
  return braced(src, open)?.content ?? null;
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];

function labelFor(style: string, index: number): string {
  if (style === "alpha") return "abcdefghijklmnopqrstuvwxyz"[index] ?? String(index + 1);
  if (style === "roman") return ROMAN[index] ?? String(index + 1);
  return String(index + 1);
}

function enumStyle(opt: string): string {
  if (/\\alph|\(a\)|^a[).]?$/.test(opt)) return "alpha";
  if (/\\roman|\(i\)|^i[).]?$/.test(opt)) return "roman";
  if (/\\arabic|^1/.test(opt)) return "arabic";
  return "";
}

export function extractLatex(fileName: string, input: string): ExtractedDocument {
  let src = stripComments(input.replace(/\r\n?/g, "\n"));
  const title = commandArg(src, "title")?.replace(/\\\\/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const preambleEnd = src.indexOf("\\begin{document}");
  const preamble = preambleEnd >= 0 ? src.slice(0, preambleEnd) : "";
  if (preambleEnd >= 0) src = src.slice(preambleEnd + "\\begin{document}".length);
  const docEnd = src.indexOf("\\end{document}");
  if (docEnd >= 0) src = src.slice(0, docEnd);
  src = src.replace(/\\(maketitle|tableofcontents)\b/g, "");

  // Problem numbering "within" sections: \newtheorem{problem}{Problem}[section]
  const withinSection = /\\newtheorem\{(problem|exercise|question)\}\{[^}]*\}\[section\]/i.test(preamble);

  // Put structural commands on their own lines so the scanner can see them.
  src = src
    .replace(/[ \t]*(\\item\b)/g, "\n$1")
    .replace(/(\\begin\{([a-zA-Z]+\*?)\}(?:\[[^\]\n]*\])?)/g, (m, all: string, env: string) =>
      PROBLEM_ENV.test(env) || SOLUTION_ENV.test(env) || LIST_ENV.test(env) ? `\n${all}\n` : m,
    )
    .replace(/(\\end\{([a-zA-Z]+\*?)\})/g, (m, all: string, env: string) =>
      PROBLEM_ENV.test(env) || SOLUTION_ENV.test(env) || LIST_ENV.test(env) ? `\n${all}\n` : m,
    )
    .replace(/(\\(?:section|subsection|subsubsection)\*?\{)/g, "\n$1");

  const rawLines = src.split("\n");
  const hasProblemEnvs = rawLines.some((l) => {
    const m = /^\s*\\begin\{([a-zA-Z]+\*?)\}/.exec(l);
    return m && PROBLEM_ENV.test(m[1]);
  });

  const lines: ExtractedLine[] = [];
  let section = 0;
  let counter = 0;
  let inProblem = false;
  let inSolution = false;
  let pendingEnd = false;
  // Stack of open list environments: whether each is "structural" (items become problems/parts).
  const lists: { env: string; role: "problem" | "part" | "text"; style: string; index: number }[] = [];
  const topLevelItems = !hasProblemEnvs && countTopLevelItems(rawLines) >= 2;

  const flushEnd = () => {
    if (pendingEnd) {
      lines.push({ text: "", marker: { kind: "end" } });
      pendingEnd = false;
    }
  };

  for (const raw of rawLines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    const sec = /^\\(section|subsection|subsubsection)(\*?)\{/.exec(trimmed);
    if (sec) {
      flushEnd();
      const arg = braced(trimmed, trimmed.indexOf("{"));
      if (sec[1] === "section" && !sec[2]) {
        section++;
        if (withinSection) counter = 0;
      }
      lines.push({ text: arg?.content ?? trimmed, heading: sec[1] === "section" ? 2 : 3 });
      const rest = arg ? trimmed.slice(arg.end).trim() : "";
      if (rest) lines.push({ text: rest });
      continue;
    }
    const begin = /^\\begin\{([a-zA-Z]+\*?)\}(?:\[([^\]]*)\])?$/.exec(trimmed);
    const end = /^\\end\{([a-zA-Z]+\*?)\}$/.exec(trimmed);
    if (begin && PROBLEM_ENV.test(begin[1])) {
      flushEnd();
      counter++;
      inProblem = true;
      const number = withinSection && section ? `${section}.${counter}` : String(counter);
      lines.push({ text: "", marker: { kind: "problem", number, title: begin[2]?.trim() } });
      continue;
    }
    if (end && PROBLEM_ENV.test(end[1])) {
      inProblem = false;
      pendingEnd = true;
      continue;
    }
    if (begin && SOLUTION_ENV.test(begin[1]) && (inProblem || pendingEnd) && begin[1].toLowerCase() !== "proof") {
      inSolution = true;
      continue;
    }
    if (begin && begin[1].toLowerCase() === "proof" && pendingEnd) {
      inSolution = true;
      continue;
    }
    if (end && SOLUTION_ENV.test(end[1]) && inSolution) {
      inSolution = false;
      continue;
    }
    if (inSolution) {
      lines.push({ text: line, role: "solution" });
      continue;
    }
    if (trimmed && pendingEnd) flushEnd();

    if (begin && LIST_ENV.test(begin[1])) {
      const depthStructural = lists.filter((l) => l.role !== "text").length;
      let role: "problem" | "part" | "text" = "text";
      const style = enumStyle(begin[2] ?? "");
      if (begin[1] === "enumerate") {
        if (topLevelItems && lists.length === 0) role = "problem";
        else if ((inProblem || depthStructural === 1) && lists.length === depthStructural && (style === "alpha" || style === "roman" || depthStructural === 1))
          role = "part";
      }
      lists.push({ env: begin[1], role, style: style || (role === "part" ? "alpha" : "arabic"), index: 0 });
      if (role === "text") lines.push({ text: line });
      continue;
    }
    if (end && LIST_ENV.test(end[1]) && lists.length) {
      const l = lists.pop()!;
      if (l.role === "text") lines.push({ text: line });
      continue;
    }
    const item = /^\\item(?:\[([^\]]*)\])?\s*(.*)$/.exec(trimmed);
    const top = lists[lists.length - 1];
    if (item && top && top.role !== "text") {
      const explicit = item[1]?.replace(/[()\s.]/g, "");
      const label = explicit || labelFor(top.style, top.index);
      top.index++;
      if (top.role === "problem") lines.push({ text: item[2], marker: { kind: "problem", number: label } });
      else lines.push({ text: item[2], marker: { kind: "part", label: label.toLowerCase() } });
      continue;
    }
    lines.push({ text: line });
  }
  flushEnd();

  return {
    fileName,
    format: "latex",
    title: title || fileName.replace(/\.[^.]+$/, ""),
    lines,
    reliability: "exact",
    warnings: [],
  };
}

function countTopLevelItems(lines: string[]): number {
  let depth = 0;
  let n = 0;
  for (const l of lines) {
    const t = l.trim();
    if (/^\\begin\{(enumerate|itemize)\}/.test(t)) depth++;
    else if (/^\\end\{(enumerate|itemize)\}/.test(t)) depth--;
    else if (depth === 1 && /^\\item\b/.test(t)) n++;
  }
  return n;
}
