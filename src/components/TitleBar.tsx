import { useEffect, useRef, useState } from "react";
import { Copy, Minus, Search, Square, X } from "lucide-react";
import { useStore, set } from "../state/store";
import { platform } from "../platform";
import { commands, runCommand } from "../commands/commands";
import { menuBar, type MenuDef } from "../commands/menus";
import { MenuPopup, type MenuItem } from "../ui/Menu";
import { BrandGlyph } from "../ui/icons";
import { Kbd } from "../ui/Kbd";
import { t } from "../i18n";

function toItems(def: MenuDef["items"]): MenuItem[] {
  const all = commands();
  const out: MenuItem[] = [];
  for (const entry of def) {
    if (entry === "-") {
      out.push({ separator: true });
      continue;
    }
    if (typeof entry === "object") {
      out.push({ label: entry.submenu, submenu: toItems(entry.items) });
      continue;
    }
    const c = all.find((x) => x.id === entry);
    if (!c) continue;
    out.push({
      label: c.label,
      icon: c.icon,
      shortcut: c.shortcut,
      disabled: c.enabled ? !c.enabled() : false,
      checked: c.checked ? c.checked() : undefined,
      onSelect: () => runCommand(c.id),
    });
  }
  return out;
}

export function TitleBar() {
  const kind = useStore((s) => s.info?.kind ?? "web");
  const [open, setOpen] = useState<number | null>(null);
  const [maximized, setMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const menus = menuBar();

  useEffect(() => {
    if (kind !== "tauri") return;
    const w = platform().window;
    void w.isMaximized().then(setMaximized);
    return w.onResized(() => void w.isMaximized().then(setMaximized));
  }, [kind]);

  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".menu, .menubar")) setOpen(null);
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [open]);

  // Alt alone focuses the menu bar, as in native Windows applications.
  useEffect(() => {
    let altAlone = false;
    const kd = (e: KeyboardEvent) => {
      altAlone = e.key === "Alt" && !e.ctrlKey && !e.shiftKey;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altAlone) {
        e.preventDefault();
        setOpen((o) => (o === null ? 0 : null));
      }
      altAlone = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  const anchorFor = (i: number) => {
    const el = barRef.current?.querySelectorAll<HTMLElement>(".menubar-item")[i];
    const r = el?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 30) + 4 };
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <BrandGlyph size={18} />
        <span className="wordmark" data-tauri-drag-region>
          Marée
        </span>
      </div>
      <nav className="menubar" ref={barRef} aria-label={t("Main menu")}>
        {menus.map((m, i) => (
          <button
            key={m.label}
            className={`menubar-item${open === i ? " open" : ""}`}
            onMouseDown={(e) => {
              e.stopPropagation();
              setOpen(open === i ? null : i);
            }}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      {open !== null && (
        <MenuPopup
          key={open}
          items={toItems(menus[open].items)}
          anchor={anchorFor(open)}
          onClose={() => setOpen(null)}
          onNavigate={(d) => setOpen((o) => ((o ?? 0) + d + menus.length) % menus.length)}
        />
      )}
      <div className="titlebar-drag" data-tauri-drag-region>
        <button className="titlebar-search" onClick={() => set({ palette: { open: true, query: "" } })}>
          <Search size={13} />
          <span>{t("Search problems, lectures, commands…")}</span>
          <Kbd keys="Ctrl+K" />
        </button>
      </div>
      {kind === "tauri" && (
        <div className="window-controls">
          <button className="wc-btn" aria-label={t("Minimize")} onClick={() => platform().window.minimize()}>
            <Minus size={15} strokeWidth={1.4} />
          </button>
          <button className="wc-btn" aria-label={maximized ? t("Restore") : t("Maximize")} onClick={() => platform().window.toggleMaximize()}>
            {maximized ? <Copy size={12} strokeWidth={1.4} style={{ transform: "scaleX(-1)" }} /> : <Square size={11.5} strokeWidth={1.4} />}
          </button>
          <button className="wc-btn close" aria-label={t("Close")} onClick={() => platform().window.close()}>
            <X size={16} strokeWidth={1.3} />
          </button>
        </div>
      )}
    </header>
  );
}
