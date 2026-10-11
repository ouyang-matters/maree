// LaTeX-flavoured Markdown → HTML.
//
// Supported: CommonMark + tables, inline math \( \) and $ $, display math \[ \] and $$ $$,
// AMS display environments (align, gather, …) rendered by KaTeX, theorem-like environments
// (theorem, lemma, proof, …), LaTeX lists (enumerate/itemize/description), sectioning
// commands and common text commands (\textbf, \emph, …). Raw HTML is disabled.

import markdownIt from "markdown-it";
import type { MarkdownIt, StateBlock, StateInline, Token } from "markdown-it";
import katex from "katex";
import { MATH_ENVIRONMENTS, findEnvEnd, readMathAt, splitMath } from "./segments";

export const DEFAULT_MACROS: Record<string, string> = {
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\F": "\\mathbb{F}",
  "\\eps": "\\varepsilon",
  "\\abs": "\\left|#1\\right|",
  "\\norm": "\\left\\lVert#1\\right\\rVert",
  "\\set": "\\left\\{#1\\right\\}",
  "\\ip": "\\left\\langle#1,#2\\right\\rangle",
  "\\floor": "\\left\\lfloor#1\\right\\rfloor",
  "\\ceil": "\\left\\lceil#1\\right\\rceil",
  "\\dd": "\\,\\mathrm{d}",
  "\\seq": "(#1_n)_{n\\in\\mathbb{N}}",
};

let macros: Record<string, string> = { ...DEFAULT_MACROS };
const cache = new Map<string, string>();
const CACHE_LIMIT = 4000;

export function setMacros(m: Record<string, string>): void {
  macros = { ...m };
  cache.clear();
}

export function getMacros(): Record<string, string> {
  return { ...macros };
}

/** Parses a macro definition list: one `\name = expansion` (or `\newcommand{\name}[n]{…}`) per line. */
export function parseMacroText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%")) continue;
    const nc = /^\\(?:re)?newcommand\{?(\\[a-zA-Z]+)\}?(?:\[\d\])?\{(.*)\}$/.exec(line);
    if (nc) {
      out[nc[1]] = nc[2];
      continue;
    }
    const eq = /^(\\[a-zA-Z]+)\s*[=:]\s*(.+)$/.exec(line);
    if (eq) out[eq[1]] = eq[2].trim();
  }
  return out;
}

export function macrosToText(m: Record<string, string>): string {
  return Object.entries(m)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

function cleanTex(tex: string): string {
  // \label has no meaning without numbering; KaTeX would report it as an error.
  return tex.replace(/\\label\{[^}]*\}/g, "");
}

export function renderTex(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(cleanTex(tex), {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml",
      macros: { ...macros },
      maxExpand: 2000,
    });
  } catch (e) {
    html = `<span class="mx-tex-error" title="${escapeHtml(String(e))}">${escapeHtml(tex)}</span>`;
  }
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, html);
  return html;
}

export interface TexError {
  tex: string;
  message: string;
  display: boolean;
}

/** Validates every formula in a document; used by the import review and editor status. */
export function checkLatex(src: string): TexError[] {
  const errors: TexError[] = [];
  for (const s of splitMath(src)) {
    if (s.type !== "math") continue;
    try {
      katex.renderToString(cleanTex(s.body), {
        displayMode: s.display,
        throwOnError: true,
        strict: "ignore",
        macros: { ...macros },
        maxExpand: 2000,
      });
    } catch (e) {
      errors.push({ tex: s.raw, message: String((e as Error).message ?? e).replace(/^KaTeX parse error: /, ""), display: s.display });
    }
  }
  return errors;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ------------------------------------------------------------- environments

export const THEOREM_ENVS: Record<string, string> = {
  theorem: "Theorem",
  lemma: "Lemma",
  proposition: "Proposition",
  corollary: "Corollary",
  definition: "Definition",
  example: "Example",
  remark: "Remark",
  claim: "Claim",
  conjecture: "Conjecture",
  exercise: "Exercise",
  problem: "Problem",
  question: "Question",
  solution: "Solution",
  answer: "Answer",
  proof: "Proof",
  note: "Note",
  hint: "Hint",
  fact: "Fact",
  observation: "Observation",
  notation: "Notation",
};

const LIST_ENVS = ["enumerate", "itemize", "description"];

function lineOf(state: StateBlock, pos: number, startLine: number, endLine: number): number {
  let line = startLine;
  while (line < endLine - 1 && state.eMarks[line] < pos) line++;
  return line;
}

/** Text after `pos` up to the end of its line, if only whitespace. */
function restOfLineBlank(state: StateBlock, pos: number, line: number): boolean {
  return state.src.slice(pos, state.eMarks[line]).trim() === "";
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return min ? lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)![0].length))).join("\n") : text;
}

