import { useMemo } from "react";
import { Database, Moon, Sun } from "lucide-react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import { flushAutosave } from "../state/autosave";
import { reviewGroups } from "../domain/review";
import { todayLocal } from "../data/ids";
import { fmtTime, t } from "../i18n";

export function StatusBar() {
  const problems = useStore((s) => s.problems);
  const saveState = useStore((s) => s.saveState);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const theme = useStore((s) => s.settings.theme);
  const info = useStore((s) => s.info);
  const hasSample = useStore((s) => s.hasSample);
  const stats = useMemo(() => {
    const live = problems.filter((p) => !p.deletedAt);
    const groups = reviewGroups(live, todayLocal());
    return {
      total: live.length,
      done: live.filter((p) => p.status === "completed" || p.status === "mastered").length,
      due: (groups.find((g) => g.key === "due")?.problems.length ?? 0) + (groups.find((g) => g.key === "needs_review")?.problems.length ?? 0),
    };
  }, [problems]);
  const dark = A.resolveTheme(theme) === "maree-dark" || A.resolveTheme(theme) === "black-gold";
  const saveLabel =
    saveState === "saving"
      ? t("Saving…")
      : saveState === "pending"
        ? t("Unsaved changes")
        : saveState === "error"
          ? t("Save failed — retrying")
          : t("All changes saved");

  return (
    <footer className="statusbar">
      <button className="sb-btn" onClick={A.showAll}>
        {t("{n} problems", { n: stats.total })}
      </button>
      <span>{t("{n} done", { n: stats.done })}</span>
      {stats.due > 0 && (
        <button className="sb-btn" onClick={A.showReview}>
          {t("{n} to review", { n: stats.due })}
        </button>
      )}
      {hasSample && (
        <button className="sb-btn" onClick={A.removeSample} title={t("Remove sample data")}>
          <span className="sample-tag">{t("sample data loaded")}</span>
        </button>
      )}
      <span className="grow" />
      <button className="sb-btn" title={lastSavedAt ? t("Last saved {time}", { time: fmtTime(lastSavedAt) }) : undefined} onClick={() => flushAutosave()}>
        <span className={`save-dot ${saveState}`} />
        {saveLabel}
      </button>
      <button className="sb-btn" title={info?.dbPath} onClick={() => A.openTab({ id: "settings", kind: "settings" })}>
        <Database size={12} /> {info?.kind === "tauri" ? (info.portable ? t("Portable library") : t("Local library")) : t("Browser preview")}
      </button>
      <button className="sb-btn" title={t("Toggle light/dark theme")} onClick={() => A.updateSettings({ theme: dark ? "maree" : "maree-dark" })}>
        {dark ? <Sun size={12} /> : <Moon size={12} />}
      </button>
    </footer>
  );
}
