import { describe, expect, it } from "vitest";
import { crc32, isPng, pngChunks, readZTxt, withChunk, zTxtData } from "../src/domain/png";
import { exportBox, inkBounds, inkFileName, isInkFile, parseInk, segmentWidth, serializeInk, strokeHit, type Ink } from "../src/domain/ink";

// A 1×1 PNG.
const tiny = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("PNG chunks", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("inserts a zTXt chunk after IHDR and reads it back, keeping the image valid", async () => {
    const zlib = new Uint8Array(await new Response(new Blob(["hello ink"]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const png = withChunk(tiny, "zTXt", zTxtData("maree-ink", zlib));
    expect(isPng(png)).toBe(true);
    expect(pngChunks(png).map((c) => c.type)).toEqual(["IHDR", "zTXt", "IDAT", "IEND"]);
    // Every chunk's CRC is valid.
    for (const c of pngChunks(png)) {
      const v = new DataView(png.buffer, png.byteOffset);
      const stored = v.getUint32(c.offset + 8 + c.data.length);
      expect(stored).toBe(crc32(png.subarray(c.offset + 4, c.offset + 8 + c.data.length)));
    }
    const back = readZTxt(png, "maree-ink")!;
    const text = await new Response(new Blob([back as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).text();
    expect(text).toBe("hello ink");
    expect(readZTxt(png, "other")).toBeNull();
    expect(readZTxt(tiny, "maree-ink")).toBeNull();
  });
});

describe("handwriting model", () => {
  const ink: Ink = {
    v: 1,
    height: 1200,
    strokes: [
      { color: "#1d1a1c", size: 3, points: [100, 100, 0.5, 200, 120.04, 0.512, 300, 100, 0.5] },
      { color: "#b03a6c", size: 3, points: [500, 400, 1] },
    ],
  };

  it("measures what was written and pads it for export", () => {
    const b = inkBounds(ink.strokes)!;
    const r = segmentWidth(3, 1) / 2;
    expect(b.x).toBeCloseTo(100 - r);
    expect(b.y + b.h).toBeCloseTo(400 + r);
    const e = exportBox(ink.strokes, 28)!;
    expect(e.x).toBeCloseTo(100 - r - 28);
    expect(exportBox([])).toBeNull();
  });

  it("erases whole strokes the eraser touches", () => {
    expect(strokeHit(ink.strokes[0], 150, 112, 4)).toBe(true);
    expect(strokeHit(ink.strokes[0], 150, 160, 4)).toBe(false);
    expect(strokeHit(ink.strokes[1], 503, 402, 4)).toBe(true);
  });

  it("round-trips through compact JSON and rejects malformed data", () => {
    const back = parseInk(serializeInk(ink))!;
    expect(back.strokes).toHaveLength(2);
    expect(back.strokes[0].points[4]).toBe(120);
    expect(back.strokes[0].points[5]).toBe(0.51);
    expect(parseInk("{}")).toBeNull();
    expect(parseInk("not json")).toBeNull();
    expect(parseInk(JSON.stringify({ v: 1, height: 10, strokes: [{ color: "red", size: 1, points: [1, 2, 3] }] }))!.strokes).toEqual([]);
  });

  it("names handwriting files uniquely", () => {
    const d = new Date(2026, 9, 11, 14, 32);
    expect(inkFileName(d, new Set())).toBe("handwriting-2026-10-11-1432.png");
    expect(inkFileName(d, new Set(["handwriting-2026-10-11-1432.png"]))).toBe("handwriting-2026-10-11-1432-2.png");
    expect(isInkFile("handwriting-2026-10-11-1432-2.png")).toBe(true);
    expect(isInkFile("photo-2026.jpg")).toBe(false);
  });
});
