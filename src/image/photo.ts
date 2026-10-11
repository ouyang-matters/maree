// Canvas helpers for photos: decode, rotate, crop and stack. Browser-only.

import { encodeBmp, regionPixels } from "../domain/photos";

export type Quarter = 0 | 1 | 2 | 3;

export async function decodeImage(bytes: Uint8Array, mime = "image/jpeg"): Promise<ImageBitmap> {
  // EXIF orientation is applied, so photos taken in portrait stay upright.
  return createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { imageOrientation: "from-image" });
}

/** The image turned clockwise by `q` quarter turns. */
export function rotated(src: CanvasImageSource & { width: number; height: number }, q: Quarter): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const swap = q % 2 === 1;
  c.width = swap ? src.height : src.width;
  c.height = swap ? src.width : src.height;
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((q * Math.PI) / 2);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode the image."))), type, quality));
}

export async function toBytes(c: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): Promise<Uint8Array> {
  return new Uint8Array(await (await toBlob(c, type, quality)).arrayBuffer());
}

/** Cuts a region (fractions of the image) out of a canvas. */
export function crop(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const px = regionPixels(r, src.width, src.height);
  const c = document.createElement("canvas");
  c.width = px.w;
  c.height = px.h;
  c.getContext("2d")!.drawImage(src, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
  return c;
}

/** Scales a canvas down so its longer side is at most `max` pixels. */
export function fit(src: HTMLCanvasElement | ImageBitmap, max: number): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Stacks images vertically on white with a little space between them. */
export function stack(images: (HTMLCanvasElement | ImageBitmap)[], width: number, gap = 24): HTMLCanvasElement {
  const scaled = images.map((im) => fit(im, Math.max(im.width, im.height) * Math.min(1, width / im.width)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, ...scaled.map((s) => s.width));
  c.height = Math.max(1, scaled.reduce((h, s) => h + s.height, 0) + gap * Math.max(0, scaled.length - 1));
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const s of scaled) {
    g.drawImage(s, 0, y);
    y += s.height + gap;
  }
  return c;
}

export function canvasBmp(c: HTMLCanvasElement): Uint8Array {
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  return encodeBmp(data, c.width, c.height);
}
