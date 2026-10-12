import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Columns2, FileInput, FileText, HelpCircle, Images, Inbox, MessageSquareShare, Rows2, Settings, Sparkles, X } from "lucide-react";
import { useStore, get, type Tab } from "../state/store";
import * as A from "../state/actions";
import { problemLabel } from "../domain/filters";
import { renderInline } from "../math/render";
import { StatusIcon } from "../ui/icons";
import { openContextMenu } from "../ui/Menu";
import { Kbd } from "../ui/Kbd";
import { Resizer } from "../ui/Resizer";
import { ProblemView } from "./ProblemView";
import { SourceViewer } from "./SourceViewer";
import { ImportView } from "./ImportView";
import { ProgressView } from "./ProgressView";
import { SettingsView } from "./SettingsView";
import { WelcomeView } from "./WelcomeView";
import { HelpView } from "./HelpView";
import { visibleProblems } from "../state/visible";
import { InboxView } from "./InboxView";
import { TrayView } from "./TrayView";
import { t } from "../i18n";

function TabLabel({ tab }: { tab: Tab }) {
  const summary = useStore((s) => (tab.kind === "problem" ? s.problems.find((p) => p.id === tab.problemId) : undefined));
  const src = useStore((s) => (tab.kind === "source" ? s.index.sources.get(tab.sourceId) : undefined));
  switch (tab.kind) {
    case "problem": {
      if (!summary) return <span className="tab-label">{t("Problem")}</span>;
      const label = problemLabel(summary);
      return (
        <>
          <StatusIcon status={summary.status} size={12} />
          <span className="tab-label" title={label} dangerouslySetInnerHTML={{ __html: renderInline(label) }} />
        </>
      );
    }
    case "source":
      return (
        <>
          <FileText size={13} />
          <span className="tab-label" title={src?.title}>
            {src?.title ?? t("Source")}
          </span>
        </>
      );
    case "import":
      return (
        <>
          <FileInput size={13} />
          <span className="tab-label">{t("Import")}</span>
        </>
      );
    case "progress":
      return (
        <>
          <BarChart3 size={13} />
          <span className="tab-label">{t("Progress")}</span>
        </>
      );
    case "settings":
      return (
        <>
          <Settings size={13} />
          <span className="tab-label">{t("Settings")}</span>
        </>
      );
    case "welcome":
      return (
        <>
          <Sparkles size={13} />
          <span className="tab-label">{t("Welcome")}</span>
        </>
      );
    case "help":
      return (
        <>
          <HelpCircle size={13} />
          <span className="tab-label">{t("Help")}</span>
        </>
      );
    case "inbox":
      return (
        <>
          <Images size={13} />
          <span className="tab-label">{t("Photo Inbox")}</span>
        </>
      );
    case "tray":
      return (
        <>
          <MessageSquareShare size={13} />
          <span className="tab-label">{t("To ChatGPT")}</span>
        </>
      );
  }
}

function TabBody({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case "problem":
      return <ProblemView key={tab.problemId} problemId={tab.problemId} />;
    case "source":
      return <SourceViewer key={tab.sourceId} sourceId={tab.sourceId} page={tab.page} nonce={tab.nonce} />;
    case "import":
      return <ImportView importId={tab.importId} />;
    case "progress":
      return <ProgressView />;
    case "settings":
      return <SettingsView />;
    case "welcome":
      return <WelcomeView />;
    case "help":
      return <HelpView />;
    case "inbox":
      return <InboxView />;
    case "tray":
      return <TrayView />;
  }
}

