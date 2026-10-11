import { useRef, useState, type ReactNode } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import { CATEGORIES, STATUSES, type Category, type FilterSpec, type Status } from "../data/types";
import { CATEGORY_LABEL, DIFFICULTY_LABEL, STATUS_LABEL } from "../domain/status";
import { courseLabel, isFilterEmpty, lectureLabel } from "../domain/filters";
import { Popover } from "../ui/Popover";
import { StatusIcon } from "../ui/icons";
import { t } from "../i18n";

type Flag = NonNullable<FilterSpec["flags"]>[number];

const FLAG_LABEL: Record<Flag, string> = {
  "import-review": "Needs import review",
  "has-solution": "Has my solution",
  "no-solution": "No solution yet",
  "has-reference": "Has reference solution",
  pinned: "Pinned",
  sample: "Sample data",
  "has-parts": "Multi-part",
};

function toggle<T>(list: T[] | undefined, v: T): T[] {
  const l = list ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
}

function Chip({ label, onRemove, children }: { label: string; onRemove: () => void; children?: ReactNode }) {
  return (
    <span className="chip" title={label}>
      <span className="label">{label}</span>
      {children}
      <button className="x" aria-label={t("Remove filter")} onClick={onRemove}>
        <X size={11} />
      </button>
    </span>
  );
}

export function FilterChips() {
  const filter = useStore((s) => s.filter);
  const index = useStore((s) => s.index);
  const chips: ReactNode[] = [];
  const set = (patch: Partial<FilterSpec>) => A.setFilter({ ...filter, ...patch });
  const names = (ids: string[] | undefined, get: (id: string) => string) => (ids ?? []).map(get).join(", ");

  if (filter.courseIds?.length) {
    chips.push(
      <Chip
        key="course"
        label={`${t("Course")}: ${names(filter.courseIds, (id) => (id ? index.courses.get(id)?.code || index.courses.get(id)?.title || "?" : t("None")))}`}
        onRemove={() => set({ courseIds: [] })}
      />,
    );
  }
  if (filter.lectureIds?.length) {
    const sep = filter.lectureMode === "all" ? " ∧ " : ", ";
    chips.push(
      <Chip
        key="lecture"
        label={`${t("Lecture")}: ${filter.lectureIds.map((id) => { const l = index.lectures.get(id); return l ? (l.number ? `L${l.number}` : l.title) : "?"; }).join(sep)}`}
        onRemove={() => set({ lectureIds: [] })}
      />,
    );
  }
  if (filter.topicIds?.length) {
    const sep = filter.topicMode === "all" ? " ∧ " : " ∨ ";
    chips.push(
      <Chip key="topic" label={`${t("Topic")}: ${filter.topicIds.map((id) => index.topics.get(id)?.name ?? "?").join(sep)}`} onRemove={() => set({ topicIds: [] })}>
        {filter.topicIds.length > 1 && (
          <button className="mode" title={t("Match any / all topics")} onClick={() => set({ topicMode: filter.topicMode === "all" ? "any" : "all" })}>
            {filter.topicMode === "all" ? t("ALL") : t("ANY")}
          </button>
        )}
      </Chip>,
    );
  }
  if (filter.statuses?.length) {
    chips.push(<Chip key="status" label={`${t("Status")}: ${filter.statuses.map((s) => t(STATUS_LABEL[s])).join(", ")}`} onRemove={() => set({ statuses: [] })} />);
  }
  if (filter.difficulties?.length) {
    chips.push(
      <Chip key="diff" label={`${t("Difficulty")}: ${filter.difficulties.map((d) => (d ? String(d) : t("none"))).join(", ")}`} onRemove={() => set({ difficulties: [] })} />,
    );
  }
  if (filter.categories?.length) {
    chips.push(
      <Chip
        key="cat"
        label={`${t("Type")}: ${filter.categories.map((c) => (c === "none" ? t("none") : t(CATEGORY_LABEL[c]))).join(", ")}`}
        onRemove={() => set({ categories: [] })}
      />,
    );
  }
  if (filter.sourceIds?.length) {
    chips.push(<Chip key="src" label={`${t("Source")}: ${names(filter.sourceIds, (id) => index.sources.get(id)?.title ?? "?")}`} onRemove={() => set({ sourceIds: [] })} />);
  }
  if (filter.review) {
    const lbl = { due: t("due"), scheduled: t("scheduled"), unscheduled: t("not scheduled") }[filter.review];
    chips.push(<Chip key="review" label={`${t("Review")}: ${lbl}`} onRemove={() => set({ review: undefined })} />);
  }
  for (const f of filter.flags ?? []) {
    chips.push(<Chip key={`f-${f}`} label={t(FLAG_LABEL[f])} onRemove={() => set({ flags: (filter.flags ?? []).filter((x) => x !== f) })} />);
  }
  if (filter.attemptedWithinDays) {
    chips.push(<Chip key="att" label={t("Attempted in last {n} days", { n: filter.attemptedWithinDays })} onRemove={() => set({ attemptedWithinDays: undefined })} />);
  }
  if (filter.neverAttempted) chips.push(<Chip key="never" label={t("Never attempted")} onRemove={() => set({ neverAttempted: undefined })} />);
  if (!chips.length) return null;
  return <div className="filter-chips">{chips}</div>;
}

