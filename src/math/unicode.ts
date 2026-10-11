// Unicode ↔ LaTeX helpers for extracted text.
//
// `normalizeExtracted` only performs lossless, meaning-preserving clean-up
// (ligatures, mathematical alphanumerics, odd spaces). Anything that guesses at
// mathematical structure lives in `assistedLatex`, which callers must flag for review.

export const UNICODE_TO_LATEX: Record<string, string> = {
  // Greek
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ϵ: "\\epsilon", ζ: "\\zeta",
  η: "\\eta", θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu",
  ξ: "\\xi", π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", ϱ: "\\varrho", σ: "\\sigma", ς: "\\varsigma", τ: "\\tau",
  υ: "\\upsilon", φ: "\\varphi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma",
  Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  // Logic and sets
  "∀": "\\forall", "∃": "\\exists", "∄": "\\nexists", "¬": "\\neg", "∧": "\\land", "∨": "\\lor",
  "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊃": "\\supset", "⊆": "\\subseteq",
  "⊇": "\\supseteq", "⊊": "\\subsetneq", "∪": "\\cup", "∩": "\\cap", "∖": "\\setminus", "∅": "\\emptyset",
  "⋃": "\\bigcup", "⋂": "\\bigcap", "×": "\\times", "∘": "\\circ",
  // Relations
  "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "≃": "\\simeq",
  "≅": "\\cong", "∝": "\\propto", "≪": "\\ll", "≫": "\\gg", "⊥": "\\perp", "∥": "\\parallel", "∣": "\\mid",
  "≺": "\\prec", "≻": "\\succ",
  // Arrows
  "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\implies", "⇐": "\\impliedby",
  "⇔": "\\iff", "↦": "\\mapsto", "↑": "\\uparrow", "↓": "\\downarrow", "⟶": "\\longrightarrow",
  "↪": "\\hookrightarrow", "↠": "\\twoheadrightarrow",
  // Operators
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint", "√": "\\sqrt", "∂": "\\partial",
  "∇": "\\nabla", "±": "\\pm", "∓": "\\mp", "·": "\\cdot", "⋅": "\\cdot", "∗": "\\ast", "⊕": "\\oplus",
  "⊗": "\\otimes", "÷": "\\div", "−": "-", "′": "'", "″": "''", "∞": "\\infty",
  // Delimiters
  "⟨": "\\langle", "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "‖": "\\|",
  // Letterlike
  ℝ: "\\mathbb{R}", ℕ: "\\mathbb{N}", ℤ: "\\mathbb{Z}", ℚ: "\\mathbb{Q}", ℂ: "\\mathbb{C}", ℙ: "\\mathbb{P}",
  ℓ: "\\ell", ℵ: "\\aleph", "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots", "⋱": "\\ddots",
  "□": "\\square", "∎": "\\blacksquare",
};

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i", "ᵏ": "k", "ᵐ": "m", "ˣ": "x",
};
const SUBSCRIPTS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")", "ₙ": "n", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₘ": "m", "ₓ": "x",
};

const LIGATURES: Record<string, string> = { "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

/** Mathematical Alphanumeric Symbols (U+1D400–1D7FF) → plain letters/digits. Lossless for reading purposes. */
function mathAlnumToAscii(cp: number): string | null {
  if (cp < 0x1d400 || cp > 0x1d7ff) return null;
  if (cp >= 0x1d7ce) return String((cp - 0x1d7ce) % 10); // digits
  const special: Record<number, string> = { 0x1d6a4: "ı", 0x1d6a5: "ȷ" };
  if (special[cp]) return special[cp];
  if (cp >= 0x1d6a8) return null; // Greek variants: leave as is
  const offset = (cp - 0x1d400) % 52;
  return offset < 26 ? String.fromCharCode(65 + offset) : String.fromCharCode(97 + offset - 26);
}

export function normalizeExtracted(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const alnum = mathAlnumToAscii(cp);
    if (alnum !== null) out += alnum;
    else if (LIGATURES[ch]) out += LIGATURES[ch];
    else if (ch === " " || ch === " " || ch === " " || ch === " " || ch === " ") out += " ";
    else if (ch === "­" || ch === "​" || ch === "﻿") continue;
    else if (cp === 0x210e) out += "h"; // planck constant used as italic h
    else out += ch;
  }
  return out.replace(/\r\n?/g, "\n");
}