function Home() {
  const recent = useStore((s) => s.recentIds);
  const problems = useStore((s) => s.problems);
  const items = recent
    .map((id) => problems.find((p) => p.id === id && !p.deletedAt))
    .filter(Boolean)
    .slice(0, 6);
  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-mark">
          Marée
          <small>{t("Select a problem, or start something new.")}</small>
        </div>
        <div>
          <div className="home-section-title">{t("Start")}</div>
          <div className="home-actions">
            <button className="home-action" onClick={() => A.createProblem()}>
              {t("New problem")} <Kbd keys="Ctrl+N" />
            </button>
            <button className="home-action" onClick={() => A.pickAndImport()}>
              {t("Import exercises…")} <Kbd keys="Ctrl+O" />
            </button>
            <button className="home-action" onClick={() => useStore.setState({ palette: { open: true, query: "" } })}>
              {t("Go to problem…")} <Kbd keys="Ctrl+P" />
            </button>
            <button className="home-action" onClick={() => useStore.setState({ palette: { open: true, query: ">" } })}>
              {t("All commands")} <Kbd keys="Ctrl+K" />
            </button>
            <button className="home-action" onClick={A.showReview}>
              <Inbox size={14} /> {t("Review queue")}
            </button>
            <button className="home-action" onClick={() => A.openTab({ id: "progress", kind: "progress" })}>
              <BarChart3 size={14} /> {t("Progress")}
            </button>
          </div>
        </div>
        {items.length > 0 && (
          <div className="home-recent">
            <div className="home-section-title">{t("Recent")}</div>
            {items.map((p) => (
              <button key={p!.id} className="home-action" onClick={() => A.openProblem(p!.id)}>
                <StatusIcon status={p!.status} />
                <span className="ellipsis" dangerouslySetInnerHTML={{ __html: renderInline(problemLabel(p!)) }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One-document mode: Back, what is shown, ‹ › through the list, split controls. */
function DocHeader({ index, active }: { index: number; active: Tab | null }) {
  const groupsCount = useStore((s) => s.groups.length);
  const canBack = useStore((s) => {
    const g = s.groups[index];
    return !!g && (s.backStack[g.id]?.length ?? 0) > 0;
  });
  const problems = useStore((s) => s.problems);
  const filter = useStore((s) => s.filter);
  const searchHits = useStore((s) => s.searchHits);
  const sort = useStore((s) => s.sort);
  const libIndex = useStore((s) => s.index);
  const listMode = useStore((s) => s.listMode);
  const list = useMemo(() => visibleProblems({ problems, filter, searchHits, sort, index: libIndex, listMode }), [problems, filter, searchHits, sort, libIndex, listMode]);
  const pid = active?.kind === "problem" ? active.problemId : null;
  const at = pid ? list.findIndex((p) => p.id === pid) : -1;
  return (
    <div className="docbar">
      <button className="icon-btn sm" title={t("Back (Alt+Left)")} disabled={!canBack} onClick={() => A.goBack(index)}>
        <ArrowLeft size={14} />
      </button>
      <div className="docbar-title">{active ? <TabLabel tab={active} /> : <span className="faint">{t("Nothing open")}</span>}</div>
      <span className="grow" />
      {pid && list.length > 0 && (
        <div className="docbar-nav">
          <button className="icon-btn sm" title={t("Previous problem in the list (Ctrl+PageUp)")} disabled={at === 0} onClick={() => A.stepProblem(-1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="docbar-pos">{at >= 0 ? `${at + 1} / ${list.length}` : `– / ${list.length}`}</span>
          <button className="icon-btn sm" title={t("Next problem in the list (Ctrl+PageDown)")} disabled={at === list.length - 1} onClick={() => A.stepProblem(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      <div className="tabs-actions">
        {index === groupsCount - 1 && (
          <>
            <button className="icon-btn sm" title={t("Split Editor Right (Ctrl+\\)")} onClick={() => A.splitEditor("row")}>
              <Columns2 size={14} />
            </button>
            <button className="icon-btn sm" title={t("Split Editor Down")} onClick={() => A.splitEditor("column")}>
              <Rows2 size={14} />
            </button>
          </>
        )}
        {groupsCount > 1 && (
          <button className="icon-btn sm" title={t("Close this group")} onClick={() => A.closeAllTabs(index)}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Group({ index }: { index: number }) {
  const group = useStore((s) => s.groups[index]);
  const focused = useStore((s) => s.activeGroup === index);
  const groupsCount = useStore((s) => s.groups.length);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const single = useStore((s) => s.settings.documentMode !== "tabs");
  if (!group) return null;
  const active = group.tabs.find((t) => t.id === group.activeId) ?? null;

  const tabMenu = (e: React.MouseEvent, tab: Tab) =>
    openContextMenu(e, [
      { label: t("Close"), shortcut: "Ctrl+W", onSelect: () => A.closeTab(index, tab.id) },
      { label: t("Close Others"), onSelect: () => A.closeOtherTabs(index, tab.id) },
      { label: t("Close All"), onSelect: () => A.closeAllTabs(index) },
      { separator: true },
      { label: groupsCount > 1 ? t("Move to Other Group") : t("Open in Split"), onSelect: () => A.moveTabToOtherGroup(index, tab.id) },
      ...(tab.kind === "problem" ? [{ label: t("Keep Open"), onSelect: () => A.pinTab(tab.id) }] : []),
    ]);

  if (single) {
    return (
      <div className={`eg${focused ? " focused" : ""}`} onMouseDownCapture={() => A.focusGroup(index)}>
        <DocHeader index={index} active={active} />
        <div className="eg-body">{active ? <TabBody key={active.id} tab={active} /> : <Home />}</div>
      </div>
    );
  }

  return (
    <div className={`eg${focused ? " focused" : ""}`} onMouseDownCapture={() => A.focusGroup(index)}>
      <div
        className="tabs"
        role="tablist"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-maree-tab")) e.preventDefault();
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-maree-tab");
          if (!raw) return;
          const { from, id } = JSON.parse(raw) as { from: number; id: string };
          if (from !== index) A.moveTabToOtherGroup(from, id);
        }}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) void A.createProblem();
        }}
      >
        {group.tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === group.activeId}
            className={`tab${tab.id === group.activeId ? " active" : ""}${(tab as { preview?: boolean }).preview ? " preview" : ""}${dragTab === tab.id ? " dragging" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragTab(tab.id);
              e.dataTransfer.setData("application/x-maree-tab", JSON.stringify({ from: index, id: tab.id }));
            }}
            onDragEnd={() => setDragTab(null)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void A.closeTab(index, tab.id);
              } else if (e.button === 0) A.activateTab(index, tab.id);
            }}
            onDoubleClick={() => A.pinTab(tab.id)}
            onContextMenu={(e) => tabMenu(e, tab)}
            title={(tab as { preview?: boolean }).preview ? t("Preview tab — double-click or edit to keep it open") : undefined}
          >
            <TabLabel tab={tab} />
            <button
              className="tab-close"
              aria-label={t("Close tab")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => A.closeTab(index, tab.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <div className="tabs-actions">
          {index === groupsCount - 1 && (
            <>
              <button className="icon-btn sm" title={t("Split Editor Right (Ctrl+\\)")} onClick={() => A.splitEditor("row")}>
                <Columns2 size={14} />
              </button>
              <button className="icon-btn sm" title={t("Split Editor Down")} onClick={() => A.splitEditor("column")}>
                <Rows2 size={14} />
              </button>
            </>
          )}
          {groupsCount > 1 && (
            <button className="icon-btn sm" title={t("Close this group")} onClick={() => A.closeAllTabs(index)}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="eg-body">{active ? <TabBody key={active.id} tab={active} /> : <Home />}</div>
    </div>
  );
}

export function EditorArea() {
  const n = useStore((s) => s.groups.length);
  const dir = useStore((s) => s.layout.splitDir);
  const [ratio, setRatio] = useState(0.5);
  if (n < 2) {
    return (
      <div className="editor-area">
        <Group index={0} />
      </div>
    );
  }
  return (
    <div className={`editor-area${dir === "column" ? " column" : ""}`}>
      <div style={{ flex: `${ratio} 1 0`, display: "flex", minWidth: 0, minHeight: 0 }}>
        <Group index={0} />
      </div>
      <Resizer
        vertical={dir === "column"}
        onResize={(d) => {
          const el = document.querySelector(".editor-area") as HTMLElement;
          const size = dir === "column" ? el.clientHeight : el.clientWidth;
          setRatio((r) => Math.min(0.85, Math.max(0.15, r + d / size)));
        }}
        onDoubleClick={() => setRatio(0.5)}
      />
      <div style={{ flex: `${1 - ratio} 1 0`, display: "flex", minWidth: 0, minHeight: 0 }}>
        <Group index={1} />
      </div>
    </div>
  );
}

export function getActiveGroup() {
  return get().groups[get().activeGroup];
}
