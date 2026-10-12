import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, PenLine, Redo2, Rows3, Trash2, Undo2 } from "lucide-react";
import * as A from "../state/actions";
import { toast } from "../state/store";
import { loadInk, saveHandwriting } from "../state/handwriting";
import { INK_COLORS, INK_SIZES, PAGE_WIDTH, inkBounds, strokeHit, type Ink, type InkTool, type Stroke } from "../domain/ink";
import { drawStroke } from "../image/ink";
import { t } from "../i18n";

type Action = { kind: "add"; stroke: Stroke } | { kind: "erase"; removed: { index: number; stroke: Stroke }[] } | { kind: "clear"; strokes: Stroke[] };
type SizeName = keyof typeof INK_SIZES;

const LINE_GAP = 44;
const ERASER_RADIUS = 10;

function readPref<T extends string>(key: string, fallback: T, allowed: readonly string[]): T {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export function HandwritingPad({ problemId, partId, edit }: { problemId: string; partId: string | null; edit?: { attachmentId: string; fileName: string } }) {
  const [tool, setTool] = useState<InkTool>("pen");
  const [color, setColor] = useState<string>(() => readPref("maree-ink-color", INK_COLORS[0], INK_COLORS));
  const [size, setSize] = useState<SizeName>(() => readPref<SizeName>("maree-ink-size", "medium", Object.keys(INK_SIZES)));
  const [lines, setLines] = useState(() => readPref("maree-ink-lines", "on", ["on", "off"]) === "on");
  const [loading, setLoading] = useState(!!edit);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const ink = useRef<Ink>({ v: 1, height: 0, strokes: [] });
  const undo = useRef<Action[]>([]);
  const redo = useRef<Action[]>([]);
  const current = useRef<Stroke | null>(null);
  const erasing = useRef<{ index: number; stroke: Stroke }[] | null>(null);
  const penSeen = useRef(false);
  const scale = useRef(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const g = ctx();
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    if (lines) {
      g.strokeStyle = "#e7e2dd";
      g.lineWidth = 1;
      for (let y = LINE_GAP * 2; y < ink.current.height; y += LINE_GAP) {
        g.beginPath();
        g.moveTo(0, Math.round(y * scale.current) + 0.5);
        g.lineTo(c.width, Math.round(y * scale.current) + 0.5);
        g.stroke();
      }
    }
    for (const s of ink.current.strokes) drawStroke(g, s, scale.current);
  }, [lines]);

  /** Fits the page to the window width; the page is at least as tall as the window. */
  const layout = useCallback(() => {
    const c = canvasRef.current;
    const w = wrapRef.current;
    if (!c || !w) return;
    const cssW = w.clientWidth;
    scale.current = cssW / PAGE_WIDTH;
    const written = inkBounds(ink.current.strokes);
    ink.current.height = Math.max(ink.current.height, w.clientHeight / scale.current, written ? written.y + written.h + 200 : 0);
    const cssH = Math.ceil(ink.current.height * scale.current);
    const dpr = window.devicePixelRatio || 1;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    redraw();
  }, [redraw]);

  useEffect(() => {
    dialogRef.current?.focus();
    if (!edit) return;
    void loadInk(problemId, edit.fileName).then((k) => {
      if (k) ink.current = { ...k, strokes: [...k.strokes] };
      else toast(t("This image has no editable strokes; you can write over a blank page instead."), "info");
      setLoading(false);
      layout();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    layout();
    const ro = new ResizeObserver(() => layout());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [layout]);

  const point = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / scale.current,
      y: (e.clientY - r.top) / scale.current,
      // Only pens report real pressure; mice and fingers draw at an even width.
      p: e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 0.5,
    };
  };

  const eraseAt = (x: number, y: number) => {
    const strokes = ink.current.strokes;
    let changed = false;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokeHit(strokes[i], x, y, ERASER_RADIUS)) {
        erasing.current?.push({ index: i, stroke: strokes[i] });
        strokes.splice(i, 1);
        changed = true;
      }
    }
    if (changed) redraw();
  };

  const grow = (y: number) => {
    if (y > ink.current.height - 160) {
      ink.current.height += 600;
      layout();
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (loading || saving) return;
    if (e.pointerType === "pen") penSeen.current = true;
    // With a pen in use, a resting palm must not draw.
    if (penSeen.current && e.pointerType === "touch") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setConfirmClose(false);
    const pt = point(e);
    // The eraser end of a pen reports button 5.
    if (tool === "eraser" || e.button === 5) {
      erasing.current = [];
      eraseAt(pt.x, pt.y);
      return;
    }
    const s: Stroke = { color, size: INK_SIZES[size], points: [pt.x, pt.y, pt.p] };
    current.current = s;
    ink.current.strokes.push(s);
    const g = ctx();
    if (g) drawStroke(g, s, scale.current);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!current.current && !erasing.current) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
    for (const ev of events.length ? events : [native]) {
      const pt = point(ev);
      if (erasing.current) {
        eraseAt(pt.x, pt.y);
        continue;
      }
      const s = current.current!;
      const n = s.points.length;
      if (Math.hypot(pt.x - s.points[n - 3], pt.y - s.points[n - 2]) < 0.4) continue;
      s.points.push(pt.x, pt.y, pt.p);
      const g = ctx();
      if (g) drawStroke(g, s, scale.current, s.points.length / 3 - 1);
      grow(pt.y);
    }
  };

  const onPointerUp = () => {
    if (current.current) {
      undo.current.push({ kind: "add", stroke: current.current });
      redo.current = [];
      current.current = null;
      rerender();
    }
    if (erasing.current) {
      if (erasing.current.length) {
        undo.current.push({ kind: "erase", removed: erasing.current });
        redo.current = [];
      }
      erasing.current = null;
      rerender();
    }
  };

  const apply = (a: Action, forward: boolean) => {
    const strokes = ink.current.strokes;
    if (a.kind === "add") {
      if (forward) strokes.push(a.stroke);
      else strokes.splice(strokes.lastIndexOf(a.stroke), 1);
    } else if (a.kind === "erase") {
      // Removed in descending index order while erasing; undo restores ascending.
      if (forward) for (const r of a.removed) strokes.splice(strokes.indexOf(r.stroke), 1);
      else for (const r of [...a.removed].sort((x, y) => x.index - y.index)) strokes.splice(r.index, 0, r.stroke);
    } else if (forward) {
      strokes.length = 0;
    } else {
      strokes.push(...a.strokes);
    }
    redraw();
    rerender();
  };
  const doUndo = () => {
    const a = undo.current.pop();
    if (a) {
      apply(a, false);
      redo.current.push(a);
    }
  };
  const doRedo = () => {
    const a = redo.current.pop();
    if (a) {
      apply(a, true);
      undo.current.push(a);
    }
  };
  const clear = () => {
    if (!ink.current.strokes.length) return;
    const a: Action = { kind: "clear", strokes: [...ink.current.strokes] };
    undo.current.push(a);
    redo.current = [];
    apply(a, true);
  };

  const dirty = undo.current.length > 0;
  const empty = ink.current.strokes.length === 0;
  const close = () => {
    if (dirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    A.closeDialog();
  };
  const save = async () => {
    if (empty || saving) return;
    setSaving(true);
    try {
      await saveHandwriting(problemId, partId, { v: 1, height: ink.current.height, strokes: ink.current.strokes }, edit);
      A.closeDialog();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setSaving(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      doRedo();
    } else if (!mod && e.key.toLowerCase() === "p") setTool("pen");
    else if (!mod && e.key.toLowerCase() === "e") setTool("eraser");
  };

  return (
    <div
      className="overlay ink-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={dialogRef} className="ink-dialog" role="dialog" aria-modal="true" aria-label={t("Handwriting")} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="ink-toolbar">
          <span className="ink-title">{edit ? t("Edit handwriting") : t("Handwrite answer")}</span>
          <div className="seg seg-sm" role="radiogroup" aria-label={t("Tool")}>
            <button role="radio" aria-checked={tool === "pen"} className={tool === "pen" ? "on" : ""} title={t("Pen (P)")} onClick={() => setTool("pen")}>
              <PenLine size={14} />
            </button>
            <button role="radio" aria-checked={tool === "eraser"} className={tool === "eraser" ? "on" : ""} title={t("Eraser (E)")} onClick={() => setTool("eraser")}>
              <Eraser size={14} />
            </button>
          </div>
          <div className="ink-swatches" role="radiogroup" aria-label={t("Ink colour")}>
            {INK_COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={`ink-swatch${color === c ? " on" : ""}`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setTool("pen");
                  writePref("maree-ink-color", c);
                }}
              />
            ))}
          </div>
          <div className="ink-sizes" role="radiogroup" aria-label={t("Pen width")}>
            {(Object.keys(INK_SIZES) as SizeName[]).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={size === k}
                title={{ fine: t("Fine"), medium: t("Medium"), bold: t("Bold") }[k]}
                className={`ink-size${size === k ? " on" : ""}`}
                onClick={() => {
                  setSize(k);
                  setTool("pen");
                  writePref("maree-ink-size", k);
                }}
              >
                <span style={{ width: INK_SIZES[k] * 1.6, height: INK_SIZES[k] * 1.6 }} />
              </button>
            ))}
          </div>
          <span className="ink-sep" />
          <button className="icon-btn" title={t("Undo (Ctrl+Z)")} disabled={!undo.current.length} onClick={doUndo}>
            <Undo2 size={15} />
          </button>
          <button className="icon-btn" title={t("Redo (Ctrl+Y)")} disabled={!redo.current.length} onClick={doRedo}>
            <Redo2 size={15} />
          </button>
          <button className="icon-btn" title={t("Clear page")} disabled={empty} onClick={clear}>
            <Trash2 size={15} />
          </button>
          <button
            className={`icon-btn${lines ? " on" : ""}`}
            title={t("Ruled lines (not saved in the image)")}
            aria-pressed={lines}
            onClick={() => {
              setLines(!lines);
              writePref("maree-ink-lines", lines ? "off" : "on");
            }}
          >
            <Rows3 size={15} />
          </button>
          <span className="grow" />
          <button className="btn btn-ghost" onClick={close}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" disabled={empty || saving || loading} onClick={() => void save()} title="Ctrl+Enter">
            {saving ? t("Saving…") : edit ? t("Save Changes") : t("Add to My Solution")}
          </button>
        </div>
        {confirmClose && (
          <div className="ink-confirm">
            {t("Discard this handwriting?")}
            <button className="btn btn-sm" onClick={() => A.closeDialog()}>
              {t("Discard")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmClose(false)}>
              {t("Keep Writing")}
            </button>
          </div>
        )}
        <div className="ink-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className={`ink-canvas${tool === "eraser" ? " erasing" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          />
          {loading && <div className="ink-loading faint">{t("Loading…")}</div>}
        </div>
        <div className="ink-hint faint">
          {t("Write with a pen, a finger or the mouse. While a pen is in use, touches from your palm are ignored. The page grows as you write; only the written area is saved.")}
        </div>
      </div>
    </div>
  );
}
