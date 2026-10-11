import { useRef, useState } from "react";

/** A drag handle that reports pixel deltas along one axis. */
export function Resizer({
  onResize,
  onEnd,
  vertical,
  onDoubleClick,
}: {
  onResize: (delta: number) => void;
  onEnd?: () => void;
  vertical?: boolean;
  onDoubleClick?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);
  return (
    <div
      className={`resizer${vertical ? " vertical" : ""}${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = vertical ? e.clientY : e.clientX;
        setDragging(true);
        document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const pos = vertical ? e.clientY : e.clientX;
        const d = pos - last.current;
        if (d) {
          last.current = pos;
          onResize(d);
        }
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        setDragging(false);
        document.body.style.cursor = "";
        onEnd?.();
      }}
    />
  );
}
