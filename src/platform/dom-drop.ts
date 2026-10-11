// HTML5 file drops (used on both platforms). Tauri's native drop handler is disabled
// because on Windows it prevents in-app drag-and-drop (problems → lectures/topics).

import type { PickedFile } from "./types";

export function fileFromDom(f: File): PickedFile {
  return { name: f.name, path: null, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) };
}

export function html5FileDrop(onDrop: (files: PickedFile[]) => void, onHover: (over: boolean) => void): () => void {
  let depth = 0;
  const isFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
  const enter = (e: DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth++;
    onHover(true);
  };
  const over = (e: DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const leave = (e: DragEvent) => {
    if (!isFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) onHover(false);
  };
  const drop = (e: DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    onHover(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    // Files dropped onto a problem's attachment area are handled there.
    if ((e.target as HTMLElement | null)?.closest("[data-attach-drop]")) return;
    if (files.length) onDrop(files.map(fileFromDom));
  };
  window.addEventListener("dragenter", enter);
  window.addEventListener("dragover", over);
  window.addEventListener("dragleave", leave);
  window.addEventListener("drop", drop);
  return () => {
    window.removeEventListener("dragenter", enter);
    window.removeEventListener("dragover", over);
    window.removeEventListener("dragleave", leave);
    window.removeEventListener("drop", drop);
  };
}
