import { memo, useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "../math/render";
import { platform } from "../platform";
import type { Attachment } from "../data/types";

const blobCache = new Map<string, string>();

async function attachmentUrl(storedPath: string, mime: string): Promise<string> {
  const hit = blobCache.get(storedPath);
  if (hit) return hit;
  const bytes = await platform().readStored(storedPath);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  blobCache.set(storedPath, url);
  return url;
}

/** Rendered LaTeX-flavoured Markdown. Resolves `attachment:` images and opens links externally. */
export const MathView = memo(function MathView({
  source,
  className = "",
  attachments,
  empty,
  onDoubleClick,
}: {
  source: string;
  className?: string;
  attachments?: Attachment[];
  empty?: string;
  onDoubleClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(source), [source]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const img of Array.from(el.querySelectorAll<HTMLImageElement>("img[data-attachment]"))) {
      const key = img.dataset.attachment ?? "";
      const att = attachments?.find((a) => a.id === key || a.fileName === key);
      if (!att) {
        img.alt = `${img.alt || key} (attachment not found)`;
        img.classList.add("missing");
        continue;
      }
      void attachmentUrl(att.storedPath, att.mime).then((u) => (img.src = u));
    }
  }, [html, attachments]);

  return (
    <div
      ref={ref}
      className={`prose selectable ${className}`}
      onDoubleClick={onDoubleClick}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
        if (a) {
          e.preventDefault();
          void platform().openUrl(a.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html || (empty ? `<p class="prose-empty">${empty}</p>` : "") }}
    />
  );
});
