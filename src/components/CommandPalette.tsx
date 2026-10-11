import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronRight, Filter, GraduationCap, Hash, Library, Search } from "lucide-react";
import { useStore, set, get } from "../state/store";
import * as A from "../state/actions";
import { commands, runCommand } from "../commands/commands";
import { courseLabel, lectureLabel, problemLabel } from "../domain/filters";
import { StatusIcon } from "../ui/icons";
import { Kbd } from "../ui/Kbd";
import { openBeside } from "./problemMenu";
import { t } from "../i18n";

interface Entry {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  shortcut?: string;
  run: (beside?: boolean) => void;
}

/** Subsequence match; returns a score (higher is better) and matched indices, or null. */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const direct = s.indexOf(q);
  if (direct >= 0) {
    return { score: 100 - direct + (direct === 0 || s[direct - 1] === " " ? 30 : 0), hits: Array.from({ length: q.length }, (_, i) => direct + i) };
  }
  const hits: number[] = [];
  let j = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < s.length && j < q.length; i++) {
    if (s[i] === q[j]) {
      hits.push(i);
      score += i === prev + 1 ? 5 : 1;
      if (i === 0 || s[i - 1] === " ") score += 4;
      prev = i;
      j++;
    }
  }
  return j === q.length ? { score, hits } : null;
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}
    </>
  );
}

