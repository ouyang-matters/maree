import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import { STATUSES } from "../data/types";
import { STATUS_LABEL } from "../domain/status";
import { countStatuses, progressByCourse, progressByTopic, reviewGroups, type ProgressRow } from "../domain/review";
import { todayLocal } from "../data/ids";
import { StatusIcon } from "../ui/icons";
import { t } from "../i18n";

function Bar({ row }: { row: ProgressRow }) {
  if (!row.total) return <div className="pbar empty" />;
  return (
    <div className="pbar" role="img" aria-label={STATUSES.map((s) => `${t(STATUS_LABEL[s])}: ${row.counts[s]}`).join(", ")}>
      {[...STATUSES].reverse().map((s) =>
        row.counts[s] ? <span key={s} style={{ flexGrow: row.counts[s], background: `var(--st-${s})` }} title={`${t(STATUS_LABEL[s])}: ${row.counts[s]}`} /> : null,
      )}
    </div>
  );
}

function Table({ rows, onOpen }: { rows: ProgressRow[]; onOpen: (r: ProgressRow) => void }) {
  return (
    <table className="ptable">
      <thead>
        <tr>
          <th />
          <th className="num wide">{t("Problems")}</th>
          {STATUSES.map((s) => (
            <th key={s} className="num" title={t(STATUS_LABEL[s])}>
              <StatusIcon status={s} size={12} />
            </th>
          ))}
          <th className="num wide">{t("Done")}</th>
          <th className="bar" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const done = r.counts.completed + r.counts.mastered;
          return (
            <tr key={r.id} className={r.depth ? "sub" : "top"} onClick={() => onOpen(r)}>
              <td style={{ paddingLeft: 10 + r.depth * 18 }} title={r.sublabel ? `${r.label} — ${r.sublabel}` : r.label}>
                <span className="plabel">{r.label}</span>
                {r.sublabel && <span className="faint"> — {r.sublabel}</span>}
              </td>
              <td className="num">{r.total}</td>
              {STATUSES.map((s) => (
                <td key={s} className="num faint-zero">
                  {r.counts[s] || ""}
                </td>
              ))}
              <td className="num">{r.total ? `${Math.round((done / r.total) * 100)}%` : "—"}</td>
              <td>
                <Bar row={r} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ProgressView() {
  const problems = useStore((s) => s.problems);
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const topics = useStore((s) => s.topics);
  const [tab, setTab] = useState<"courses" | "topics">("courses");
  const live = useMemo(() => problems.filter((p) => !p.deletedAt), [problems]);
  const totals = countStatuses(live);
  const today = todayLocal();
  const due = reviewGroups(live, today).find((g) => g.key === "due")?.problems.length ?? 0;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = live.filter((p) => p.lastAttemptAt && p.lastAttemptAt >= monthAgo).length;
  const done = totals.completed + totals.mastered;
  const byCourse = useMemo(() => progressByCourse(problems, courses, lectures), [problems, courses, lectures]);
  const byTopic = useMemo(() => progressByTopic(problems, topics), [problems, topics]);

  const open = (r: ProgressRow) => {
    if (r.id === "__none__") return A.showUnassigned();
    if (courses.some((c) => c.id === r.id)) return A.showCourse(r.id);
    if (lectures.some((l) => l.id === r.id)) return A.showLecture(r.id);
    if (topics.some((x) => x.id === r.id)) return A.showTopic(r.id);
  };

  return (
    <div className="doc-view">
      <div className="doc-inner">
        <h1 className="doc-title">{t("Progress")}</h1>
        <div className="stats">
          <div className="stat">
            <div className="v">{live.length}</div>
            <div className="k">{t("problems in the library")}</div>
          </div>
          <div className="stat">
            <div className="v">{live.length ? Math.round((done / live.length) * 100) : 0}%</div>
            <div className="k">{t("completed or mastered")}</div>
          </div>
          <div className="stat">
            <div className="v">{totals.needs_review}</div>
            <div className="k">{t("marked Needs Review")}</div>
          </div>
          <div className="stat">
            <div className="v">{due}</div>
            <div className="k">{t("reviews due")}</div>
          </div>
          <div className="stat">
            <div className="v">{recent}</div>
            <div className="k">{t("worked on in the last 30 days")}</div>
          </div>
        </div>
        <div className="legend">
          {STATUSES.map((s) => (
            <span key={s}>
              <StatusIcon status={s} size={12} /> {t(STATUS_LABEL[s])} <span className="faint">{totals[s]}</span>
            </span>
          ))}
        </div>
        <div className="seg" style={{ margin: "18px 0 10px" }}>
          <button className={tab === "courses" ? "on" : ""} onClick={() => setTab("courses")}>
            {t("By course and lecture")}
          </button>
          <button className={tab === "topics" ? "on" : ""} onClick={() => setTab("topics")}>
            {t("By topic")}
          </button>
        </div>
        {tab === "courses" ? (
          byCourse.length ? <Table rows={byCourse} onOpen={open} /> : <p className="muted">{t("No courses yet.")}</p>
        ) : byTopic.length ? (
          <Table rows={byTopic} onOpen={open} />
        ) : (
          <p className="muted">{t("No topics yet.")}</p>
        )}
      </div>
    </div>
  );
}