const MATH_CHAR = /[Ͱ-Ͽ∀-⋿←-⇿⟀-⟯⦀-⧿⨀-⫿⁰-₟ℝℕℤℚℂℙℓℵ√∞±×÷·′″⟨⟩⌊⌋⌈⌉‖]/u;

export function hasMathUnicode(s: string): boolean {
  return MATH_CHAR.test(s);
}

/** Share of characters that are private-use, replacement or control characters. */
export function garbledRatio(s: string): number {
  if (!s) return 0;
  let bad = 0;
  let total = 0;
  for (const ch of s) {
    total++;
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp === 0xfffd || (cp < 32 && cp !== 10 && cp !== 9 && cp !== 13)) bad++;
  }
  return bad / total;
}

function convertSymbols(run: string): string {
  let out = "";
  const chars = [...run];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (SUPERSCRIPTS[ch] !== undefined) {
      let sup = "";
      while (i < chars.length && SUPERSCRIPTS[chars[i]] !== undefined) sup += SUPERSCRIPTS[chars[i++]];
      i--;
      out += `^{${sup}}`;
      continue;
    }
    if (SUBSCRIPTS[ch] !== undefined) {
      let sub = "";
      while (i < chars.length && SUBSCRIPTS[chars[i]] !== undefined) sub += SUBSCRIPTS[chars[i++]];
      i--;
      out += `_{${sub}}`;
      continue;
    }
    const tex = UNICODE_TO_LATEX[ch];
    if (tex) {
      out += tex;
      const next = chars[i + 1];
      if (tex.startsWith("\\") && /^\\[a-zA-Z]+$/.test(tex) && next && /[a-zA-Z0-9]/.test(next)) out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

const STRONG = /[Ͱ-Ͽ∀-⋿←-⇿⟀-⟯⦀-⧿⁰-₟ℝℕℤℚℂℙℓℵ√∞±×÷·′⟨⟩⌊⌋⌈⌉‖=<>^_|]|\d[a-zA-Z]|[a-zA-Z]\d/u;
const WORDISH = /^[A-Za-z]{2,}[.,;:!?)]*$/;

function isMathToken(tok: string): boolean {
  const core = tok.replace(/^[(\[{]+|[)\]},.;:!?]+$/g, "");
  if (!core) return false;
  if (STRONG.test(tok)) return true;
  if (/^[+\-*/]$/.test(core)) return true;
  if (/^[A-Za-z]$/.test(core)) return !/^(a|A|I)$/.test(core);
  if (/^\d+$/.test(core)) return false;
  if (WORDISH.test(tok)) return false;
  return false;
}

/**
 * Best-effort conversion of extracted plain text (which may already contain `_{…}`/`^{…}`
 * produced from detected script positions) into LaTeX-flavoured Markdown. Runs of
 * "math-looking" tokens are wrapped in \( \). The output must always be reviewed.
 */
export function assistedLatex(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const out: string[] = [];
      let run: string[] = [];
      let runStrong = false;
      const flush = () => {
        if (!run.length) return;
        let trailingWs = "";
        while (run.length && /^\s+$/.test(run[run.length - 1])) trailingWs = run.pop()! + trailingWs;
        const joined = run.join("");
        const m = /^(.*?)([.,;:!?]*)$/s.exec(joined)!;
        let body = m[1];
        let trail = m[2];
        // A ")" closing a "(" that lies outside the run stays outside the math.
        const opens = (body.match(/\(/g) ?? []).length;
        const closes = (body.match(/\)/g) ?? []).length;
        if (closes > opens && body.endsWith(")")) {
          body = body.slice(0, -1);
          trail = ")" + trail;
        }
        const singleLetter = /^[A-Za-z]$/.test(body.replace(/[()]/g, ""));
        out.push(body && (runStrong || singleLetter) ? `\\(${convertSymbols(body)}\\)${trail}` : joined);
        out.push(trailingWs);
        run = [];
        runStrong = false;
      };
      for (const t of line.split(/(\s+)/)) {
        if (t === "") continue;
        if (/^\s+$/.test(t)) {
          if (run.length) run.push(t);
          else out.push(t);
          continue;
        }
        if (isMathToken(t)) {
          run.push(t);
          if (STRONG.test(t) || /^[+\-*/]$/.test(t)) runStrong = true;
        } else {
          flush();
          out.push(t);
        }
      }
      flush();
      return out.join("");
    })
    .join("\n");
}

/** Lexical symbol replacement only (no wrapping); used inside already-delimited math. */
export function symbolsToLatex(s: string): string {
  return convertSymbols(s);
}