/** Splits list-environment content on top-level \item markers. */
function splitItems(body: string): { label: string | null; content: string }[] {
  const items: { label: string | null; content: string }[] = [];
  const re = /\\(begin|end)\{(enumerate|itemize|description)\}|\\item(?:\[([^\]]*)\])?/g;
  let depth = 0;
  let cur: { label: string | null; start: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] === "begin") depth++;
    else if (m[1] === "end") depth--;
    else if (depth === 0) {
      if (cur) items.push({ label: cur.label, content: body.slice(cur.start, m.index) });
      cur = { label: m[3] ?? null, start: m.index + m[0].length };
    }
  }
  if (cur) items.push({ label: cur.label, content: body.slice(cur.start) });
  return items;
}

function enumStyle(opt: string | undefined): string {
  if (!opt) return "decimal";
  if (/\\alph|\(a\)|^a[).]?$|label=\(?\\alph/.test(opt)) return opt.includes("(") ? "alpha-paren" : "alpha";
  if (/\\Alph|\(A\)|^A[).]?$/.test(opt)) return "Alpha";
  if (/\\roman|\(i\)|^i[).]?$/.test(opt)) return opt.includes("(") ? "roman-paren" : "roman";
  if (/\\Roman|\(I\)|^I[).]?$/.test(opt)) return "Roman";
  return "decimal";
}

function texBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const lineText = state.src.slice(start, state.eMarks[startLine]);
  if (lineText[0] !== "\\" && lineText[0] !== "$") return false;
  const limit = state.eMarks[endLine - 1];

  // Display math: \[ … \], $$ … $$, \begin{align} … \end{align}
  const math = readMathAt(state.src, start);
  if (math && math.display && math.end <= limit) {
    const last = lineOf(state, math.end - 1, startLine, endLine);
    if (!restOfLineBlank(state, math.end, last)) return false;
    if (silent) return true;
    const tok = state.push("math_block", "div", 0);
    tok.content = math.body;
    tok.markup = math.raw.slice(0, 2);
    tok.block = true;
    tok.map = [startLine, last + 1];
    state.line = last + 1;
    return true;
  }

  // Sectioning commands on their own line.
  const sec = /^\\(section|subsection|subsubsection|paragraph)\*?\{(.*)\}\s*$/.exec(lineText);
  if (sec) {
    if (silent) return true;
    const level = { section: 2, subsection: 3, subsubsection: 4, paragraph: 5 }[sec[1]]!;
    const open = state.push("heading_open", `h${level}`, 1);
    open.map = [startLine, startLine + 1];
    const inline = state.push("inline", "", 0);
    inline.content = sec[2];
    inline.map = [startLine, startLine + 1];
    inline.children = [];
    state.push("heading_close", `h${level}`, -1);
    state.line = startLine + 1;
    return true;
  }

  const env = /^\\begin\{([a-zA-Z]+)(\*?)\}(?:\[([^\]]*)\])?/.exec(lineText);
  if (!env) return false;
  const name = env[1];
  const isTheorem = name in THEOREM_ENVS;
  const isList = LIST_ENVS.includes(name);
  if (!isTheorem && !isList) return false;
  const envName = name + env[2];
  const bodyStart = start + env[0].length;
  const end = findEnvEnd(state.src, bodyStart, envName);
  if (end < 0 || end > limit) return false;
  const endMarker = `\\end{${envName}}`;
  const bodyEnd = end - endMarker.length;
  const last = lineOf(state, end - 1, startLine, endLine);
  if (!restOfLineBlank(state, end, last)) return false;
  if (silent) return true;

  const body = dedent(state.src.slice(bodyStart, bodyEnd).replace(/^[ \t]*\n/, ""));
  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;

  if (isTheorem) {
    const open = state.push("tex_env_open", "section", 1);
    open.info = name;
    open.meta = { title: env[3] ?? null };
    open.block = true;
    open.map = [startLine, last + 1];
    state.md.block.parse(body, state.md, state.env, state.tokens);
    const close = state.push("tex_env_close", "section", -1);
    close.info = name;
    close.block = true;
  } else {
    const ordered = name === "enumerate";
    const open = state.push(ordered ? "ordered_list_open" : "bullet_list_open", ordered ? "ol" : "ul", 1);
    open.block = true;
    open.map = [startLine, last + 1];
    open.attrSet("class", `tex-list tex-${name}`);
    if (ordered) open.attrSet("data-style", enumStyle(env[3]));
    for (const item of splitItems(body)) {
      const li = state.push("list_item_open", "li", 1);
      li.block = true;
      if (item.label !== null) {
        li.attrSet("data-label", item.label);
        li.attrSet("class", "has-label");
      }
      state.md.block.parse(dedent(item.content.replace(/^[ \t]*\n/, "")).trim(), state.md, state.env, state.tokens);
      state.push("list_item_close", "li", -1);
    }
    state.push(ordered ? "ordered_list_close" : "bullet_list_close", ordered ? "ol" : "ul", -1);
  }
  state.parentType = oldParent;
  state.lineMax = oldLineMax;
  state.line = last + 1;
  return true;
}