function Facet({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="facet">
      <div className="facet-head">
        <span>{title}</span>
        {extra}
      </div>
      <div className="facet-body">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button className={`facet-toggle${on ? " on" : ""}`} onClick={onClick} title={title} aria-pressed={on}>
      {children}
    </button>
  );
}

export function FilterPanel({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const filter = useStore((s) => s.filter);
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const topics = useStore((s) => s.topics);
  const sources = useStore((s) => s.sources);
  const set = (patch: Partial<FilterSpec>) => A.setFilter({ ...filter, ...patch });

  return (
    <Popover anchor={anchor} onClose={onClose} width={380}>
      <div className="filter-panel">
        <Facet title={t("Status")}>
          {STATUSES.map((st: Status) => (
            <Toggle key={st} on={!!filter.statuses?.includes(st)} onClick={() => set({ statuses: toggle(filter.statuses, st) })}>
              <StatusIcon status={st} size={13} /> {t(STATUS_LABEL[st])}
            </Toggle>
          ))}
        </Facet>
        <Facet
          title={t("Topics")}
          extra={
            <span className="facet-mode">
              <Toggle on={(filter.topicMode ?? "any") === "any"} onClick={() => set({ topicMode: "any" })} title={t("Problems with at least one of the topics")}>
                {t("Any")}
              </Toggle>
              <Toggle on={filter.topicMode === "all"} onClick={() => set({ topicMode: "all" })} title={t("Problems with all selected topics")}>
                {t("All")}
              </Toggle>
            </span>
          }
        >
          {topics.length === 0 && <span className="faint">{t("No topics yet.")}</span>}
          {topics.map((tp) => (
            <Toggle key={tp.id} on={!!filter.topicIds?.includes(tp.id)} onClick={() => set({ topicIds: toggle(filter.topicIds, tp.id) })}>
              {tp.name}
            </Toggle>
          ))}
        </Facet>
        <Facet title={t("Course")}>
          {courses.map((c) => (
            <Toggle key={c.id} on={!!filter.courseIds?.includes(c.id)} onClick={() => set({ courseIds: toggle(filter.courseIds, c.id) })} title={courseLabel(c)}>
              {c.code || c.title}
            </Toggle>
          ))}
          <Toggle on={!!filter.courseIds?.includes("")} onClick={() => set({ courseIds: toggle(filter.courseIds, "") })}>
            {t("No course")}
          </Toggle>
        </Facet>
        {lectures.length > 0 && (
          <Facet title={t("Lectures")}>
            {lectures
              .filter((l) => !filter.courseIds?.length || filter.courseIds.includes(l.courseId))
              .map((l) => (
                <Toggle key={l.id} on={!!filter.lectureIds?.includes(l.id)} onClick={() => set({ lectureIds: toggle(filter.lectureIds, l.id) })} title={lectureLabel(l)}>
                  {l.number ? `L${l.number}` : l.title}
                </Toggle>
              ))}
          </Facet>
        )}
        <Facet title={t("Difficulty")}>
          {[1, 2, 3, 4].map((d) => (
            <Toggle key={d} on={!!filter.difficulties?.includes(d)} onClick={() => set({ difficulties: toggle(filter.difficulties, d) })} title={t(DIFFICULTY_LABEL[d])}>
              {t("Level {n}", { n: d })}
            </Toggle>
          ))}
          <Toggle on={!!filter.difficulties?.includes(0)} onClick={() => set({ difficulties: toggle(filter.difficulties, 0) })}>
            {t("Unrated")}
          </Toggle>
        </Facet>
        <Facet title={t("Type")}>
          {CATEGORIES.map((c: Category) => (
            <Toggle key={c} on={!!filter.categories?.includes(c)} onClick={() => set({ categories: toggle(filter.categories, c) })}>
              {t(CATEGORY_LABEL[c])}
            </Toggle>
          ))}
        </Facet>
        {sources.length > 0 && (
          <Facet title={t("Source")}>
            {sources.map((s) => (
              <Toggle key={s.id} on={!!filter.sourceIds?.includes(s.id)} onClick={() => set({ sourceIds: toggle(filter.sourceIds, s.id) })}>
                {s.title.length > 34 ? s.title.slice(0, 33) + "…" : s.title}
              </Toggle>
            ))}
          </Facet>
        )}
        <Facet title={t("Review and progress")}>
          {(["due", "scheduled", "unscheduled"] as const).map((r) => (
            <Toggle key={r} on={filter.review === r} onClick={() => set({ review: filter.review === r ? undefined : r })}>
              {{ due: t("Review due"), scheduled: t("Review scheduled"), unscheduled: t("No review date") }[r]}
            </Toggle>
          ))}
          <Toggle on={filter.attemptedWithinDays === 7} onClick={() => set({ attemptedWithinDays: filter.attemptedWithinDays === 7 ? undefined : 7 })}>
            {t("Attempted this week")}
          </Toggle>
          <Toggle on={!!filter.neverAttempted} onClick={() => set({ neverAttempted: !filter.neverAttempted || undefined })}>
            {t("Never attempted")}
          </Toggle>
          {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => (
            <Toggle key={f} on={!!filter.flags?.includes(f)} onClick={() => set({ flags: toggle(filter.flags, f) })}>
              {t(FLAG_LABEL[f])}
            </Toggle>
          ))}
        </Facet>
        <div className="row" style={{ justifyContent: "space-between", paddingTop: 4 }}>
          <button className="btn btn-ghost btn-sm" disabled={isFilterEmpty({ ...filter, text: "" })} onClick={() => A.setFilter({ text: filter.text })}>
            {t("Clear filters")}
          </button>
          <button className="btn btn-sm" onClick={() => A.openDialog({ kind: "save-view" })}>
            {t("Save as view…")}
          </button>
        </div>
      </div>
    </Popover>
  );
}

export function SearchAndFilter() {
  const text = useStore((s) => s.filter.text ?? "");
  const filter = useStore((s) => s.filter);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const active = !isFilterEmpty({ ...filter, text: "" });
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <label className="searchbox grow">
          <Search size={14} />
          <input
            id="library-search"
            placeholder={t("Search statements, solutions, notes…")}
            value={text}
            spellCheck={false}
            onChange={(e) => A.patchFilter({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (text) A.patchFilter({ text: "" });
                else (e.target as HTMLInputElement).blur();
              }
              if (e.key === "ArrowDown" || e.key === "Enter") {
                e.preventDefault();
                document.querySelector<HTMLElement>(".lp-body")?.focus();
              }
            }}
          />
          {text && (
            <button className="icon-btn sm" aria-label={t("Clear search")} onClick={() => A.patchFilter({ text: "" })}>
              <X size={13} />
            </button>
          )}
        </label>
        <button ref={btn} className={`icon-btn${active || open ? " active" : ""}`} title={t("Filter")} onClick={() => setOpen(!open)}>
          <ListFilter size={16} />
        </button>
      </div>
      {open && <FilterPanel anchor={btn.current} onClose={() => setOpen(false)} />}
      <FilterChips />
    </>
  );
}
