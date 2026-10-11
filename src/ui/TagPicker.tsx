import { useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Popover } from "./Popover";
import { t } from "../i18n";

export interface PickOption {
  id: string;
  label: string;
  detail?: string;
  depth?: number;
  group?: string;
}

/** Searchable multi-select with optional "create new" entry. */
export function TagPicker({
  anchor,
  options,
  selected,
  onToggle,
  onCreate,
  onClose,
  placeholder,
  single,
}: {
  anchor: HTMLElement | null;
  options: PickOption[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
  onCreate?: (label: string) => Promise<void> | void;
  onClose: () => void;
  placeholder?: string;
  single?: boolean;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => `${o.label} ${o.detail ?? ""} ${o.group ?? ""}`.toLowerCase().includes(s));
  }, [q, options]);
  const exact = options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const canCreate = !!onCreate && q.trim().length > 0 && !exact;
  const count = filtered.length + (canCreate ? 1 : 0);

  const choose = async (i: number) => {
    if (i < filtered.length) {
      const o = filtered[i];
      onToggle(o.id, !selected.includes(o.id));
      if (single) onClose();
    } else if (canCreate) {
      await onCreate!(q.trim());
      setQ("");
      if (single) onClose();
    }
  };

  let lastGroup: string | undefined;
  return (
    <Popover anchor={anchor} onClose={onClose} width={290}>
      <input
        className="input"
        style={{ width: "100%", marginBottom: 4 }}
        autoFocus
        placeholder={placeholder ?? t("Search…")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(count - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            void choose(active);
          }
        }}
      />
      <div ref={listRef} style={{ maxHeight: 300, overflowY: "auto" }}>
        {filtered.map((o, i) => {
          const head = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          return (
            <div key={o.id}>
              {head && <div className="menu-heading">{head}</div>}
              <button
                className={`menu-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(i)}
                style={{ paddingLeft: 9 + (o.depth ?? 0) * 14 }}
              >
                <span className="icon">{selected.includes(o.id) && <Check size={14} color="var(--accent)" />}</span>
                <span className="label">{o.label}</span>
                {o.detail && <span className="faint" style={{ fontSize: 11 }}>{o.detail}</span>}
              </button>
            </div>
          );
        })}
        {canCreate && (
          <button
            className={`menu-item${active === filtered.length ? " active" : ""}`}
            onMouseEnter={() => setActive(filtered.length)}
            onClick={() => void choose(filtered.length)}
          >
            <span className="icon">
              <Plus size={14} />
            </span>
            <span className="label">{t("Create “{name}”", { name: q.trim() })}</span>
          </button>
        )}
        {!count && <div className="menu-heading" style={{ textTransform: "none", letterSpacing: 0 }}>{t("No matches")}</div>}
      </div>
    </Popover>
  );
}
