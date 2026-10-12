// Drawing handwriting on a canvas and saving it as a PNG that still carries its strokes.

import { exportBox, INK_KEYWORD, parseInk, segmentWidth, serializeInk, type Ink, type Stroke } from "../domain/ink";
import { readZTxt, withChunk, zTxtData } from "../domain/png";
import { toBytes } from "./photo";

/** Draws the part of a stroke from point index `from` (0 = the whole stroke). */
export function drawStroke(g: CanvasRenderingContext2D, s: Stroke, scale: number, from = 0): void {
  const p = s.points;
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineCap = "round";
  g.lineJoin = "round";
  if (p.length === 3) {
    g.beginPath();
    g.arc(p[0] * scale, p[1] * scale, (segmentWidth(s.size, p[2]) * scale) / 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  for (let i = Math.max(3, from * 3); i < p.length; i += 3) {
    g.lineWidth = segmentWidth(s.size, (p[i - 1] + p[i + 2]) / 2) * scale;
    g.beginPath();
    g.moveTo(p[i - 3] * scale, p[i - 2] * scale);
    g.lineTo(p[i] * scale, p[i + 1] * scale);
    g.stroke();
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The written area on white at twice the page resolution, with the strokes embedded. */
export async function exportInkPng(ink: Ink, scale = 2): Promise<Uint8Array> {
  const box = exportBox(ink.strokes);
  if (!box) throw new Error("Nothing written yet.");
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(box.w * scale));
  c.height = Math.max(1, Math.ceil(box.h * scale));
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.translate(-box.x * scale, -box.y * scale);
  for (const s of ink.strokes) drawStroke(g, s, scale);
  const png = await toBytes(c, "image/png");
  const zlib = await pipe(new TextEncoder().encode(serializeInk(ink)), new CompressionStream("deflate"));
  return withChunk(png, "zTXt", zTxtData(INK_KEYWORD, zlib));
}

/** The strokes saved in a handwriting PNG, or null for other images. */
export async function readInkFromPng(png: Uint8Array): Promise<Ink | null> {
  const z = readZTxt(png, INK_KEYWORD);
  if (!z) return null;
  try {
    return parseInk(new TextDecoder().decode(await pipe(z, new DecompressionStream("deflate"))));
  } catch {
    return null;
  }
}
