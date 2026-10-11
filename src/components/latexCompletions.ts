// LaTeX command completions for the editor. `snippet` uses CodeMirror snippet syntax.

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";
import { getMacros } from "../math/render";

const SIMPLE = [
  // Greek
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
  "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta",
  "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega",
  // Relations and logic
  "le", "leq", "ge", "geq", "ne", "neq", "approx", "equiv", "sim", "simeq", "cong", "propto", "ll", "gg", "in", "notin",
  "subset", "subseteq", "supset", "supseteq", "cup", "cap", "setminus", "emptyset", "varnothing", "forall", "exists",
  "nexists", "neg", "land", "lor", "implies", "impliedby", "iff", "to", "mapsto", "rightarrow", "leftarrow",
  "Rightarrow", "Leftarrow", "Leftrightarrow", "longrightarrow", "hookrightarrow", "mid", "nmid", "perp", "parallel",
  // Operators
  "sum", "prod", "coprod", "int", "iint", "oint", "bigcup", "bigcap", "lim", "limsup", "liminf", "sup", "inf", "max",
  "min", "sin", "cos", "tan", "log", "ln", "exp", "det", "dim", "ker", "gcd", "deg", "arg", "partial", "nabla", "infty",
  "pm", "mp", "cdot", "times", "div", "circ", "ast", "oplus", "otimes", "ldots", "cdots", "vdots", "ddots", "prime",
  // Delimiters and spacing
  "langle", "rangle", "lfloor", "rfloor", "lceil", "rceil", "lvert", "rvert", "lVert", "rVert", "quad", "qquad",
  "left", "right", "big", "Big", "bigg", "displaystyle", "textstyle", "qed", "square", "blacksquare", "ell", "aleph",
  "hbar", "Re", "Im",
];

const SNIPPETS: [string, string, string][] = [
  ["frac", "\\frac{${num}}{${den}}", "fraction"],
  ["dfrac", "\\dfrac{${num}}{${den}}", "display fraction"],
  ["sqrt", "\\sqrt{${}}", "square root"],
  ["mathbb", "\\mathbb{${R}}", "blackboard bold"],
  ["mathcal", "\\mathcal{${}}", "calligraphic"],
  ["mathrm", "\\mathrm{${}}", "upright"],
  ["text", "\\text{${}}", "text in math"],
  ["operatorname", "\\operatorname{${}}", "operator"],
  ["overline", "\\overline{${}}", "overline"],
  ["hat", "\\hat{${}}", "hat"],
  ["bar", "\\bar{${}}", "bar"],
  ["tilde", "\\tilde{${}}", "tilde"],
  ["vec", "\\vec{${}}", "vector"],
  ["binom", "\\binom{${n}}{${k}}", "binomial"],
  ["textbf", "\\textbf{${}}", "bold text"],
  ["emph", "\\emph{${}}", "emphasis"],
  ["limn", "\\lim_{n\\to\\infty} ${}", "limit n → ∞"],
  ["sumk", "\\sum_{k=${1}}^{${n}} ${}", "sum"],
  ["intab", "\\int_{${a}}^{${b}} ${f(x)}\\,dx", "integral"],
  ["begin", "\\begin{${env}}\n\t${}\n\\end{${env}}", "environment"],
  ["align", "\\begin{align*}\n\t${} &= ${} \\\\\n\t&= ${}\n\\end{align*}", "aligned equations"],
  ["cases", "\\begin{cases}\n\t${} & \\text{if } ${} \\\\\n\t${} & \\text{otherwise}\n\\end{cases}", "cases"],
  ["pmatrix", "\\begin{pmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{pmatrix}", "matrix ( )"],
  ["bmatrix", "\\begin{bmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{bmatrix}", "matrix [ ]"],
  ["proof", "\\begin{proof}\n${}\n\\end{proof}", "proof environment"],
  ["theorem", "\\begin{theorem}[${name}]\n${}\n\\end{theorem}", "theorem environment"],
  ["lemma", "\\begin{lemma}\n${}\n\\end{lemma}", "lemma environment"],
  ["claim", "\\begin{claim}\n${}\n\\end{claim}", "claim environment"],
  ["enumerate", "\\begin{enumerate}[(a)]\n\\item ${}\n\\end{enumerate}", "lettered list"],
  ["epsn", "Let \\(\\varepsilon > 0\\). Choose \\(N \\in \\mathbb{N}\\) such that ${}. Then for all \\(n \\ge N\\),\n\\[\n\t|a_n - L| ${}< \\varepsilon.\n\\]", "ε–N proof template"],
];

const OPTIONS: Completion[] = [
  ...SIMPLE.map((c) => ({ label: `\\${c}`, type: "keyword", apply: `\\${c}` })),
  ...SNIPPETS.map(([label, snip, detail]) => snippetCompletion(snip, { label: `\\${label}`, detail, type: "function" })),
];

export function latexCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\\[a-zA-Z]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const macros = Object.keys(getMacros()).map((m) => ({ label: m, type: "variable", detail: "macro" }) as Completion);
  return { from: word.from, options: [...OPTIONS, ...macros], validFor: /^\\[a-zA-Z]*$/ };
}