const TEXT_COMMANDS: Record<string, [string, string]> = {
  textbf: ["strong_open", "strong"],
  bf: ["strong_open", "strong"],
  textit: ["em_open", "em"],
  emph: ["em_open", "em"],
  textsl: ["em_open", "em"],
  underline: ["u_open", "u"],
  texttt: ["code_inline", "code"],
  textsc: ["sc_open", "span"],
  textrm: ["plain", ""],
  textup: ["plain", ""],
  mbox: ["plain", ""],
};

const SIMPLE_REPLACEMENTS: Record<string, string> = {
  ldots: "…",
  dots: "…",
  S: "§",
  P: "¶",
  textendash: "–",
  textemdash: "—",
  LaTeX: "LaTeX",
  TeX: "TeX",
  qquad: "  ",
  quad: " ",
};

const DROPPED_COMMANDS = /^\\(noindent|medskip|smallskip|bigskip|par|newpage|clearpage|centering|indent|hfill|vfill|maketitle)\b\s*/;
const DROPPED_WITH_ARG = /^\\(vspace|hspace|label)\*?\{[^}]*\}/;

function readBraced(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "\\") {
      i++;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function texInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  const ch = src[pos];
  if (ch !== "\\" && ch !== "$") return false;

  const math = readMathAt(src, pos);
  if (math && math.end <= state.posMax) {
    if (!silent) {
      const tok = state.push("math_inline", "span", 0);
      tok.content = math.body;
      tok.markup = math.raw.slice(0, 2);
      tok.meta = { display: math.display };
    }
    state.pos = math.end;
    return true;
  }
  if (ch !== "\\") return false;

  const rest = src.slice(pos, Math.min(state.posMax, pos + 40));

  if (/^\\\\(\[[^\]]*\])?/.test(rest) && !/^\\\\[\\$]/.test(rest)) {
    const m = /^\\\\(\[[^\]]*\])?/.exec(rest)!;
    if (!silent) state.push("hardbreak", "br", 0);
    state.pos += m[0].length;
    return true;
  }
  const drop = DROPPED_COMMANDS.exec(rest) ?? DROPPED_WITH_ARG.exec(rest);
  if (drop) {
    state.pos += drop[0].length;
    return true;
  }
  const ref = /^\\(ref|eqref|cite|autoref|cref)\{([^}]*)\}/.exec(rest);
  if (ref) {
    if (!silent) {
      const t = state.push("tex_ref", "span", 0);
      t.content = ref[1] === "eqref" ? `(${ref[2]})` : ref[1] === "cite" ? `[${ref[2]}]` : ref[2];
    }
    state.pos += ref[0].length;
    return true;
  }
  const cmd = /^\\([a-zA-Z]+)/.exec(rest);
  if (!cmd) return false;
  const name = cmd[1];
  if (name in SIMPLE_REPLACEMENTS) {
    if (!silent) state.push("text", "", 0).content = SIMPLE_REPLACEMENTS[name];
    state.pos += cmd[0].length;
    // Swallow an empty group or one following space, as TeX does.
    if (src.startsWith("{}", state.pos)) state.pos += 2;
    return true;
  }
  if (name in TEXT_COMMANDS && src[pos + cmd[0].length] === "{") {
    const open = pos + cmd[0].length;
    const close = readBraced(src, open);
    if (close < 0 || close >= state.posMax) return false;
    if (!silent) {
      const inner = src.slice(open + 1, close);
      const [type, tag] = TEXT_COMMANDS[name];
      if (type === "code_inline") {
        const t = state.push("code_inline", "code", 0);
        t.content = inner;
      } else if (type === "plain") {
        state.md.inline.parse(inner, state.md, state.env, state.tokens);
      } else {
        const o = state.push(type, tag, 1);
        if (type === "sc_open") o.attrSet("class", "smallcaps");
        state.md.inline.parse(inner, state.md, state.env, state.tokens);
        state.push(type.replace("_open", "_close"), tag, -1);
      }
    }
    state.pos = close + 1;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ renderer

function createMarkdown(): MarkdownIt {
  const md = markdownIt({ html: false, linkify: true, typographer: true, breaks: false });
  // Indentation is common in proofs; it should never turn text into a code block.
  md.disable("code");
  md.block.ruler.before("fence", "tex_block", texBlockRule, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.inline.ruler.before("escape", "tex_inline", texInlineRule);

  md.renderer.rules.math_inline = (tokens, idx) => {
    const t = tokens[idx];
    return renderTex(t.content, !!t.meta?.display);
  };
  md.renderer.rules.math_block = (tokens, idx) => `<div class="mx-display">${renderTex(tokens[idx].content, true)}</div>\n`;
  md.renderer.rules.tex_env_open = (tokens, idx) => {
    const t = tokens[idx];
    const label = THEOREM_ENVS[t.info] ?? t.info;
    const title = t.meta?.title ? ` <span class="mx-env-title">(${md.renderInline(String(t.meta.title))})</span>` : "";
    return `<section class="mx-env mx-env-${t.info}"><span class="mx-env-head">${label}${title}.</span>\n`;
  };
  md.renderer.rules.tex_env_close = (tokens, idx) =>
    tokens[idx].info === "proof" ? `<span class="mx-qed" aria-label="end of proof">∎</span></section>\n` : "</section>\n";
  md.renderer.rules.tex_ref = (tokens, idx) => `<span class="mx-ref">${escapeHtml(tokens[idx].content)}</span>`;
  md.renderer.rules.u_open = () => "<u>";
  md.renderer.rules.u_close = () => "</u>";
  md.renderer.rules.sc_open = () => '<span class="smallcaps">';
  md.renderer.rules.sc_close = () => "</span>";

  md.renderer.rules.list_item_open = (tokens, idx, options, _env, self) => {
    const t = tokens[idx];
    const label = t.attrGet("data-label");
    let html = self.renderToken(tokens, idx, options);
    if (label !== null) html += `<span class="mx-item-label">${md.renderInline(String(label))}</span> `;
    return html;
  };

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens: Token[], idx, options, env, self) => {
    const t = tokens[idx];
    const src = String(t.attrGet("src") ?? "");
    if (src.startsWith("attachment:")) {
      const alt = escapeHtml(t.content);
      return `<img class="mx-attachment" data-attachment="${escapeHtml(src.slice(11))}" alt="${alt}" />`;
    }
    return defaultImage(tokens, idx, options, env, self);
  };
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("rel", "noopener noreferrer");
    tokens[idx].attrSet("data-external", "true");
    return defaultLink(tokens, idx, options, env, self);
  };
  return md;
}

const md = createMarkdown();

export function renderMarkdown(src: string): string {
  if (!src.trim()) return "";
  try {
    return md.render(src);
  } catch (e) {
    return `<pre class="mx-render-error">${escapeHtml(String(e))}\n\n${escapeHtml(src)}</pre>`;
  }
}

/** Inline rendering (no paragraphs) for titles, list rows and labels. */
export function renderInline(src: string): string {
  if (!src) return "";
  try {
    return md.renderInline(src);
  } catch {
    return escapeHtml(src);
  }
}

export { MATH_ENVIRONMENTS };
