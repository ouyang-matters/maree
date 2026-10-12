import { useEffect, useState } from "react";
import { checkForUpdates } from "../state/updates";
import { FolderOpen } from "lucide-react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import { DEFAULT_MACROS, macrosToText, parseMacroText, renderInline } from "../math/render";
import { LOCALES, type Locale } from "../i18n";
import { platform } from "../platform";
import type { ThemeId } from "../state/store";
import { t } from "../i18n";

const THEMES: { id: ThemeId; label: string; swatch: [string, string, string] }[] = [
  { id: "maree", label: "Marée", swatch: ["#fbf9f7", "#2b2629", "#b03a6c"] },
  { id: "maree-dark", label: "Dark Academic", swatch: ["#1c1a1e", "#ebe5e9", "#e283ab"] },
  { id: "waterloo", label: "Waterloo Math Pink", swatch: ["#ffffff", "#24181f", "#c4007a"] },
  { id: "black-gold", label: "Black & Gold", swatch: ["#121212", "#f1eee6", "#e2b33c"] },
  { id: "system", label: "Follow System", swatch: ["#fbf9f7", "#1c1a1e", "#b03a6c"] },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const [macroText, setMacroText] = useState(() => macrosToText(settings.katexMacros));
  const [macroError, setMacroError] = useState<string | null>(null);

  useEffect(() => setMacroText(macrosToText(settings.katexMacros)), [settings.katexMacros]);

  const saveMacros = () => {
    const parsed = parseMacroText(macroText);
    const lines = macroText.split("\n").filter((l) => l.trim() && !l.trim().startsWith("%"));
    if (Object.keys(parsed).length < lines.length) {
      setMacroError(t("Some lines were not understood. Use one macro per line: \\name = expansion"));
    } else setMacroError(null);
    void A.updateSettings({ katexMacros: parsed });
  };

  return (
    <div className="doc-view">
      <div className="doc-inner narrow">
        <h1 className="doc-title">{t("Settings")}</h1>

        <h2 className="set-section">{t("Appearance")}</h2>
        <div className="theme-grid">
          {THEMES.map((th) => (
            <button key={th.id} className={`theme-card${settings.theme === th.id ? " on" : ""}`} onClick={() => A.updateSettings({ theme: th.id })}>
              <span className="theme-swatch" style={{ background: th.swatch[0] }}>
                <span style={{ background: th.swatch[1] }} />
                <span style={{ background: th.swatch[2] }} />
              </span>
              {t(th.label)}
            </button>
          ))}
        </div>
        <Row label={t("Mathematics text size")} hint={t("Size of statements and rendered solutions (Ctrl + / Ctrl −).")}>
          <input type="range" min={13} max={22} step={1} value={settings.proseSize} onChange={(e) => A.updateSettings({ proseSize: Number(e.target.value) })} />
          <span className="mono">{settings.proseSize}px</span>
        </Row>
        <Row label={t("Editor font size")}>
          <input type="range" min={11} max={18} step={0.5} value={settings.editorFontSize} onChange={(e) => A.updateSettings({ editorFontSize: Number(e.target.value) })} />
          <span className="mono">{settings.editorFontSize}px</span>
        </Row>
        <Row label={t("Language")} hint={t("French and Chinese translations are partial; missing strings appear in English.")}>
          <select className="select" value={settings.locale} onChange={(e) => A.updateSettings({ locale: e.target.value as Locale }).then(() => location.reload())}>
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>

        <h2 className="set-section">{t("Editing")}</h2>
        <Row label={t("Default editor layout")}>
          <div className="seg">
            {(["split", "source", "preview"] as const).map((m) => (
              <button key={m} className={settings.editorMode === m ? "on" : ""} onClick={() => A.updateSettings({ editorMode: m })}>
                {{ split: t("Source + preview"), source: t("Source"), preview: t("Preview") }[m]}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t("Documents")} hint={t("One at a time: opening a problem replaces the one shown; Back returns to it, and ‹ › step through the list. Tabs: each problem opens in its own tab.")}>
          <div className="seg seg-sm" role="radiogroup">
            {(["single", "tabs"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={settings.documentMode === m} className={settings.documentMode === m ? "on" : ""} onClick={() => A.updateSettings({ documentMode: m })}>
                {m === "single" ? t("One at a time") : t("Tabs")}
              </button>
            ))}
          </div>
        </Row>
        {settings.documentMode === "tabs" && (
        <Row label={t("Open tabs")} hint={t("At most this many tabs stay open in each editor area; opening another closes the one used least recently.")}>
          <select className="select" style={{ width: 90 }} value={settings.maxTabs} onChange={(e) => A.updateSettings({ maxTabs: Number(e.target.value) })}>
            {[3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Row>
        )}
        <Row label={t("Spell checking")} hint={t("Checks prose in the editor; mathematics is ignored by most dictionaries.")}>
          <label className="checkbox">
            <input type="checkbox" checked={settings.spellcheck} onChange={(e) => A.updateSettings({ spellcheck: e.target.checked })} />
            {t("Enabled")}
          </label>
        </Row>

        <h2 className="set-section">{t("Updates")}</h2>
        <Row label={t("Version {v}", { v: info?.version ?? "" })} hint={t("New versions come from GitHub Releases and are installed only if they carry Marée's signature.")}>
          <label className="checkbox">
            <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => A.updateSettings({ autoUpdate: e.target.checked })} />
            {t("Check automatically")}
          </label>
          <button className="btn btn-sm" onClick={() => void checkForUpdates(true)}>
            {t("Check Now")}
          </button>
        </Row>

        <h2 className="set-section">{t("LaTeX macros")}</h2>
        <p className="muted">
          {t("Macros are available in every formula and are included in LaTeX exports. One per line, e.g.")} <code>\R = \mathbb{"{R}"}</code>{" "}
          {t("or")} <code>\newcommand{"{\\abs}"}[1]{"{\\left|#1\\right|}"}</code>.
        </p>
        <textarea className="textarea mono" rows={9} value={macroText} spellCheck={false} onChange={(e) => setMacroText(e.target.value)} onBlur={saveMacros} />
        {macroError && <div className="mx-errors">{macroError}</div>}
        <div className="row">
          <button className="btn btn-sm" onClick={saveMacros}>
            {t("Apply macros")}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => A.updateSettings({ katexMacros: { ...DEFAULT_MACROS } })}>
            {t("Restore defaults")}
          </button>
          <span className="grow" />
          <span className="muted" dangerouslySetInnerHTML={{ __html: renderInline(t("Preview:") + " \\(\\abs{x} \\in \\R,\\ \\eps > 0\\)") }} />
        </div>

        <h2 className="set-section">{t("Library and data")}</h2>
        <Row label={t("Data location")} hint={info?.portable ? t("Portable mode: data is stored next to the application.") : undefined}>
          <code className="selectable path">{info?.dataDir}</code>
          {info?.kind === "tauri" && (
            <button className="btn btn-sm" onClick={() => platform().openDataFolder()}>
              <FolderOpen size={13} /> {t("Open")}
            </button>
          )}
        </Row>
        <Row label={t("Automatic snapshots")} hint={t("A copy of the database is taken at most once a day when Marée starts; the last 10 are kept.")}>
          <span className="muted selectable">{info?.lastSnapshot ? info.lastSnapshot.split(/[\\/]/).pop() : t("none yet")}</span>
          <button className="btn btn-sm" onClick={() => A.snapshotNow()}>
            {t("Snapshot now")}
          </button>
        </Row>
        <Row label={t("Backups")} hint={t("A backup archive contains the full library as JSON, a database copy and every original file.")}>
          <button className="btn btn-sm" onClick={() => A.backupLibrary()}>
            {t("Back up library…")}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => A.restoreBackup()}>
            {t("Restore…")}
          </button>
        </Row>
        <Row label={t("Sample data")}>
          <button className="btn btn-sm" onClick={() => A.loadSample()}>
            {t("Load sample library")}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => A.removeSample()}>
            {t("Remove sample data")}
          </button>
        </Row>
        <Row label={t("Search index")}>
          <button className="btn btn-sm" onClick={() => A.rebuildSearchIndex()}>
            {t("Rebuild")}
          </button>
        </Row>
        <p className="faint" style={{ marginTop: 28 }}>
          Marée {info?.version} · {info?.kind === "tauri" ? t("Desktop") : t("Browser preview")} · {info?.dbPath}
        </p>
      </div>
    </div>
  );
}
