import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Copy,
  FileText,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  X,
} from "lucide-react";
import { useStore, get } from "../state/store";
import * as A from "../state/actions";
import { SOURCE_KINDS, type Category, type SourceKind } from "../data/types";
import { CATEGORY_LABEL, DIFFICULTY_LABEL, PRIORITY_LABEL } from "../domain/status";
import { courseLabel, lectureLabel } from "../domain/filters";
import { withVariant, type DocPlan } from "../import/pipeline";
import type { Candidate } from "../import/types";
import { plainText } from "../math/segments";
import { checkLatex } from "../math/render";
import { MathEditor } from "./MathEditor";
import { PdfViewer } from "./PdfViewer";
import { TagPicker } from "../ui/TagPicker";
import { openMenuBelow } from "../ui/Menu";
import { platform } from "../platform";
import { t } from "../i18n";

const KIND_LABEL: Record<SourceKind, string> = {
  "lecture-notes": "Lecture notes",
  "problem-set": "Problem set",
  assignment: "Assignment",
  textbook: "Textbook",
  exam: "Exam",
  article: "Article",
  web: "Web page",
  manual: "Manual entry",
  other: "Other",
};

const FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  markdown: "Markdown",
  latex: "LaTeX",
  text: "Text",
  docx: "Word",
  json: "JSON",
  image: "Image",
};

function reliabilityText(r: DocPlan["doc"]["reliability"]): string {
  if (r === "exact") return t("Mathematics preserved exactly");
  if (r === "structured") return t("Equations converted from Word");
  return t("Extracted text — check formulas");
}

function candidateLabel(c: Candidate): string {
  const head = c.number ? `${t("Problem")} ${c.number}` : "";
  const body = c.title || plainText(c.statement || c.parts[0]?.statement || "").slice(0, 70);
  return head && body ? `${head} · ${body}` : head || body || t("(empty)");
}

