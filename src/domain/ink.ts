// Handwriting: strokes on a page 1000 units wide (height grows as you write). Coordinates
// are independent of the window size, so a drawing reopens exactly as it was.

export const PAGE_WIDTH = 1000;
export const INK_KEYWORD = "maree-ink";

export type InkTool = "pen" | "eraser";

export interface Stroke {
  color: string;
  /** Nominal width in page units. */
  size: number;
  /** Flat list x, y, pressure (0–1), x, y, pressure, … */
  points: number[];
}

export interface Ink {
  v: 1;
  height: number;
  strokes: Stroke[];
}

export const INK_COLORS = ["#1d1a1c", "#1f4aa8", "#b03a6c"] as const;
export const INK_SIZES = { fine: 2.2, medium: 3.4, bold: 5.4 } as const;

/** Width of a segment for the pressure at its points; pens vary, mice and fingers do not. */
export function segmentWidth(size: number, pressure: number): number {
  return size * (0.45 + 0.9 * Math.min(1, Math.max(0, pressure)));
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of all strokes (including their thickness), or null when empty. */
export function inkBounds(strokes: Stroke[]): Box | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const s of strokes) {
    const r = segmentWidth(s.size, 1) / 2;
    for (let i = 0; i < s.points.length; i += 3) {
      x1 = Math.min(x1, s.points[i] - r);
      y1 = Math.min(y1, s.points[i + 1] - r);
      x2 = Math.max(x2, s.points[i] + r);
      y2 = Math.max(y2, s.points[i + 1] + r);
    }
  }
  return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The area to export: the strokes plus a margin, kept inside the page. */
export function exportBox(strokes: Stroke[], margin = 28): Box | null {
  const b = inkBounds(strokes);
  if (!b) return null;
  const x = Math.max(0, b.x - margin);
  const y = Math.max(0, b.y - margin);
  return { x, y, w: Math.min(PAGE_WIDTH, b.x + b.w + margin) - x, h: b.y + b.h + margin - y };
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the eraser at (x, y) with radius r touches the stroke. */
export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
  const p = s.points;
  const reach = r + segmentWidth(s.size, 1) / 2;
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 3; i < p.length; i += 3) {
    if (segmentDistance(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reach) return true;
  }
  return false;
}

/** Compact JSON: coordinates to 0.1 unit, pressure to 0.01. */
export function serializeInk(ink: Ink): string {
  return JSON.stringify({
    v: 1,
    height: Math.round(ink.height),
    strokes: ink.strokes.map((s) => ({
      color: s.color,
      size: s.size,
      points: s.points.map((n, i) => (i % 3 === 2 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10)),
    })),
  });
}

export function parseInk(text: string): Ink | null {
  try {
    const o = JSON.parse(text) as Partial<Ink>;
    if (o.v !== 1 || !Array.isArray(o.strokes)) return null;
    const strokes = o.strokes
      .filter((s) => s && typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) && typeof s.size === "number" && Array.isArray(s.points))
      .map((s) => ({ color: s.color, size: s.size, points: s.points.filter((n) => typeof n === "number" && Number.isFinite(n)) }))
      .filter((s) => s.points.length >= 3 && s.points.length % 3 === 0);
    return { v: 1, height: typeof o.height === "number" && o.height > 0 ? o.height : 1000, strokes };
  } catch {
    return null;
  }
}

/** `handwriting-2026-10-11-1432.png`, or `…-2.png` when that name is taken. */
export function inkFileName(d: Date, taken: Set<string>): string {
  const p = (v: number) => String(v).padStart(2, "0");
  const base = `handwriting-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  let name = `${base}.png`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.png`;
  return name;
}

export function isInkFile(name: string): boolean {
  return /^handwriting-.*\.png$/i.test(name);
}
