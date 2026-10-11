import { describe, expect, it } from "vitest";
import { checkLatex, parseMacroText, renderInline, renderMarkdown } from "../src/math/render";
import { plainText, safeTruncate, splitMath } from "../src/math/segments";

describe("splitMath", () => {
  it("is lossless and recognises every delimiter style", () => {
    const src =
      "Let \\(x_n \\to L\\). Then $|x_n| \\le M$ and\n\\[\\lim_{n\\to\\infty}x_n=L\\]\n$$\\sum_{k=1}^n k$$ plus \\begin{align}a&=b\\\\c&=d\\end{align} costs $5 and $10.";
    const segs = splitMath(src);
    expect(segs.map((s) => s.raw).join("")).toBe(src);
    const math = segs.filter((s) => s.type === "math");
    expect(math.map((m) => [m.body, m.display])).toEqual([
      ["x_n \\to L", false],
      ["|x_n| \\le M", false],
      ["\\lim_{n\\to\\infty}x_n=L", true],
      ["\\sum_{k=1}^n k", true],
      ["\\begin{align}a&=b\\\\c&=d\\end{align}", true],
    ]);
  });

  it("does not treat escaped dollars or currency as math", () => {
    expect(splitMath("costs \\$5 or $ 3").every((s) => s.type === "text")).toBe(true);
  });

  it("never truncates inside a formula", () => {
    const src = "Prove that \\(\\sum_{k=1}^{n} \\frac{1}{k(k+1)} = 1 - \\frac{1}{n+1}\\) for all n.";
    const t = safeTruncate(src, 20);
    expect(t).toBe("Prove that …");
    expect(plainText("Show \\(x^2 \\ge 0\\) **always**")).toBe("Show x^2 \\ge 0 always");
  });
});

describe("renderMarkdown", () => {
  it("renders inline and display math with KaTeX", () => {
    const html = renderMarkdown("Let \\(x_n \\to L\\).\n\n\\[\\lim_{n\\to\\infty}x_n=L\\]");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="mx-display"');
    expect(html).toContain("katex-display");
    expect(html).not.toContain("\\(");
  });

  it("handles quantifiers, sets, sums, products, matrices and Greek letters", () => {
    const src = String.raw`\[\forall \varepsilon>0\ \exists N\in\mathbb{N}\ \forall n\ge N:\ |a_n-L|<\varepsilon\]
\[A\cup B,\ A\cap B,\ \prod_{i=1}^n x_i,\ \begin{pmatrix}1&2\\3&4\end{pmatrix},\ \alpha\beta\Gamma\]`;
    expect(checkLatex(src)).toEqual([]);
    const html = renderMarkdown(src);
    expect(html).not.toContain("mx-tex-error");
    expect(html).not.toContain("katex-error");
  });

  it("renders theorem environments and proofs with a QED mark", () => {
    const html = renderMarkdown(
      "\\begin{theorem}[Monotone Convergence]\nEvery bounded monotone sequence converges.\n\\end{theorem}\n\n\\begin{proof}\nLet \\(L=\\sup x_n\\).\n\\end{proof}",
    );
    expect(html).toContain('class="mx-env mx-env-theorem"');
    expect(html).toContain("Monotone Convergence");
    expect(html).toContain("mx-qed");
    expect(html).toMatch(/<p>Let <span class="katex">/);
  });

  it("renders AMS alignment environments as display math", () => {
    const html = renderMarkdown("\\begin{align*}\n|a_n - L| &\\le |a_n - b_n| + |b_n - L| \\\\\n&< \\varepsilon\n\\end{align*}");
    expect(html).toContain("mx-display");
    expect(html).not.toContain("katex-error");
  });

  it("converts LaTeX lists, text commands and sections", () => {
    const html = renderMarkdown(
      "\\section*{Lecture 9}\nShow \\textbf{both}:\n\\begin{enumerate}[(a)]\n\\item \\((x_n)\\) is bounded;\n\\item \\emph{monotone}.\n\\end{enumerate}",
    );
    expect(html).toContain("<h2>Lecture 9</h2>");
    expect(html).toContain("<strong>both</strong>");
    expect(html).toContain('data-style="alpha-paren"');
    expect(html.match(/<li/g)?.length).toBe(2);
    expect(html).toContain("<em>monotone</em>");
  });

  it("does not turn indented proof text into code blocks and escapes raw HTML", () => {
    const html = renderMarkdown("    Indented line with \\(x\\)\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<pre>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps Markdown features: emphasis, code blocks, tables", () => {
    const html = renderMarkdown("**Key idea**\n\n```\ncode $x$\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<strong>Key idea</strong>");
    expect(html).toContain("<code>code $x$\n</code>");
    expect(html).toContain("<table>");
  });

  it("reports invalid LaTeX without throwing", () => {
    const errs = checkLatex("Fine \\(x\\) but broken \\(\\frac{1}{\\)");
    expect(errs).toHaveLength(1);
    expect(renderMarkdown("broken \\(\\frac{1}{\\)")).toContain("katex-error");
  });

  it("supports user macros", () => {
    expect(parseMacroText("\\R = \\mathbb{R}\n\\newcommand{\\T}{\\mathcal{T}}")).toEqual({
      "\\R": "\\mathbb{R}",
      "\\T": "\\mathcal{T}",
    });
    expect(checkLatex("\\(x\\in\\R, \\abs{x}, \\eps\\)")).toEqual([]);
  });

  it("renders inline titles", () => {
    expect(renderInline("Limit of \\(1/n\\)")).toContain("katex");
  });
});