function DocSettings({ importId, plan }: { importId: string; plan: DocPlan }) {
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const [open, setOpen] = useState(true);
  const update = (fn: (p: DocPlan) => DocPlan) => A.updatePlan(importId, plan.key, fn);
  const courseLectures = lectures.filter((l) => l.courseId === plan.courseId);
  const newTopics = plan.newTopicNames;

  return (
    <div className="iw-card">
      <button className="iw-card-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t("Source and classification")}</span>
        <span className="faint ellipsis grow" style={{ textAlign: "right" }} title={plan.fileName}>
          {plan.fileName}
        </span>
      </button>
      {open && (
        <div className="iw-card-body">
          {plan.existingSources.length > 0 && (
            <div className="iw-warning">
              <CircleAlert size={15} />
              <div className="grow">
                <strong>{t("This file was imported before")}</strong>
                <div className="muted">
                  {plan.existingSources.map((s) => `${s.title}${s.importedAt ? ` (${A.formatDate(s.importedAt)})` : ""}`).join("; ")}
                </div>
              </div>
              <div className="seg">
                <button className={plan.skip ? "on" : ""} onClick={() => update((p) => ({ ...p, skip: true }))}>
                  {t("Skip file")}
                </button>
                <button className={!plan.skip ? "on" : ""} onClick={() => update((p) => ({ ...p, skip: false }))}>
                  {t("Import new problems only")}
                </button>
              </div>
            </div>
          )}
          <div className="fields-2">
            <div className="field">
              <label>{t("Source title")}</label>
              <input className="input" value={plan.sourceTitle} onChange={(e) => update((p) => ({ ...p, sourceTitle: e.target.value }))} />
            </div>
            <div className="field">
              <label>{t("Source type")}</label>
              <select className="select" value={plan.sourceKind} onChange={(e) => update((p) => ({ ...p, sourceKind: e.target.value as SourceKind }))}>
                {SOURCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(KIND_LABEL[k])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>{t("Course")}</label>
            <div className="row">
              <select
                className="select grow"
                value={plan.courseId ?? (plan.newCourse ? "__new" : "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__new") update((p) => A.setPlanCourseSync(p, null, { code: p.newCourse?.code ?? "", title: p.newCourse?.title ?? "" }));
                  else A.setPlanCourse(importId, plan.key, v || null);
                }}
              >
                <option value="">{t("No course")}</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {courseLabel(c)}
                  </option>
                ))}
                <option value="__new">{t("New course…")}</option>
              </select>
            </div>
            {!plan.courseId && plan.newCourse && (
              <div className="fields-2" style={{ marginTop: 6 }}>
                <input
                  className="input"
                  placeholder={t("Code, e.g. MATH 147")}
                  value={plan.newCourse.code}
                  onChange={(e) => update((p) => ({ ...p, newCourse: { ...p.newCourse!, code: e.target.value } }))}
                />
                <input
                  className="input"
                  placeholder={t("Title, e.g. Advanced Calculus")}
                  value={plan.newCourse.title}
                  onChange={(e) => update((p) => ({ ...p, newCourse: { ...p.newCourse!, title: e.target.value } }))}
                />
              </div>
            )}
            {plan.courseReason && <span className="hint">{t(plan.courseReason)}</span>}
          </div>
          {plan.lectureMap.length > 0 && (
            <div className="field">
              <label>{t("Lectures detected in the document")}</label>
              <table className="iw-map">
                <tbody>
                  {plan.lectureMap.map((m) => (
                    <tr key={m.ref}>
                      <td className="nowrap">
                        {t("Lecture")} {m.ref}
                        {m.title && <span className="faint"> — {m.title}</span>}
                      </td>
                      <td className="faint nowrap">{t("{n} problems", { n: m.count })}</td>
                      <td>
                        <select
                          className="select"
                          value={m.lectureId ?? (m.create ? "__create" : "")}
                          onChange={(e) => {
                            const v = e.target.value;
                            update((p) => {
                              const lectureMap = p.lectureMap.map((x) =>
                                x.ref === m.ref ? { ...x, lectureId: v && v !== "__create" ? v : null, create: v === "__create" } : x,
                              );
                              const fallback = p.fileLectureRefs.length === 1 ? p.fileLectureRefs[0] : null;
                              const old = m.lectureId;
                              const candidates = p.candidates.map((c) => {
                                if ((c.lectureRef ?? fallback) !== m.ref) return c;
                                const ids = c.lectureIds.filter((id) => id !== old);
                                return { ...c, lectureIds: v && v !== "__create" ? [...ids, v] : ids };
                              });
                              return { ...p, lectureMap, candidates };
                            });
                          }}
                        >
                          <option value="">{t("Don’t assign")}</option>
                          {(plan.courseId || plan.newCourse) && (
                            <option value="__create">
                              {t("Create “Lecture {n}{title}”", { n: m.ref, title: m.title ? ` — ${m.title}` : "" })}
                            </option>
                          )}
                          {courseLectures.map((l) => (
                            <option key={l.id} value={l.id}>
                              {lectureLabel(l)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {newTopics.length > 0 && (
            <div className="field">
              <label>{t("Suggested new topics")}</label>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {newTopics.map((nt) => (
                  <label key={nt.name} className={`chip static${nt.accept ? " accent" : ""}`} style={{ cursor: "default" }}>
                    <input
                      type="checkbox"
                      checked={nt.accept}
                      style={{ accentColor: "var(--accent)", margin: "0 4px 0 0" }}
                      onChange={(e) => update((p) => ({ ...p, newTopicNames: p.newTopicNames.map((x) => (x.name === nt.name ? { ...x, accept: e.target.checked } : x)) }))}
                    />
                    {nt.name} <span className="faint">({nt.count})</span>
                  </label>
                ))}
              </div>
              <span className="hint">{t("Checked topics are created and attached to the problems that mention them.")}</span>
            </div>
          )}
          {plan.doc.warnings.length > 0 && (
            <ul className="iw-notes">
              {plan.doc.warnings.map((w) => (
                <li key={w}>{t(w)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateEditor({
  importId,
  plan,
  c,
  onNavigate,
  position,
}: {
  importId: string;
  plan: DocPlan;
  c: Candidate;
  onNavigate: (delta: -1 | 1) => void;
  position: { index: number; total: number };
}) {
  const topics = useStore((s) => s.topics);
  const lectures = useStore((s) => s.lectures);
  const [picker, setPicker] = useState<"topics" | "lectures" | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const topicBtn = useRef<HTMLButtonElement>(null);
  const lecBtn = useRef<HTMLButtonElement>(null);
  const patch = (p: Partial<Candidate>) => A.updateCandidate(importId, plan.key, c.key, p);
  const pdf = plan.doc.format === "pdf";
  const errors = useMemo(() => checkLatex([c.statement, ...c.parts.map((x) => x.statement)].join("\n\n")), [c.statement, c.parts]);
  const hasParts = c.plain.parts.length > 0;

  const setVariant = (assisted: boolean, split: boolean) => {
    const apply = () =>
      A.updatePlan(importId, plan.key, (p) => ({ ...p, candidates: p.candidates.map((x) => (x.key === c.key ? withVariant(x, assisted, split) : x)) }));
    const edited = c.statement !== withVariant(c, c.usingAssisted, c.splitParts).statement;
    if (!edited) return apply();
    A.confirmDialog({
      title: t("Replace your edits?"),
      message: t("The statement is regenerated from the extracted text, so your corrections to this problem are lost."),
      confirmLabel: t("Replace"),
      onConfirm: apply,
    });
  };

  return (
    <div className="iw-card">
      <div className="iw-card-head" style={{ cursor: "default" }}>
        <div className="iw-nav grow">
          <button className="btn btn-sm btn-ghost" disabled={position.index === 0} onClick={() => onNavigate(-1)} title={t("Previous problem (Alt+↑)")}>
            <ChevronUp size={13} />
          </button>
          <button className="btn btn-sm btn-ghost" disabled={position.index >= position.total - 1} onClick={() => onNavigate(1)} title={t("Next problem (Alt+↓)")}>
            <ChevronDown size={13} />
          </button>
          <span className="title">{c.number ? `${t("Problem")} ${c.number}` : t("Problem")}</span>
          <span className="faint">
            {t("{i} of {n}", { i: position.index + 1, n: position.total })}
            {c.section ? ` · ${c.section}` : ""}
          </span>
        </div>
      </div>
      <div className="iw-card-body">
        <div className="row">
          <label className="checkbox">
            <input type="checkbox" checked={c.include} onChange={(e) => patch({ include: e.target.checked })} />
            {t("Import this problem")}
          </label>
          <span className="grow" />
          <span className={`badge ${c.confidence === "high" ? "" : "warn"}`} title={t("How clearly the problem boundaries were detected")}>
            {t("{level} confidence", { level: t(c.confidence) })}
          </span>
          {c.page && <span className="badge">{t("page {n}", { n: c.page })}</span>}
        </div>
        {c.duplicateOf && (
          <div className="iw-warning">
            <Copy size={15} />
            <div className="grow">
              {t("Looks like an existing problem: {label} ({pct}% match)", { label: c.duplicateOf.label, pct: Math.round(c.duplicateOf.similarity * 100) })}
            </div>
            <button className="btn btn-sm" onClick={() => A.openProblem(c.duplicateOf!.id, { preview: true, group: get().groups.length > 1 ? 1 : 0 })}>
              {t("Open existing")}
            </button>
          </div>
        )}
        <div className="fields-2" style={{ gridTemplateColumns: "110px 1fr" }}>
          <div className="field">
            <label>{t("Number")}</label>
            <input className="input" value={c.number} onChange={(e) => patch({ number: e.target.value })} />
          </div>
          <div className="field">
            <label>{t("Title (optional)")}</label>
            <input className="input" value={c.title} onChange={(e) => patch({ title: e.target.value })} />
          </div>
        </div>
        {c.flags.length > 0 && (
          <div className={`iw-flags${c.reviewed ? " done" : ""}`}>
            <div className="row">
              <AlertTriangle size={14} />
              <strong className="grow">{c.reviewed ? t("Checked") : t("Please check")}</strong>
              <label className="checkbox">
                <input type="checkbox" checked={c.reviewed} onChange={(e) => patch({ reviewed: e.target.checked })} />
                {t("Text checked against the source")}
              </label>
            </div>
            <ul>
              {c.flags.map((f) => (
                <li key={f.code}>{t(f.message)}</li>
              ))}
            </ul>
          </div>
        )}
        {(pdf || hasParts) && (
          <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
            {pdf && c.assistedStatement !== null && (
              <label className="checkbox" title={t("Converts symbols, sub- and superscripts in the PDF text into LaTeX. The result must be checked.")}>
                <input type="checkbox" checked={c.usingAssisted} onChange={(e) => setVariant(e.target.checked, c.splitParts)} />
                <Sparkles size={13} /> {t("Assisted LaTeX conversion")}
              </label>
            )}
            {hasParts && (
              <label className="checkbox">
                <input type="checkbox" checked={c.splitParts} onChange={(e) => setVariant(c.usingAssisted, e.target.checked)} />
                {t("Separate parts ({labels}) with their own status", { labels: c.plain.parts.map((p) => p.label).join(", ") })}
              </label>
            )}
          </div>
        )}
        <div className="field">
          <label>
            {t("Statement")}
            {errors.length > 0 && <span className="mx-errors"> · {t("{n} formula error(s)", { n: errors.length })}</span>}
          </label>
          <MathEditor
            key={`${c.key}-${c.usingAssisted}-${c.splitParts}`}
            value={c.statement}
            onChange={(v) => patch({ statement: v, reviewed: true })}
            minHeight={140}
            label={t("Statement")}
          />
        </div>
        {c.splitParts &&
          c.parts.map((part, i) => (
            <div className="field" key={`${c.key}-part-${i}-${c.usingAssisted}`}>
              <label>
                {t("Part")} ({part.label})
              </label>
              <MathEditor
                value={part.statement}
                onChange={(v) => patch({ parts: c.parts.map((x, j) => (j === i ? { ...x, statement: v } : x)), reviewed: true })}
                minHeight={90}
                label={t("Part statement")}
              />
            </div>
          ))}
        {c.referenceSolution && (
          <div className="field">
            <label>{t("Solution found in the document (stored as the reference solution)")}</label>
            <MathEditor value={c.referenceSolution} onChange={(v) => patch({ referenceSolution: v })} minHeight={90} mode="preview" />
          </div>
        )}
        <div className="iw-classify">
          <div className="meta-line">
            <span className="meta-key">{t("Lectures")}</span>
            <div className="meta-chips">
              {c.lectureIds.map((id) => {
                const l = lectures.find((x) => x.id === id);
                return (
                  <span key={id} className="chip">
                    <span className="label">{l ? lectureLabel(l) : t("(new lecture)")}</span>
                    <button className="x" onClick={() => patch({ lectureIds: c.lectureIds.filter((x) => x !== id) })}>
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
              {c.lectureRef && !c.lectureIds.length && plan.lectureMap.find((m) => m.ref === c.lectureRef)?.create && (
                <span className="chip static accent">
                  {t("Lecture {n} (new)", { n: c.lectureRef })}
                </span>
              )}
              <button ref={lecBtn} className="chip add" onClick={() => setPicker("lectures")}>
                +
              </button>
            </div>
          </div>
          <div className="meta-line">
            <span className="meta-key">{t("Topics")}</span>
            <div className="meta-chips">
              {c.topicIds.map((id) => (
                <span key={id} className="chip">
                  <span className="label">{topics.find((x) => x.id === id)?.name ?? "?"}</span>
                  <button className="x" onClick={() => patch({ topicIds: c.topicIds.filter((x) => x !== id) })}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {c.suggestedTopicNames
                .filter((n) => plan.newTopicNames.find((x) => x.name === n)?.accept)
                .map((n) => (
                  <span key={n} className="chip static accent">
                    {n} ({t("new")})
                  </span>
                ))}
              <button ref={topicBtn} className="chip add" onClick={() => setPicker("topics")}>
                +
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <select className="select" value={c.category ?? ""} onChange={(e) => patch({ category: (e.target.value || null) as Category | null })}>
              <option value="">{t("Type: not set")}</option>
              {(["proof", "calculation", "conceptual", "application"] as Category[]).map((x) => (
                <option key={x} value={x}>
                  {t(CATEGORY_LABEL[x])}
                </option>
              ))}
            </select>
            <select className="select" value={c.difficulty ?? ""} onChange={(e) => patch({ difficulty: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("Difficulty: not set")}</option>
              {[1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {d} — {t(DIFFICULTY_LABEL[d])}
                </option>
              ))}
            </select>
            <select className="select" value={c.priority} onChange={(e) => patch({ priority: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {t("Priority: {p}", { p: t(PRIORITY_LABEL[n]) })}
                </option>
              ))}
            </select>
          </div>
        </div>
        {c.rawText && (
          <div>
            <button className="link-btn" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {t("Original extracted text (kept as provenance)")}
            </button>
            {showRaw && <pre className="raw-excerpt selectable">{c.rawText}</pre>}
          </div>
        )}
      </div>
      {picker === "topics" && (
        <TagPicker
          anchor={topicBtn.current}
          options={topics.map((tp) => ({ id: tp.id, label: tp.name }))}
          selected={c.topicIds}
          onToggle={(id, on) => patch({ topicIds: on ? [...c.topicIds, id] : c.topicIds.filter((x) => x !== id) })}
          onCreate={async (name) => {
            const tp = await A.createTopic({ name });
            patch({ topicIds: [...c.topicIds, tp.id] });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "lectures" && (
        <TagPicker
          anchor={lecBtn.current}
          options={lectures
            .filter((l) => !plan.courseId || l.courseId === plan.courseId)
            .map((l) => ({ id: l.id, label: lectureLabel(l) }))}
          selected={c.lectureIds}
          onToggle={(id, on) => patch({ lectureIds: on ? [...c.lectureIds, id] : c.lectureIds.filter((x) => x !== id) })}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

export function ImportView({ importId }: { importId: string }) {
  const sess = useStore((s) => s.imports[importId]);
  const [showPdf, setShowPdf] = useState(true);
  if (!sess) {
    return <div className="empty-state">{t("This import session has ended.")}</div>;
  }
  if (sess.status === "reading" || sess.status === "committing") {
    return (
      <div className="empty-state">
        <Loader2 size={22} className="spin" />
        <div className="title">{sess.status === "reading" ? t("Reading documents") : t("Saving")}</div>
        <p>{sess.progress}</p>
      </div>
    );
  }
  if (sess.status === "done" && sess.result) {
    const r = sess.result;
    return (
      <div className="home">
        <div className="home-inner">
          <div className="iw-done-mark">
            <Check size={22} />
          </div>
          <div>
            <h2 className="iw-title">{t("Imported {n} problem(s)", { n: r.problemIds.length })}</h2>
            <p className="muted">
              {[
                r.createdCourses ? t("{n} course(s) created", { n: r.createdCourses }) : "",
                r.createdLectures ? t("{n} lecture(s) created", { n: r.createdLectures }) : "",
                r.createdTopics ? t("{n} topic(s) created", { n: r.createdTopics }) : "",
              ]
                .filter(Boolean)
                .join(" · ") || t("Original files are stored in your library.")}
            </p>
          </div>
          <div className="row">
            {r.sourceIds.length === 1 && (
              <button className="btn btn-primary" onClick={() => A.showSource(r.sourceIds[0])}>
                {t("Show imported problems")}
              </button>
            )}
            {r.problemIds[0] && (
              <button className="btn" onClick={() => A.openProblem(r.problemIds[0])}>
                {t("Open the first problem")}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => A.pickAndImport()}>
              {t("Import more…")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const plan = sess.plans.find((p) => p.key === sess.activePlan) ?? sess.plans[0];
  const cand = sess.activeCandidate ? plan?.candidates.find((c) => c.key === sess.activeCandidate) : undefined;
  const candIndex = cand && plan ? plan.candidates.indexOf(cand) : -1;
  const navigate = (delta: -1 | 1) => {
    if (!plan) return;
    const next = plan.candidates[Math.max(0, Math.min(plan.candidates.length - 1, candIndex + delta))];
    if (next) A.importPatch(importId, { activeCandidate: next.key });
  };
  const included = sess.plans.reduce((n, p) => n + (p.skip ? 0 : p.candidates.filter((c) => c.include).length), 0);
  const unchecked = sess.plans.reduce((n, p) => n + (p.skip ? 0 : p.candidates.filter((c) => c.include && c.flags.some((f) => f.code !== "possible-duplicate") && !c.reviewed).length), 0);
  const select = (planKey: string, candKey: string | null) => A.importPatch(importId, { activePlan: planKey, activeCandidate: candKey });
  const pdfPlan = plan && plan.doc.format === "pdf" && (plan.bytes || plan.path) ? plan : null;

  const bulk = (fn: (c: Candidate) => Candidate) => plan && A.updatePlan(importId, plan.key, (p) => ({ ...p, candidates: p.candidates.map(fn) }));

  return (
    <div
      className="iw"
      onKeyDown={(e) => {
        if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          navigate(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <div className="iw-head">
        <div>
          <h2 className="iw-title">{t("Import")}</h2>
          <div className="muted">
            {t("{docs} document(s) · {n} problem(s) selected", { docs: sess.plans.length, n: included })}
            {unchecked > 0 && <span className="warn-text"> · {t("{n} not yet checked", { n: unchecked })}</span>}
          </div>
        </div>
        <span className="grow" />
        {pdfPlan && (
          <button className="icon-btn" title={showPdf ? t("Hide source page") : t("Show source page")} onClick={() => setShowPdf(!showPdf)}>
            {showPdf ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => A.closeTab(get().activeGroup, `import:${importId}`)}>
          {t("Cancel")}
        </button>
        <button className="btn btn-primary" disabled={!included} onClick={() => A.commitImport(importId)}>
          {t("Import {n} problem(s)", { n: included })} <ArrowRight size={14} />
        </button>
      </div>
      {sess.errors.length > 0 && (
        <div className="iw-errors">
          {sess.errors.map((e) => (
            <div key={e.name} className="iw-warning">
              <CircleAlert size={15} />
              <strong>{e.name}</strong>
              <span className="muted">{e.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className={`iw-body${pdfPlan && showPdf ? " with-pdf" : ""}`}>
        <aside className="iw-list">
          {sess.plans.map((p) => (
            <div key={p.key} className={`iw-doc${p.skip ? " skipped" : ""}`}>
              <button className={`iw-doc-head${plan?.key === p.key && !sess.activeCandidate ? " active" : ""}`} onClick={() => select(p.key, null)}>
                <FileText size={14} />
                <span className="ellipsis grow" title={p.fileName}>
                  {p.fileName}
                </span>
                <span className="badge">{FORMAT_LABEL[p.doc.format] ?? p.doc.format}</span>
              </button>
              <div className="iw-doc-sub faint">
                {reliabilityText(p.doc.reliability)} · {t("{n} found", { n: p.candidates.length })}
                {p.skip && ` · ${t("skipped")}`}
              </div>
              {!p.skip &&
                p.candidates.map((c) => (
                  <div key={c.key} className={`iw-cand${cand?.key === c.key && plan?.key === p.key && sess.activeCandidate ? " active" : ""}${c.include ? "" : " excluded"}`}>
                    <input
                      type="checkbox"
                      checked={c.include}
                      aria-label={t("Include")}
                      onChange={(e) => A.updateCandidate(importId, p.key, c.key, { include: e.target.checked })}
                    />
                    <button className="iw-cand-label" onClick={() => select(p.key, c.key)} title={candidateLabel(c)}>
                      <span className="ellipsis">{candidateLabel(c)}</span>
                    </button>
                    {c.duplicateOf && <Copy size={12} className="faint" aria-label={t("Possible duplicate")} />}
                    {c.flags.some((f) => f.code !== "possible-duplicate") && !c.reviewed && <AlertTriangle size={12} className="warn-icon" aria-label={t("Needs checking")} />}
                    {c.reviewed && c.flags.length > 0 && <Check size={12} className="ok-icon" aria-label={t("Checked")} />}
                  </div>
                ))}
            </div>
          ))}
        </aside>
        <main className="iw-main">
          {plan && (
            <>
              {!cand && <DocSettings importId={importId} plan={plan} />}
              {!cand && !plan.skip && plan.candidates.length > 0 && (
                <div className="row">
                  <button className="btn btn-primary" onClick={() => A.importPatch(importId, { activeCandidate: plan.candidates[0].key })}>
                    {t("Review the {n} problem(s)", { n: plan.candidates.length })} <ArrowRight size={14} />
                  </button>
                  <span className="muted">{t("Check the text of each problem against the source page, or import directly.")}</span>
                </div>
              )}
              {!cand && !plan.skip && plan.candidates.length > 1 && (
                <div className="iw-bulk">
                  <span className="faint">{t("All problems in this document:")}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => bulk((c) => ({ ...c, include: true }))}>
                    {t("Include all")}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => bulk((c) => ({ ...c, include: false }))}>
                    {t("Exclude all")}
                  </button>
                  {plan.doc.format === "pdf" && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={(e) =>
                        openMenuBelow(e.currentTarget, [
                          { label: t("Use assisted LaTeX for all"), onSelect: () => bulk((c) => withVariant(c, true, c.splitParts)) },
                          { label: t("Use plain extracted text for all"), onSelect: () => bulk((c) => withVariant(c, false, c.splitParts)) },
                        ])
                      }
                    >
                      <Sparkles size={12} /> {t("Text version…")}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={(e) =>
                      openMenuBelow(e.currentTarget, [
                        ...get().topics.map((tp) => ({ label: tp.name, onSelect: () => bulk((c) => (c.include && !c.topicIds.includes(tp.id) ? { ...c, topicIds: [...c.topicIds, tp.id] } : c)) })),
                      ])
                    }
                    disabled={!get().topics.length}
                  >
                    {t("Add topic…")}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={(e) =>
                      openMenuBelow(e.currentTarget, [1, 2, 3, 4].map((d) => ({ label: `${d} — ${t(DIFFICULTY_LABEL[d])}`, onSelect: () => bulk((c) => (c.include ? { ...c, difficulty: d } : c)) })))
                    }
                  >
                    {t("Set difficulty…")}
                  </button>
                </div>
              )}
              {!plan.skip && cand && (
                <CandidateEditor importId={importId} plan={plan} c={cand} onNavigate={navigate} position={{ index: candIndex, total: plan.candidates.length }} />
              )}
              {!plan.skip && !plan.candidates.length && <div className="empty-state">{t("No problems were found in this document.")}</div>}
            </>
          )}
        </main>
        {pdfPlan && showPdf && (
          <aside className="iw-pdf">
            <PdfViewer
              key={pdfPlan.key}
              load={async () => pdfPlan.bytes ?? (await (await platform().readPaths!([pdfPlan.path!]))[0].read())}
              page={cand?.page ?? 1}
              nonce={candIndex}
              compact
            />
          </aside>
        )}
      </div>
    </div>
  );
}
