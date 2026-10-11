// Edit-menu commands route to the focused CodeMirror editor or to native inputs.

import type { EditorView } from "@codemirror/view";
import { redo, selectAll, undo } from "@codemirror/commands";

let activeView: EditorView | null = null;

export function setActiveEditor(view: EditorView | null): void {
  activeView = view;
}

function focusedView(): EditorView | null {
  return activeView && activeView.hasFocus ? activeView : activeView && document.activeElement === document.body ? activeView : null;
}

export function editUndo(): void {
  const v = focusedView();
  if (v) undo(v);
  else document.execCommand("undo");
}

export function editRedo(): void {
  const v = focusedView();
  if (v) redo(v);
  else document.execCommand("redo");
}

export function editCut(): void {
  document.execCommand("cut");
}

export function editCopy(): void {
  document.execCommand("copy");
}

export async function editPaste(): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => "");
  if (!text) return;
  const v = focusedView();
  if (v) {
    v.dispatch(v.state.replaceSelection(text));
    v.focus();
    return;
  }
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (el && "setRangeText" in el) {
    el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function editSelectAll(): void {
  const v = focusedView();
  if (v) selectAll(v);
  else document.execCommand("selectAll");
}
