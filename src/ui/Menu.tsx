// Dropdown and context menus with keyboard navigation and nested submenus.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Check, ChevronRight } from "lucide-react";
import { Kbd } from "./Kbd";

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  heading?: string;
  submenu?: MenuItem[];
}

interface Anchor {
  x: number;
  y: number;
  /** Width of the anchor element, used to flip submenus. */
  w?: number;
}

export function MenuPopup({
  items,
  anchor,
  onClose,
  onDone,
  onNavigate,
  autoFocus = true,
  level = 0,
}: {
  items: MenuItem[];
  anchor: Anchor;
  /** Closes this menu level. */
  onClose: () => void;
  /** Closes the whole menu tree (after an item was chosen). Defaults to onClose. */
  onDone?: () => void;
  onNavigate?: (dir: -1 | 1) => void;
  autoFocus?: boolean;
  level?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; anchor: Anchor } | null>(null);
  const actionable = items.map((it, i) => (!it.separator && !it.heading && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    if (left + r.width > window.innerWidth - 6) left = Math.max(6, (level > 0 ? anchor.x - (anchor.w ?? 0) - r.width : window.innerWidth - r.width - 6));
    if (top + r.height > window.innerHeight - 6) top = Math.max(6, window.innerHeight - r.height - 6);
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.w, level, items.length]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const select = (i: number) => {
    const it = items[i];
    if (!it || it.disabled || it.separator || it.heading) return;
    if (it.submenu) {
      const el = ref.current?.querySelectorAll<HTMLElement>("[data-idx]")[actionable.indexOf(i)] ?? null;
      const r = el?.getBoundingClientRect();
      if (r) setSub({ index: i, anchor: { x: r.right + 2, y: r.top - 5, w: r.width } });
      return;
    }
    (onDone ?? onClose)();
    it.onSelect?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (sub) return;
    const pos = actionable.indexOf(active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(actionable[(pos + 1) % actionable.length]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(actionable[(pos - 1 + actionable.length) % actionable.length]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active >= 0) select(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (active >= 0 && items[active]?.submenu) select(active);
      else onNavigate?.(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (level > 0) onClose();
      else onNavigate?.(-1);
    }
  };

  let n = -1;
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKey}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="menu-sep" role="separator" />;
        if (it.heading) return <div key={i} className="menu-heading">{it.heading}</div>;
        n++;
        return (
          <button
            key={i}
            data-idx={n}
            role="menuitem"
            className={`menu-item${active === i ? " active" : ""}${it.danger ? " danger" : ""}${it.checked ? " checked" : ""}`}
            disabled={it.disabled}
            onMouseEnter={(e) => {
              setActive(i);
              if (it.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ index: i, anchor: { x: r.right + 2, y: r.top - 5, w: r.width } });
              } else setSub(null);
            }}
            onClick={() => select(i)}
          >
            <span className="icon">{it.checked ? <Check size={14} /> : it.icon}</span>
            <span className="label">{it.label}</span>
            {it.shortcut && <Kbd keys={it.shortcut} />}
            {it.submenu && <ChevronRight size={13} className="faint" />}
          </button>
        );
      })}
      {sub && items[sub.index]?.submenu && (
        <MenuPopup
          items={items[sub.index].submenu!}
          anchor={sub.anchor}
          level={level + 1}
          onClose={() => {
            setSub(null);
            ref.current?.focus();
          }}
          onDone={onDone ?? onClose}
          autoFocus
        />
      )}
    </div>
  );
}

// --------------------------------------------------------- global menu host

interface MenuHostState {
  menu: { items: MenuItem[]; anchor: Anchor } | null;
}

export const useMenuHost = create<MenuHostState>(() => ({ menu: null }));

export function openMenu(items: MenuItem[], anchor: Anchor): void {
  useMenuHost.setState({ menu: { items, anchor } });
}

export function openContextMenu(e: React.MouseEvent | MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  openMenu(items, { x: e.clientX, y: e.clientY });
}

export function openMenuBelow(el: HTMLElement, items: MenuItem[]): void {
  const r = el.getBoundingClientRect();
  openMenu(items, { x: r.left, y: r.bottom + 3 });
}

export function closeMenu(): void {
  useMenuHost.setState({ menu: null });
}

export function MenuHost() {
  const menu = useMenuHost((s) => s.menu);
  useEffect(() => {
    if (!menu) return;
    const down = () => closeMenu();
    const blur = () => closeMenu();
    window.addEventListener("mousedown", down);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [menu]);
  if (!menu) return null;
  return createPortal(<MenuPopup items={menu.items} anchor={menu.anchor} onClose={closeMenu} />, document.body);
}
