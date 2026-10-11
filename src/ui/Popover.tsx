import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A floating panel anchored below an element; closes on outside click or Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  width = 280,
  align = "start",
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 300;
    let left = align === "end" ? r.right - width : r.left;
    left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 4);
    setPos({ left, top });
  }, [anchor, width, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest(".menu")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="menu popover"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, maxWidth: width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
