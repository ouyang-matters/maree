// Pure helpers for the photo inbox and "Copy for ChatGPT": crop regions, attachment
// references in Markdown and a small BMP encoder. No DOM access, so they are unit-tested.

export type RegionKind = "question" | "answer";

/** A rectangle on a photo, in fractions of the (rotated) image size. */
export interface Region {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RegionKind;
  /** For answers: a problem id, `region:<id>` (a problem created from this photo), or null. */
  target: string | null;
  title: string;
}

export interface Point {
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The rectangle spanned by two points, clamped to the image. */
export function rectFrom(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Moves a rectangle by (dx, dy) without leaving the image. */
export function moveRect<R extends { x: number; y: number; w: number; h: number }>(r: R, dx: number, dy: number): R {
  return { ...r, x: Math.min(1 - r.w, Math.max(0, r.x + dx)), y: Math.min(1 - r.h, Math.max(0, r.y + dy)) };
}

/** The same area after the image is turned a quarter clockwise (or anticlockwise). */
export function rotateRect<R extends { x: number; y: number; w: number; h: number }>(r: R, clockwise: boolean): R {
  return clockwise ? { ...r, x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w } : { ...r, x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
}

/** Big enough to be a deliberate selection rather than a stray click. */
export function isUsableRect(r: { w: number; h: number }): boolean {
  return r.w >= 0.03 && r.h >= 0.02;
}

/** Pixel rectangle for a region on an image of the given size. */
export function regionPixels(r: { x: number; y: number; w: number; h: number }, width: number, height: number) {
  const x = Math.round(r.x * width);
  const y = Math.round(r.y * height);
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(r.w * width))), h: Math.max(1, Math.min(height - y, Math.round(r.h * height))) };
}

/** Regions in reading order: top to bottom, then left to right for regions side by side. */
export function readingOrder<R extends { x: number; y: number; h: number }>(regions: R[]): R[] {
  return [...regions].sort((a, b) => {
    const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (overlap > 0.5 * Math.min(a.h, b.h)) return a.x - b.x;
    return a.y - b.y;
  });
}

const IMAGE_RE = /!\[[^\]]*\]\(attachment:([^)\s]+)\)/g;

/** File names of attachments shown as images in a Markdown text, in order. */
export function attachmentImages(md: string): string[] {
  return [...md.matchAll(IMAGE_RE)].map((m) => decodeURIComponent(m[1]));
}

/** The text with attachment images removed (what is left to be rendered). */
export function withoutAttachmentImages(md: string): string {
  return md.replace(IMAGE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function imageMarkdown(fileName: string, alt: string): string {
  return `![${alt}](attachment:${encodeURIComponent(fileName)})`;
}

/** Appends a block to a Markdown text, separated by a blank line. */
export function appendBlock(text: string, block: string): string {
  return text.trim() ? `${text.replace(/\s+$/, "")}\n\n${block}` : block;
}

/** `photo-2026-10-11-1432-2.jpg` */
export function photoFileName(d: Date, n: number, ext = "jpg"): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `photo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${n}.${ext}`;
}

/** 24-bit bottom-up BMP from RGBA pixels (for programs that only paste bitmaps). */
export function encodeBmp(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const out = new Uint8Array(54 + imageSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, imageSize, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      // Composite onto white so transparent areas do not turn black.
      const a = rgba[i + 3] / 255;
      out[dst++] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
      out[dst++] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
      out[dst++] = Math.round(rgba[i] * a + 255 * (1 - a));
    }
  }
  return out;
}
