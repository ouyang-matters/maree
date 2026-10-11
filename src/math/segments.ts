// Splits LaTeX-flavoured Markdown into text and math segments without altering
// a single character: concatenating `raw` of all segments reproduces the input.

export const MATH_ENVIRONMENTS = [
  "equation",
  "equation*",
  "align",
  "align*",
  "aligned",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
  "CD",
];

export interface Segment {
  type: "text" | "math";
  display: boolean;
  /** Exact source text including delimiters. */
  raw: string;
  /** Math body without delimiters (for `\begin{env}` the whole environment). */
  body: string;
  start: number;
  end: number;
}

const ENV_BEGIN = /^\\begin\{([a-zA-Z]+\*?)\}/;

function isEscaped(src: string, pos: number): boolean {
  let n = 0;
  for (let i = pos - 1; i >= 0 && src[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

/** Index just past the matching closing delimiter, or -1. */
function findClose(src: string, from: number, close: string): number {
  let i = from;
  while (i < src.length) {
    const j = src.indexOf(close, i);
    if (j < 0) return -1;
    if (close === "$" || close === "$$") {
      if (!isEscaped(src, j)) return j;
    } else if (!isEscaped(src, j)) {
      return j;
    }
    i = j + 1;
  }
  return -1;
}

export function findEnvEnd(src: string, from: number, env: string): number {
  const esc = env.replace(/\*/g, "\\*");
  const re = new RegExp(`\\\\(begin|end)\\{${esc}\\}`, "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] === "begin") depth++;
    else if (--depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Tries to read a math segment starting at `i`. */
export function readMathAt(src: string, i: number): Segment | null {
  const c = src[i];
  if (c === "\\" && !isEscaped(src, i)) {
    const n = src[i + 1];
    if (n === "(" || n === "[") {
      const close = n === "(" ? "\\)" : "\\]";
      const j = findClose(src, i + 2, close);
      if (j < 0) return null;
      return {
        type: "math",
        display: n === "[",
        raw: src.slice(i, j + 2),
        body: src.slice(i + 2, j),
        start: i,
        end: j + 2,
      };
    }
    const m = ENV_BEGIN.exec(src.slice(i, i + 40));
    if (m && MATH_ENVIRONMENTS.includes(m[1])) {
      const end = findEnvEnd(src, i + m[0].length, m[1]);
      if (end < 0) return null;
      const raw = src.slice(i, end);
      return { type: "math", display: true, raw, body: raw, start: i, end };
    }
    return null;
  }
  if (c === "$" && !isEscaped(src, i)) {
    if (src[i + 1] === "$") {
      const j = findClose(src, i + 2, "$$");
      if (j < 0) return null;
      return { type: "math", display: true, raw: src.slice(i, j + 2), body: src.slice(i + 2, j), start: i, end: j + 2 };
    }
    // Pandoc rules: no space after the opening $, no space before the closing $,
    // and the closing $ is not followed by a digit (so "$5 and $10" stays text).
    const next = src[i + 1];
    if (!next || /\s/.test(next)) return null;
    let j = i + 1;
    while (j < src.length) {
      j = src.indexOf("$", j);
      if (j < 0) return null;
      if (!isEscaped(src, j) && !/\s/.test(src[j - 1]) && !/\d/.test(src[j + 1] ?? "")) break;
      j++;
    }
    const body = src.slice(i + 1, j);
    if (/\n\s*\n/.test(body)) return null;
    return { type: "math", display: false, raw: src.slice(i, j + 1), body, start: i, end: j + 1 };
  }
  return null;
}

export function splitMath(src: string): Segment[] {
  const out: Segment[] = [];
  let textStart = 0;
  let i = 0;
  const pushText = (end: number) => {
    if (end > textStart) {
      const raw = src.slice(textStart, end);
      out.push({ type: "text", display: false, raw, body: raw, start: textStart, end });
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" || c === "$") {
      const seg = readMathAt(src, i);
      if (seg) {
        pushText(i);
        out.push(seg);
        i = seg.end;
        textStart = i;
        continue;
      }
      if (c === "\\") {
        i += 2; // skip escaped char
        continue;
      }
    }
    i++;
  }
  pushText(src.length);
  return out;
}

/** Applies `fn` to text segments only, leaving every math segment untouched. */
export function mapTextSegments(src: string, fn: (text: string) => string): string {
  return splitMath(src)
    .map((s) => (s.type === "text" ? fn(s.raw) : s.raw))
    .join("");
}

/**
 * Truncates near `max` characters without cutting through a math segment,
 * so previews never show broken formulas.
 */
export function safeTruncate(src: string, max: number): string {
  if (src.length <= max) return src;
  let out = "";
  for (const s of splitMath(src)) {
    if (out.length + s.raw.length <= max) {
      out += s.raw;
      continue;
    }
    if (s.type === "text") {
      const room = max - out.length;
      const cut = s.raw.slice(0, room);
      const sp = cut.lastIndexOf(" ");
      out += sp > room * 0.6 ? cut.slice(0, sp) : cut;
    }
    break;
  }
  return out.trimEnd() + " …";
}

/** Readable plain text: math delimiters removed, Markdown markers stripped. Used for titles and labels. */
export function plainText(src: string): string {
  return splitMath(src)
    .map((s) => (s.type === "math" ? s.body.trim() : s.raw.replace(/[*_#>`]+/g, "")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
