// Office Math Markup (OMML, used by Word equations) → LaTeX.
// The conversion is structural, so it is reliable for the constructs listed below.
// Anything unrecognised is converted by recursing into its children and reported.

import { UNICODE_TO_LATEX } from "../math/unicode";

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "log", "ln", "lg", "exp", "lim", "liminf", "limsup", "sup", "inf", "max", "min", "det", "dim", "ker",
  "deg", "gcd", "arg", "hom", "Pr",
]);

const NARY: Record<string, string> = {
  "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint",
  "⋃": "\\bigcup", "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge", "⨁": "\\bigoplus", "⨂": "\\bigotimes",
};

const ACCENTS: Record<string, string> = {
  "̂": "\\hat", "^": "\\hat", "̃": "\\tilde", "~": "\\tilde", "̄": "\\bar", "̅": "\\overline",
  "¯": "\\bar", "̇": "\\dot", "̈": "\\ddot", "⃗": "\\vec", "̌": "\\check", "̆": "\\breve",
  "́": "\\acute", "̀": "\\grave",
};

const DELIM: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|", "⟨": "\\langle",
  "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "": ".",
};

export interface OmmlResult {
  latex: string;
  unsupported: string[];
}

function kids(el: Element): Element[] {
  return Array.from(el.children);
}

function child(el: Element, name: string): Element | undefined {
  return kids(el).find((c) => c.localName === name);
}

function prop(el: Element, propName: string, attr: string): string | null {
  const pr = child(el, propName);
  if (!pr) return null;
  for (const c of kids(pr)) {
    if (c.localName === attr) {
      return c.getAttribute("m:val") ?? c.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/math", "val") ?? c.getAttribute("val") ?? "";
    }
  }
  return null;
}

function hasProp(el: Element, propName: string, attr: string): boolean {
  return prop(el, propName, attr) !== null;
}

function group(s: string): string {
  const t = s.trim();
  if (/^[A-Za-z0-9]$/.test(t) || /^\\[a-zA-Z]+$/.test(t)) return t;
  return `{${t}}`;
}

function textToLatex(text: string, style: { plain: boolean; script: string | null }): string {
  if (style.plain && /^[A-Za-z]{2,}$/.test(text)) {
    return FUNCTIONS.has(text) ? `\\${text}` : `\\mathrm{${text}}`;
  }
  let out = "";
  for (const ch of text) {
    const tex = UNICODE_TO_LATEX[ch];
    if (tex) {
      out += tex.startsWith("\\") && /[a-zA-Z]$/.test(tex) ? `${tex} ` : tex;
    } else if (ch === "{" || ch === "}" || ch === "%" || ch === "#" || ch === "$") {
      out += `\\${ch}`;
    } else if (ch === "&") out += "&";
    else out += ch;
  }
  if (style.script === "double-struck") return /^[A-Za-z]$/.test(text) ? `\\mathbb{${text}}` : out;
  if (style.script === "script") return `\\mathcal{${out}}`;
  if (style.script === "fraktur") return `\\mathfrak{${out}}`;
  return out;
}

class Converter {
  unsupported: string[] = [];

  all(el: Element): string {
    return kids(el)
      .map((c) => this.node(c))
      .join("")
      .replace(/ +/g, " ");
  }

  arg(el: Element, name: string): string {
    const c = child(el, name);
    return c ? this.all(c).trim() : "";
  }

