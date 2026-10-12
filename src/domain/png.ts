// Minimal PNG chunk handling: handwritten answers keep their strokes in a zTXt chunk, so a
// drawing can be reopened and edited while the image itself stays an ordinary PNG.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let table: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
  type: string;
  data: Uint8Array;
  /** Offset of the chunk's length field. */
  offset: number;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function pngChunks(png: Uint8Array): PngChunk[] {
  if (!isPng(png)) throw new Error("Not a PNG file");
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: PngChunk[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    if (at + 12 + len > png.length) break;
    out.push({ type, data: png.subarray(at + 8, at + 8 + len), offset: at });
    at += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Inserts a chunk right after IHDR. */
export function withChunk(png: Uint8Array, type: string, data: Uint8Array): Uint8Array {
  const ihdr = pngChunks(png)[0];
  if (!ihdr || ihdr.type !== "IHDR") throw new Error("PNG without IHDR");
  const cut = ihdr.offset + 12 + ihdr.data.length;
  const c = chunk(type, data);
  const out = new Uint8Array(png.length + c.length);
  out.set(png.subarray(0, cut), 0);
  out.set(c, cut);
  out.set(png.subarray(cut), cut + c.length);
  return out;
}

/** zTXt payload: keyword, NUL, compression method 0, zlib data. */
export function zTxtData(keyword: string, zlib: Uint8Array): Uint8Array {
  const out = new Uint8Array(keyword.length + 2 + zlib.length);
  for (let i = 0; i < keyword.length; i++) out[i] = keyword.charCodeAt(i) & 0xff;
  out[keyword.length] = 0;
  out[keyword.length + 1] = 0;
  out.set(zlib, keyword.length + 2);
  return out;
}

/** The zlib data of the zTXt chunk with this keyword, if any. */
export function readZTxt(png: Uint8Array, keyword: string): Uint8Array | null {
  if (!isPng(png)) return null;
  for (const c of pngChunks(png)) {
    if (c.type !== "zTXt") continue;
    const nul = c.data.indexOf(0);
    if (nul < 0) continue;
    const key = String.fromCharCode(...c.data.subarray(0, nul));
    if (key === keyword && c.data[nul + 1] === 0) return c.data.subarray(nul + 2);
  }
  return null;
}
