import { FileText } from "lucide-react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import { platform } from "../platform";
import { PdfViewer } from "./PdfViewer";
import { t } from "../i18n";

export function SourceViewer({ sourceId, page, nonce }: { sourceId: string; page?: number; nonce?: number }) {
  const src = useStore((s) => s.index.sources.get(sourceId));
  const count = useStore((s) => s.problems.filter((p) => p.sourceId === sourceId && !p.deletedAt).length);
  if (!src) return <div className="empty-state">{t("This source no longer exists.")}</div>;
  if (!src.storedPath) {
    return (
      <div className="empty-state">
        <FileText size={28} strokeWidth={1.3} />
        <div className="title">{src.title}</div>
        <p>{t("No original file is stored for this source.")}</p>
      </div>
    );
  }
  if (src.format !== "pdf") {
    return (
      <div className="empty-state">
        <FileText size={28} strokeWidth={1.3} />
        <div className="title">{src.title}</div>
        <p>{src.fileName}</p>
        <div className="row">
          <button className="btn" onClick={() => platform().openStored(src.storedPath!)}>
            {t("Open original file")}
          </button>
          <button className="btn btn-ghost" onClick={() => A.showSource(src.id)}>
            {t("Show its {n} problems", { n: count })}
          </button>
        </div>
      </div>
    );
  }
  return (
    <PdfViewer
      key={src.id}
      load={() => platform().readStored(src.storedPath!)}
      page={page}
      nonce={nonce}
      onOpenExternal={() => platform().openStored(src.storedPath!)}
    />
  );
}