  node(el: Element): string {
    switch (el.localName) {
      case "oMath":
      case "e":
      case "num":
      case "den":
      case "sub":
      case "sup":
      case "deg":
      case "lim":
      case "fName":
      case "box":
      case "phant":
        return this.all(el);
      case "r": {
        const t = kids(el)
          .filter((c) => c.localName === "t")
          .map((c) => c.textContent ?? "")
          .join("");
        const sty = prop(el, "rPr", "sty");
        const scr = prop(el, "rPr", "scr");
        const plain = sty === "p" || hasProp(el, "rPr", "nor");
        return textToLatex(t, { plain, script: scr });
      }
      case "f": {
        const type = prop(el, "fPr", "type");
        const num = this.arg(el, "num");
        const den = this.arg(el, "den");
        if (type === "lin") return `${group(num)}/${group(den)}`;
        if (type === "noBar") return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
        if (type === "skw") return `{}^{${num}}\\!/\\!{}_{${den}}`;
        return `\\frac{${num}}{${den}}`;
      }
      case "sSup":
        return `${group(this.arg(el, "e"))}^{${this.arg(el, "sup")}}`;
      case "sSub":
        return `${group(this.arg(el, "e"))}_{${this.arg(el, "sub")}}`;
      case "sSubSup":
        return `${group(this.arg(el, "e"))}_{${this.arg(el, "sub")}}^{${this.arg(el, "sup")}}`;
      case "sPre":
        return `{}_{${this.arg(el, "sub")}}^{${this.arg(el, "sup")}}${group(this.arg(el, "e"))}`;
      case "rad": {
        const deg = this.arg(el, "deg");
        const hide = prop(el, "radPr", "degHide");
        const e = this.arg(el, "e");
        return deg && hide !== "1" && hide !== "on" ? `\\sqrt[${deg}]{${e}}` : `\\sqrt{${e}}`;
      }
      case "nary": {
        const chr = prop(el, "naryPr", "chr") ?? "∫";
        const op = NARY[chr] ?? textToLatex(chr, { plain: false, script: null });
        const sub = this.arg(el, "sub");
        const sup = this.arg(el, "sup");
        const subHide = prop(el, "naryPr", "subHide");
        const supHide = prop(el, "naryPr", "supHide");
        let s = op;
        if (sub && subHide !== "1" && subHide !== "on") s += `_{${sub}}`;
        if (sup && supHide !== "1" && supHide !== "on") s += `^{${sup}}`;
        return `${s} ${this.arg(el, "e")}`;
      }
      case "d": {
        const beg = prop(el, "dPr", "begChr") ?? "(";
        const end = prop(el, "dPr", "endChr") ?? ")";
        const sep = prop(el, "dPr", "sepChr") ?? "|";
        const parts = kids(el)
          .filter((c) => c.localName === "e")
          .map((c) => this.all(c).trim());
        const sepTex = DELIM[sep] ?? sep;
        const inner = parts.join(` ${sepTex === "|" ? "\\mid" : sepTex} `);
        return `\\left${DELIM[beg] ?? beg}${inner}\\right${DELIM[end] ?? end}`;
      }
      case "func": {
        const name = this.arg(el, "fName").trim();
        const known = /^\\[a-z]+/.test(name) || /^\\mathrm\{/.test(name);
        const fn = known ? name : FUNCTIONS.has(name) ? `\\${name}` : `\\operatorname{${name}}`;
        return `${fn}${needsSpace(fn) ? " " : ""}${this.arg(el, "e")}`;
      }
      case "limLow": {
        const e = this.arg(el, "e");
        return `${e === "lim" ? "\\lim" : group(e)}_{${this.arg(el, "lim")}}`;
      }
      case "limUpp":
        return `${group(this.arg(el, "e"))}^{${this.arg(el, "lim")}}`;
      case "acc": {
        const chr = prop(el, "accPr", "chr") ?? "̂";
        return `${ACCENTS[chr] ?? "\\hat"}{${this.arg(el, "e")}}`;
      }
      case "bar": {
        const pos = prop(el, "barPr", "pos");
        return pos === "bot" ? `\\underline{${this.arg(el, "e")}}` : `\\overline{${this.arg(el, "e")}}`;
      }
      case "groupChr": {
        const chr = prop(el, "groupChrPr", "chr") ?? "⏟";
        const pos = prop(el, "groupChrPr", "pos");
        const e = this.arg(el, "e");
        if (chr === "⏞" || pos === "top") return `\\overbrace{${e}}`;
        return `\\underbrace{${e}}`;
      }
      case "borderBox":
        return `\\boxed{${this.arg(el, "e")}}`;
      case "eqArr": {
        const rows = kids(el)
          .filter((c) => c.localName === "e")
          .map((c) => this.all(c).trim());
        return `\\begin{aligned}${rows.join(" \\\\ ")}\\end{aligned}`;
      }
      case "m": {
        const rows = kids(el)
          .filter((c) => c.localName === "mr")
          .map((r) =>
            kids(r)
              .filter((c) => c.localName === "e")
              .map((c) => this.all(c).trim())
              .join(" & "),
          );
        return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
      }
      case "t":
        return textToLatex(el.textContent ?? "", { plain: false, script: null });
      // Property containers carry no content.
      case "rPr":
      case "fPr":
      case "radPr":
      case "naryPr":
      case "dPr":
      case "funcPr":
      case "accPr":
      case "barPr":
      case "sSupPr":
      case "sSubPr":
      case "sSubSupPr":
      case "sPrePr":
      case "limLowPr":
      case "limUppPr":
      case "groupChrPr":
      case "borderBoxPr":
      case "boxPr":
      case "eqArrPr":
      case "mPr":
      case "ctrlPr":
      case "oMathParaPr":
      case "phantPr":
        return "";
      default:
        if (!this.unsupported.includes(el.localName)) this.unsupported.push(el.localName);
        return this.all(el);
    }
  }
}

function needsSpace(fn: string): boolean {
  return /\\[a-zA-Z]+$/.test(fn);
}

export function ommlToLatex(el: Element): OmmlResult {
  const c = new Converter();
  const latex = c
    .node(el)
    .replace(/\s+/g, " ")
    .replace(/\s+([_^}])/g, "$1")
    .replace(/\{\s+/g, "{")
    .trim();
  return { latex, unsupported: c.unsupported };
}
