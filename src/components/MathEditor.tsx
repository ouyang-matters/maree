// Source editor (CodeMirror 6) with live KaTeX preview.

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorSelection, EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  ViewPlugin,
  type ViewUpdate,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { Code2, Columns2, Eye, Sigma } from "lucide-react";
import { splitMath } from "../math/segments";
import { checkLatex } from "../math/render";
import { MathView } from "./MathView";
import { latexCompletions } from "./latexCompletions";
import { setActiveEditor } from "../commands/editing";
import { openMenuBelow, type MenuItem } from "../ui/Menu";
import { useStore } from "../state/store";
import type { Attachment } from "../data/types";
import { t } from "../i18n";

// ---------------------------------------------------- math highlighting

const mathMark = Decoration.mark({ class: "cm-math" });
const delimMark = Decoration.mark({ class: "cm-math-delim" });
const cmdMark = Decoration.mark({ class: "cm-tex-cmd" });
const envMark = Decoration.mark({ class: "cm-tex-env" });

function buildMathDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (const seg of splitMath(doc)) {
    if (seg.type === "math") {
      const open = seg.raw.startsWith("\\begin") ? 0 : seg.raw.startsWith("$$") || seg.raw.startsWith("\\(") || seg.raw.startsWith("\\[") ? 2 : 1;
      const close = open;
      if (open) ranges.push({ from: seg.start, to: seg.start + open, deco: delimMark });
      ranges.push({ from: seg.start + open, to: seg.end - close, deco: mathMark });
      const body = seg.raw.slice(open, seg.raw.length - close);
      const re = /\\[a-zA-Z]+|\\./g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        const from = seg.start + open + m.index;
        ranges.push({ from, to: from + m[0].length, deco: cmdMark });
      }
      if (close) ranges.push({ from: seg.end - close, to: seg.end, deco: delimMark });
    } else {
      const re = /\\(begin|end)\{[a-zA-Z*]+\}|\\(textbf|emph|textit|item|section\*?|subsection\*?|ref|eqref|cite|label)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.raw))) {
        ranges.push({ from: seg.start + m.index, to: seg.start + m.index + m[0].length, deco: envMark });
      }
    }
  }
  // RangeSetBuilder needs sorted input; nested marks are fine as long as starts ascend.
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const r of ranges) if (r.to > r.from) builder.add(r.from, r.to, r.deco);
  return builder.finish();
}

const mathHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = buildMathDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "650", color: "var(--text)" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--text-3)" },
  { tag: tags.monospace, color: "var(--text-2)" },
  { tag: tags.quote, color: "var(--text-2)", fontStyle: "italic" },
  { tag: tags.processingInstruction, color: "var(--text-3)" },
  { tag: tags.list, color: "var(--text-2)" },
]);

// ------------------------------------------------------ formatting keys

function wrap(view: EditorView, before: string, after: string, placeholder = ""): boolean {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to) || placeholder;
    const insert = before + text + after;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
  return true;
}

export function insertSnippet(view: EditorView, text: string): void {
  const cursor = text.indexOf("¦");
  const clean = text.replace("¦", "");
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: clean },
    selection: { anchor: from + (cursor >= 0 ? cursor : clean.length) },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

const formattingKeymap = keymap.of([
  { key: "Mod-b", run: (v) => wrap(v, "**", "**") },
  { key: "Mod-i", run: (v) => wrap(v, "*", "*") },
  { key: "Mod-m", run: (v) => wrap(v, "\\(", "\\)") },
  { key: "Mod-Shift-m", run: (v) => wrap(v, "\\[\n", "\n\\]") },
  { key: "Mod-Shift-e", run: (v) => wrap(v, "\\begin{align*}\n", "\n\\end{align*}") },
]);

/**
 * Browsers (WebView2 in particular) sometimes put U+00A0 into contenteditable text when a
 * space is typed at the end of a line. The editor's DOM is left alone (rewriting it fights
 * the browser), but every value leaving the editor uses ordinary spaces.
 */
const plainSpaces = (v: string) => (v.includes("\u00a0") ? v.replace(/\u00a0/g, " ") : v);

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "var(--editor-font-size)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { padding: "12px 0 40px", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 14px" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--bg-selected) !important" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--bg-hover) 60%, transparent)" },
  ".cm-placeholder": { color: "var(--text-3)", fontStyle: "italic" },
  ".cm-tooltip": { backgroundColor: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: "7px", boxShadow: "var(--shadow-2)" },
  ".cm-tooltip-autocomplete > ul > li": { fontFamily: "var(--font-mono)", fontSize: "12px", padding: "2px 8px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--bg-active)", color: "var(--text)" },
  ".cm-completionDetail": { color: "var(--text-3)", fontStyle: "normal", marginLeft: "10px", fontFamily: "var(--font-ui)" },
  ".cm-panels": { backgroundColor: "var(--bg-panel)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-searchMatch": { backgroundColor: "var(--warning-soft)" },
  ".cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "none" },
});

// --------------------------------------------------------- component

export type EditorMode = "split" | "source" | "preview";