export function CommandPalette() {
  const open = useStore((s) => s.palette.open);
  const initial = useStore((s) => s.palette.query);
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const problems = useStore((s) => s.problems);
  const recentIds = useStore((s) => s.recentIds);
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const topics = useStore((s) => s.topics);
  const views = useStore((s) => s.views);

  useEffect(() => {
    if (open) {
      setQ(initial);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initial]);

  const close = () => set({ palette: { open: false, query: "" } });

  const results = useMemo(() => {
    if (!open) return [] as (Entry & { hits: number[] })[];
    const isCmd = q.startsWith(">");
    const query = (isCmd ? q.slice(1) : q).trim();
    const out: (Entry & { score: number; hits: number[] })[] = [];
    const add = (e: Entry, text = e.label) => {
      const m = fuzzy(query, text);
      if (m) out.push({ ...e, score: m.score, hits: text === e.label ? m.hits : [] });
    };
    const available = commands().filter((c) => !c.enabled || c.enabled());
    if (isCmd) {
      const cats: string[] = [];
      for (const c of available) if (!cats.includes(c.category)) cats.push(c.category);
      for (const c of available) add({ id: c.id, group: c.category, label: c.label, icon: c.icon, shortcut: c.shortcut, run: () => runCommand(c.id) });
      // With a query: best matches first. Without: grouped by menu.
      if (query) return out.sort((a, b) => b.score - a.score).map((e) => ({ ...e, group: t("Commands") })).slice(0, 60);
      return out.sort((a, b) => cats.indexOf(a.group) - cats.indexOf(b.group));
    }
    const live = problems.filter((p) => !p.deletedAt);
    const index = get().index;
    if (!query) {
      const recent = recentIds.map((id) => live.find((p) => p.id === id)).filter(Boolean).slice(0, 8);
      for (const p of recent) {
        out.push({
          id: p!.id,
          group: t("Recently viewed"),
          label: problemLabel(p!),
          detail: [index.courses.get(p!.courseId ?? "")?.code].filter(Boolean).join(" · "),
          icon: <StatusIcon status={p!.status} />,
          run: (beside) => (beside ? openBeside(p!.id) : void A.openProblem(p!.id)),
          score: 0,
          hits: [],
        });
      }
      for (const c of commands().filter((c) => ["import.files", "problem.new", "nav.review", "progress", "help.shortcuts"].includes(c.id))) {
        out.push({ id: c.id, group: t("Suggested"), label: c.label, icon: c.icon, shortcut: c.shortcut, run: () => runCommand(c.id), score: 0, hits: [] });
      }
      return out;
    }
    for (const p of live) {
      const label = problemLabel(p);
      const course = index.courses.get(p.courseId ?? "");
      const topicsText = p.topicIds.map((id) => index.topics.get(id)?.name ?? "").join(" ");
      const lecText = p.lectureIds.map((id) => { const l = index.lectures.get(id); return l ? `lecture ${l.number} ${l.title}` : ""; }).join(" ");
      const text = `${label} ${course?.code ?? ""} ${lecText} ${topicsText}`;
      const m = fuzzy(query, label) ?? fuzzy(query, text);
      if (m) {
        out.push({
          id: p.id,
          group: t("Problems"),
          label,
          detail: [course?.code, lecText.split(" ").slice(0, 2).join(" ")].filter(Boolean).join(" · "),
          icon: <StatusIcon status={p.status} />,
          run: (beside) => (beside ? openBeside(p.id) : void A.openProblem(p.id)),
          score: m.score + (recentIds.includes(p.id) ? 8 : 0),
          hits: fuzzy(query, label)?.hits ?? [],
        });
      }
    }
    for (const c of courses) add({ id: c.id, group: t("Courses"), label: courseLabel(c), icon: <GraduationCap size={14} />, run: () => A.showCourse(c.id) });
    for (const l of lectures) {
      const c = courses.find((x) => x.id === l.courseId);
      add({ id: l.id, group: t("Lectures"), label: lectureLabel(l), detail: c?.code || c?.title, icon: <BookOpen size={14} />, run: () => A.showLecture(l.id) });
    }
    for (const tp of topics) add({ id: tp.id, group: t("Topics"), label: tp.name, icon: <Hash size={14} />, run: () => A.showTopic(tp.id) });
    for (const v of views) add({ id: v.id, group: t("Saved Views"), label: v.name, icon: <Filter size={14} />, run: () => A.showView(v.id) });
    for (const c of available) {
      if (c.hidden) continue;
      add({ id: c.id, group: t("Commands"), label: c.label, icon: c.icon, shortcut: c.shortcut, run: () => runCommand(c.id) });
    }
    out.push({
      id: "search",
      group: t("Search"),
      label: t("Search the library for “{q}”", { q: query }),
      icon: <Search size={14} />,
      run: () => {
        A.showAll();
        A.patchFilter({ text: query });
      },
      score: -1000,
      hits: [],
    });
    const groupOrder = [t("Problems"), t("Lectures"), t("Topics"), t("Courses"), t("Saved Views"), t("Commands"), t("Search")];
    const byGroup = new Map<string, typeof out>();
    for (const e of out.sort((a, b) => b.score - a.score)) {
      const g = byGroup.get(e.group) ?? [];
      if (g.length < (e.group === t("Problems") ? 12 : e.group === t("Commands") ? 5 : 6)) g.push(e);
      byGroup.set(e.group, g);
    }
    return groupOrder.flatMap((g) => byGroup.get(g) ?? []);
  }, [open, q, problems, recentIds, courses, lectures, topics, views]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (i: number, beside = false) => {
    const e = results[i];
    if (!e) return;
    close();
    e.run(beside);
  };

  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={t("Command palette")}>
        <div className="palette-input">
          {q.startsWith(">") ? <ChevronRight size={16} /> : <Library size={16} />}
          <input
            ref={inputRef}
            value={q}
            placeholder={q.startsWith(">") ? t("Run a command…") : t("Search problems, lectures, topics and commands")}
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(active, e.ctrlKey);
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="palette-group">{t("No results")}</div>}
          {results.map((e, i) => {
            const head = e.group !== lastGroup ? e.group : null;
            lastGroup = e.group;
            return (
              <div key={`${e.group}-${e.id}`}>
                {head && <div className="palette-group">{head}</div>}
                <button
                  className={`palette-item${i === active ? " active" : ""}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={(ev) => run(i, ev.ctrlKey)}
                >
                  <span className="icon">{e.icon}</span>
                  <span className="label">
                    <Highlight text={e.label} hits={e.hits} />
                  </span>
                  {e.detail && <span className="detail">{e.detail}</span>}
                  {e.shortcut && <Kbd keys={e.shortcut} />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd keys="↑" /> <Kbd keys="↓" /> {t("navigate")}
          </span>
          <span>
            <Kbd keys="Enter" /> {t("open")}
          </span>
          <span>
            <Kbd keys="Ctrl+Enter" /> {t("open to the side")}
          </span>
          <span>
            <Kbd keys=">" /> {t("commands")}
          </span>
        </div>
      </div>
    </div>
  );
}
