import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, ExternalLink, Minus, MoveHorizontal, Plus } from "lucide-react";
import { loadPdfjsModule, PDF_ASSET_OPTIONS } from "../import/pdfjs-loader";
import { t } from "../i18n";

interface PageInfo {
  width: number;
  height: number;
}

function PdfPage({
  doc,
  n,
  scale,
  info,
  highlight,
}: {
  doc: PDFDocumentProxy;
  n: number;
  scale: number;
  info: PageInfo;
  highlight: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !ref.current) return;
    let cancelled = false;
    const host = ref.current;
    let task: { cancel(): void } | null = null;
    (async () => {
      const pdfjs = await loadPdfjsModule();
      const page = await doc.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext("2d")!;
      const render = page.render({ canvas, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = render;
      await render.promise;
      if (cancelled) return;
      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      host.replaceChildren(canvas, textDiv);
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await tl.render().catch(() => undefined);
    })().catch((e) => {
      if (!cancelled && String(e).indexOf("cancel") < 0) console.warn("page render failed", e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, n, scale]);

  return (
    <div
      className={`pdf-page${highlight ? " highlight" : ""}`}
      data-page={n}
      style={{ width: info.width * scale, height: info.height * scale, ["--scale-factor" as string]: scale, ["--user-unit" as string]: 1 }}
    >
      <div ref={ref} className="pdf-page-inner" />
      <span className="pdf-page-num">{n}</span>
    </div>
  );
}

export function PdfViewer({
  load,
  page,
  nonce,
  onOpenExternal,
  compact,
}: {
  load: () => Promise<Uint8Array>;
  page?: number;
  nonce?: number;
  onOpenExternal?: () => void;
  compact?: boolean;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number | "fit">("fit");
  const [current, setCurrent] = useState(page ?? 1);
  const [pageInput, setPageInput] = useState(String(page ?? 1));
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjsModule();
        const bytes = await load();
        const d = await pdfjs.getDocument({ ...PDF_ASSET_OPTIONS, data: bytes.slice() }).promise;
        loaded = d;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const pg = await d.getPage(i);
          const vp = pg.getViewport({ scale: 1 });
          infos.push({ width: vp.width, height: vp.height });
        }
        if (!alive) return void d.destroy();
        setPages(infos);
        setDoc(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      void loaded?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxW = pages.reduce((m, p) => Math.max(m, p.width), 1);
  const effScale = scale === "fit" ? Math.max(0.3, (width - 36) / maxW) : scale;

  const goTo = (n: number, smooth = true) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    if (doc && page) setTimeout(() => goTo(page, false), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, nonce]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    for (const p of Array.from(el.querySelectorAll<HTMLElement>("[data-page]"))) {
      if (p.offsetTop <= mid) n = Number(p.dataset.page);
    }
    if (n !== current) {
      setCurrent(n);
      setPageInput(String(n));
    }
  };

  const zoom = (f: number) => setScale((s) => Math.min(4, Math.max(0.3, (s === "fit" ? effScale : s) * f)));

  return (
    <div className={`pdfv${compact ? " compact" : ""}`}>
      <div className="pdfv-toolbar">
        <button className="icon-btn sm" onClick={() => goTo(Math.max(1, current - 1))} disabled={current <= 1} aria-label={t("Previous page")}>
          <ChevronLeft size={15} />
        </button>
        <input
          className="input pdfv-page"
          value={pageInput}
          aria-label={t("Page")}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = Math.min(pages.length, Math.max(1, parseInt(pageInput, 10) || 1));
              goTo(n);
            }
          }}
        />
        <span className="faint">/ {pages.length || "…"}</span>
        <button className="icon-btn sm" onClick={() => goTo(Math.min(pages.length, current + 1))} disabled={current >= pages.length} aria-label={t("Next page")}>
          <ChevronRight size={15} />
        </button>
        <span className="grow" />
        <button className="icon-btn sm" onClick={() => zoom(1 / 1.15)} aria-label={t("Zoom out")}>
          <Minus size={14} />
        </button>
        <span className="pdfv-zoom faint">{Math.round(effScale * 100)}%</span>
        <button className="icon-btn sm" onClick={() => zoom(1.15)} aria-label={t("Zoom in")}>
          <Plus size={14} />
        </button>
        <button className={`icon-btn sm${scale === "fit" ? " active" : ""}`} onClick={() => setScale("fit")} title={t("Fit width")}>
          <MoveHorizontal size={14} />
        </button>
        {onOpenExternal && (
          <button className="icon-btn sm" onClick={onOpenExternal} title={t("Open in default PDF viewer")}>
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      <div className="pdfv-scroll" ref={scroller} onScroll={onScroll}>
        {error && <div className="empty-state"><div className="title">{t("Could not open the PDF")}</div><p>{error}</p></div>}
        {!doc && !error && <div className="empty-state">{t("Loading PDF…")}</div>}
        {doc &&
          pages.map((info, i) => (
            <PdfPage key={`${i}-${effScale.toFixed(3)}`} doc={doc} n={i + 1} scale={effScale} info={info} highlight={page === i + 1} />
          ))}
      </div>
    </div>
  );
}
