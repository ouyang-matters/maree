import { useEffect, useRef } from "react";
import { addPhotos, initInbox } from "./state/inbox";
import { initUpdates } from "./state/updates";
import { inboxInFront } from "./components/InboxView";
import { useStore } from "./state/store";
import * as A from "./state/actions";
import { platform } from "./platform";
import { handleGlobalKey, resetCommands } from "./commands/commands";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ProblemList } from "./components/ProblemList";
import { EditorArea } from "./components/EditorArea";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { Dialogs } from "./components/Dialogs";
import { MenuHost } from "./ui/Menu";
import { Resizer } from "./ui/Resizer";
import { t } from "./i18n";

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`}>
          <span>{x.message}</span>
          {x.action && (
            <button
              onClick={() => {
                x.action!.run();
                useStore.setState((s) => ({ toasts: s.toasts.filter((y) => y.id !== x.id) }));
              }}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function DropOverlay() {
  const active = useStore((s) => s.dropActive);
  if (!active) return null;
  return (
    <div className="drop-overlay">
      <div>
        <span className="wordmark">Marée</span>
        {t("Drop files to import exercises")}
      </div>
    </div>
  );
}

export function App() {
  const layout = useStore((s) => s.layout);
  const locale = useStore((s) => s.settings.locale);
  // The import wizard and the photo inbox need the width: the problem list steps aside.
  const importInFront = useStore((s) => {
    const g = s.groups[s.activeGroup];
    const kind = g?.tabs.find((x) => x.id === g.activeId)?.kind;
    return kind === "import" || kind === "inbox";
  });
  const listOpen = layout.listOpen && !importInFront;
  const sidebarRef = useRef(layout.sidebarWidth);
  const listRef = useRef(layout.listWidth);
  sidebarRef.current = layout.sidebarWidth;
  listRef.current = layout.listWidth;

  useEffect(() => {
    resetCommands();
  }, [locale]);

  useEffect(() => {
    initInbox();
    initUpdates();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().palette.open || useStore.getState().dialog) return;
      handleGlobalKey(e);
    };
    window.addEventListener("keydown", onKey);
    const off = platform().onFileDrop(
      (files) => {
        if (!files.length) return;
        // Photos dropped on the inbox wait there to be cropped; everything else is imported.
        if (inboxInFront() && files.every((f) => /\.(jpe?g|png|webp)$/i.test(f.name))) void addPhotos(files);
        else void A.startImport(files);
      },
      (over) => useStore.setState({ dropActive: over }),
    );
    // Clipboard images pasted outside an editor are not handled; inside editors text is pasted normally.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => {
      if (useStore.getState().settings.theme === "system") A.applyTheme("system");
    };
    media?.addEventListener("change", onScheme);
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
      media?.removeEventListener("change", onScheme);
    };
  }, []);

  return (
    <div className="app" onContextMenu={(e) => {
      const el = e.target as HTMLElement;
      // Keep the native menu (copy/paste/spelling) in text fields and editors only.
      if (!el.closest("input, textarea, .cm-editor, .selectable")) e.preventDefault();
    }}>
      <TitleBar />
      <div className="workbench">
        {layout.sidebarOpen && (
          <>
            <div style={{ width: layout.sidebarWidth, display: "flex", flex: "none" }}>
              <Sidebar />
            </div>
            <Resizer
              onResize={(d) => A.updateLayout({ sidebarWidth: Math.min(420, Math.max(180, sidebarRef.current + d)) })}
              onDoubleClick={() => A.updateLayout({ sidebarWidth: 248 })}
            />
          </>
        )}
        {listOpen && (
          <>
            <div style={{ width: layout.listWidth, display: "flex", flex: "none" }}>
              <ProblemList />
            </div>
            <Resizer
              onResize={(d) => A.updateLayout({ listWidth: Math.min(1100, Math.max(280, listRef.current + d)) })}
              onDoubleClick={() => A.updateLayout({ listWidth: 460 })}
            />
          </>
        )}
        <EditorArea />
      </div>
      <StatusBar />
      <CommandPalette />
      <Dialogs />
      <MenuHost />
      <Toasts />
      <DropOverlay />
    </div>
  );
}

export function BootError({ message }: { message: string }) {
  return (
    <div className="boot-error">
      <h1>Marée</h1>
      <p>{t("The library could not be opened. Your data has not been modified.")}</p>
      <pre>{message}</pre>
      <p className="muted">{t("Automatic snapshots of the database are kept in the backups folder inside the data directory.")}</p>
    </div>
  );
}