export const SNIPPET_MENU: [string, string][] = [
  ["Inline math  \\( \\)", "\\(¦\\)"],
  ["Display math  \\[ \\]", "\\[\n¦\n\\]"],
  ["Fraction", "\\frac{¦}{}"],
  ["Limit", "\\lim_{n\\to\\infty} ¦"],
  ["Sum", "\\sum_{k=1}^{n} ¦"],
  ["Aligned equations", "\\begin{align*}\n¦ &= \\\\\n&= \n\\end{align*}"],
  ["Cases", "\\begin{cases}\n¦ & \\text{if } \\\\\n & \\text{otherwise}\n\\end{cases}"],
  ["Matrix", "\\begin{pmatrix}\n¦ & \\\\\n & \n\\end{pmatrix}"],
  ["Proof", "\\begin{proof}\n¦\n\\end{proof}"],
  ["Claim", "\\begin{claim}\n¦\n\\end{claim}"],
  ["ε–N template", "Let \\(\\varepsilon > 0\\). Choose \\(N \\in \\mathbb{N}\\) such that ¦. Then for all \\(n \\ge N\\),\n\\[\n|a_n - L| < \\varepsilon.\n\\]"],
];

export function MathEditor({
  value,
  onChange,
  placeholder,
  mode: modeProp,
  onModeChange,
  minHeight = 180,
  attachments,
  autoFocus,
  toolbarExtra,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mode?: EditorMode;
  onModeChange?: (m: EditorMode) => void;
  minHeight?: number;
  attachments?: Attachment[];
  autoFocus?: boolean;
  toolbarExtra?: React.ReactNode;
  label?: string;
}) {
  const defaultMode = useStore((s) => s.settings.editorMode);
  const spellcheck = useStore((s) => s.settings.spellcheck);
  const [localMode, setLocalMode] = useState<EditorMode>(modeProp ?? defaultMode);
  const mode = modeProp ?? localMode;
  const setMode = (m: EditorMode) => (onModeChange ? onModeChange(m) : setLocalMode(m));
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [preview, setPreview] = useState(value);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const extensions = useMemo<Extension[]>(
    () => [
      history(),
      drawSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      autocompletion({ override: [latexCompletions], icons: false, activateOnTyping: true }),
      markdown(),
      syntaxHighlighting(markdownHighlight),
      mathHighlighter,
      EditorView.lineWrapping,
      formattingKeymap,
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
      cmPlaceholder(placeholder ?? ""),
      editorTheme,
      EditorView.contentAttributes.of({ spellcheck: spellcheck ? "true" : "false", "aria-label": label ?? "LaTeX source" }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const v = plainSpaces(u.state.doc.toString());
          onChangeRef.current(v);
          if (previewTimer.current) clearTimeout(previewTimer.current);
          previewTimer.current = setTimeout(() => setPreview(v), 110);
        }
        if (u.focusChanged && u.view.hasFocus) setActiveEditor(u.view);
      }),
      EditorView.domEventHandlers({
        scroll: (_e, view) => {
          const p = previewRef.current;
          const s = view.scrollDOM;
          if (p && s.scrollHeight > s.clientHeight) {
            p.scrollTop = (s.scrollTop / (s.scrollHeight - s.clientHeight)) * (p.scrollHeight - p.clientHeight);
          }
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spellcheck],
  );

  // Create / destroy the editor when the source pane is shown.
  useEffect(() => {
    if (mode === "preview" || !host.current) return;
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      setActiveEditor(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, extensions]);

  // External changes (e.g. restoring an attempt) replace the document.
  useEffect(() => {
    const view = viewRef.current;
    if (view && plainSpaces(view.state.doc.toString()) !== value && !view.hasFocus) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
    if (!view || !view.hasFocus) setPreview(value);
  }, [value]);

  const errors = useMemo(() => checkLatex(preview), [preview]);

  const insertMenu = (el: HTMLElement) => {
    const items: MenuItem[] = SNIPPET_MENU.map(([label, snip]) => ({
      label: t(label),
      onSelect: () => {
        if (mode === "preview") setMode("split");
        setTimeout(() => viewRef.current && insertSnippet(viewRef.current, snip), 0);
      },
    }));
    openMenuBelow(el, items);
  };

  return (
    <div className={`mx-editor mode-${mode}`} style={{ minHeight }}>
      <div className="mx-toolbar">
        <div className="seg seg-sm" role="tablist" aria-label={t("Editor layout")}>
          <button className={mode === "source" ? "on" : ""} onClick={() => setMode("source")} title={t("Source only")}>
            <Code2 size={13} />
          </button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")} title={t("Source and preview")}>
            <Columns2 size={13} />
          </button>
          <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")} title={t("Preview only")}>
            <Eye size={13} />
          </button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={(e) => insertMenu(e.currentTarget)} title={t("Insert mathematics")}>
          <Sigma size={13} /> {t("Insert")}
        </button>
        {errors.length > 0 && (
          <span className="mx-errors" title={errors.map((e) => `${e.tex}\n→ ${e.message}`).join("\n\n")}>
            {errors.length === 1 ? t("1 formula has an error") : t("{n} formulas have errors", { n: errors.length })}
          </span>
        )}
        <span className="grow" />
        {toolbarExtra}
      </div>
      <div className="mx-panes">
        {mode !== "preview" && <div className="mx-source" ref={host} />}
        {mode !== "source" && (
          <div className="mx-preview" ref={previewRef}>
            <MathView
              source={preview}
              attachments={attachments}
              empty={t("Nothing written yet.")}
              onDoubleClick={mode === "preview" ? () => setMode("split") : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
