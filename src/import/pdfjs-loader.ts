// Lazily loads pdf.js in the browser/WebView with its worker and static assets.

import type { PdfjsLike } from "./extract-pdf";

type PdfjsModule = typeof import("pdfjs-dist");

let modulePromise: Promise<PdfjsModule> | null = null;

export function loadPdfjsModule(): Promise<PdfjsModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return modulePromise;
}

/** Options shared by every getDocument call (fonts, CMaps and WASM decoders are served locally). */
export const PDF_ASSET_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  isEvalSupported: false,
};

export async function loadPdfjs(): Promise<PdfjsLike> {
  const pdfjs = await loadPdfjsModule();
  return {
    getDocument: (src) => pdfjs.getDocument({ ...PDF_ASSET_OPTIONS, ...src }),
  } as PdfjsLike;
}
