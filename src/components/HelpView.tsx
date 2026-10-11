import { commands } from "../commands/commands";
import { Kbd } from "../ui/Kbd";
import { MathView } from "./MathView";
import { t } from "../i18n";

const EXAMPLES: [string, string][] = [
  ["Inline mathematics", "Let \\(x_n \\to L\\) as \\(n \\to \\infty\\)."],
  ["Dollar delimiters", "Equivalently $|x_n - L| < \\varepsilon$ for large $n$."],
  ["Display mathematics", "\\[\\lim_{n\\to\\infty}x_n=L\\]"],
  ["Quantifiers and sets", "\\(\\forall \\varepsilon>0\\ \\exists N\\in\\mathbb{N}\\ \\forall n\\ge N:\\ |a_n-L|<\\varepsilon\\)"],
  ["Sums and products", "\\[\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}, \\qquad \\prod_{i=1}^{n} x_i\\]"],
  ["Aligned steps", "\\begin{align*}\n|a_nb_n - ab| &\\le |a_n||b_n-b| + |b||a_n-a| \\\\\n&< M\\varepsilon + |b|\\varepsilon\n\\end{align*}"],
  ["Matrices and cases", "\\[\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}, \\quad f(x)=\\begin{cases}x^2 & x\\ge 0\\\\ -x & x<0\\end{cases}\\]"],
  ["Theorem environments", "\\begin{theorem}[Monotone Convergence]\nA bounded monotone sequence converges.\n\\end{theorem}\n\\begin{proof}\nTake \\(L = \\sup_n x_n\\).\n\\end{proof}"],
  ["Lists", "\\begin{enumerate}[(a)]\n\\item Show \\((x_n)\\) is increasing.\n\\item Show it is bounded.\n\\end{enumerate}"],
  ["Markdown", "**Key idea.** Use the *triangle inequality*.\n\n- first step\n- second step"],
  ["Your macros", "\\(\\R, \\N, \\abs{x}, \\norm{v}, \\set{x : x > 0}, \\eps\\)"],
];

const EDITOR_KEYS: [string, string][] = [
  ["Ctrl+M", "Wrap selection in inline math \\( \\)"],
  ["Ctrl+Shift+M", "Wrap selection in display math \\[ \\]"],
  ["Ctrl+Shift+E", "Wrap selection in align*"],
  ["Ctrl+B", "Bold"],
  ["Ctrl+I", "Italic"],
  ["Ctrl+Space", "LaTeX command completion (also appears after typing \\)"],
  ["Ctrl+F", "Find in the editor"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
];

const LIST_KEYS: [string, string][] = [
  ["↑ ↓ or J K", "Move through problems"],
  ["Shift+↑ ↓", "Extend the selection"],
  ["Enter", "Open the problem in a tab"],
  ["Delete", "Move selected problems to the Trash"],
  ["Ctrl+A", "Select all visible problems"],
  ["Alt+1 … Alt+5", "Not started · In progress · Completed · Needs review · Mastered"],
];

export function HelpView() {
  const cmds = commands().filter((c) => c.shortcut && !c.hidden);
  return (
    <div className="doc-view">
      <div className="doc-inner">
        <h1 className="doc-title">{t("Keyboard shortcuts and LaTeX syntax")}</h1>
        <div className="help-grid">
          <section>
            <h2 className="set-section">{t("Application")}</h2>
            <table className="keys">
              <tbody>
                <tr>
                  <td>
                    <Kbd keys="Ctrl+K" />
                  </td>
                  <td>{t("Search problems, lectures, topics and commands (also Ctrl+P)")}</td>
                </tr>
                <tr>
                  <td>
                    <Kbd keys="Ctrl+Shift+P" />
                  </td>
                  <td>{t("Command palette (commands only)")}</td>
                </tr>
                {cmds.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Kbd keys={c.shortcut!} />
                    </td>
                    <td>{c.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="set-section">{t("Problem list")}</h2>
            <table className="keys">
              <tbody>
                {LIST_KEYS.map(([k, d]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>{t(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2 className="set-section">{t("Editor")}</h2>
            <table className="keys">
              <tbody>
                {EDITOR_KEYS.map(([k, d]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>{t(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">{t("Drag problems from the list onto a lecture, topic or course in the sidebar to assign them.")}</p>
          </section>
        </div>
        <h2 className="set-section">{t("Writing mathematics")}</h2>
        <p className="muted">
          {t("Text is Markdown with LaTeX mathematics. Formulas are stored exactly as typed and rendered with KaTeX; raw HTML is not interpreted.")}
        </p>
        <table className="syntax">
          <tbody>
            {EXAMPLES.map(([title, src]) => (
              <tr key={title}>
                <td className="syntax-title">{t(title)}</td>
                <td>
                  <pre className="selectable">{src}</pre>
                </td>
                <td>
                  <MathView source={src} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
