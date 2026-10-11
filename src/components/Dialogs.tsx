import { useEffect, useState } from "react";
import { PhoneDialog } from "./PhoneDialog";
import { useStore, get } from "../state/store";
import * as A from "../state/actions";
import { Dialog } from "../ui/Dialog";
import { SOURCE_KINDS, type SourceKind } from "../data/types";
import { courseLabel, topicWithDescendants } from "../domain/filters";
import { todayLocal } from "../data/ids";
import { DEFAULT_EXPORT, type ExportOptions } from "../export/documents";
import { summarizeLibraryImport, type ImportSummary } from "../export/library-json";
import { printProblems } from "./print";
import { BrandGlyph, WaveRule } from "../ui/icons";
import { fmtDateTime, t } from "../i18n";

function CourseDialog({ courseId }: { courseId?: string }) {
  const c = useStore((s) => (courseId ? s.index.courses.get(courseId) : undefined));
  const [code, setCode] = useState(c?.code ?? "");
  const [title, setTitle] = useState(c?.title ?? "");
  const [term, setTerm] = useState(c?.term ?? "");
  const [description, setDescription] = useState(c?.description ?? "");
  const [lectures, setLectures] = useState("");
  const submit = async () => {
    if (!code.trim() && !title.trim()) return;
    if (c) await A.updateCourse(c.id, { code: code.trim(), title: title.trim(), term, description });
    else {
      const id = await A.createCourse({ code, title, term, description });
      const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(lectures.trim());
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (b >= a && b - a <= 60) await A.createLectures(Array.from({ length: b - a + 1 }, (_, i) => ({ courseId: id, number: String(a + i) })));
      }
      A.showCourse(id);
    }
    A.closeDialog();
  };
  return (
    <Dialog
      title={c ? t("Edit course") : t("New course")}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!code.trim() && !title.trim()}>
            {c ? t("Save") : t("Create course")}
          </button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="fields-2" style={{ gridTemplateColumns: "140px 1fr" }}>
          <div className="field">
            <label>{t("Code")}</label>
            <input className="input" autoFocus placeholder="MATH 147" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("Title")}</label>
            <input className="input" placeholder={t("Advanced Calculus")} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>{t("Term (optional)")}</label>
          <input className="input" placeholder={t("Fall 2026")} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {!c && (
          <div className="field">
            <label>{t("Lectures (optional)")}</label>
            <input className="input" placeholder={t("e.g. 1-12")} value={lectures} onChange={(e) => setLectures(e.target.value)} />
            <span className="hint">{t("A range creates numbered lectures; titles can be added later.")}</span>
          </div>
        )}
        <div className="field">
          <label>{t("Description (optional)")}</label>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function LectureDialog({ lectureId, courseId }: { lectureId?: string; courseId?: string }) {
  const l = useStore((s) => (lectureId ? s.index.lectures.get(lectureId) : undefined));
  const courses = useStore((s) => s.courses);
  const [course, setCourse] = useState(l?.courseId ?? courseId ?? courses[0]?.id ?? "");
  const [number, setNumber] = useState(l?.number ?? "");
  const [title, setTitle] = useState(l?.title ?? "");
  const [date, setDate] = useState(l?.date ?? "");
  const [description, setDescription] = useState(l?.description ?? "");
  const submit = async () => {
    if (!course) return;
    if (l) await A.updateLecture(l.id, { number: number.trim(), title: title.trim(), date: date || null, description, courseId: course });
    else await A.createLectures([{ courseId: course, number: number.trim(), title: title.trim(), date: date || null, description }]);
    A.closeDialog();
  };
  return (
    <Dialog
      title={l ? t("Edit lecture") : t("New lecture")}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t("Save")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("Course")}</label>
        <select className="select" value={course} onChange={(e) => setCourse(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {courseLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="fields-2" style={{ gridTemplateColumns: "90px 1fr" }}>
        <div className="field">
          <label>{t("Number")}</label>
          <input className="input" autoFocus value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("Title")}</label>
          <input className="input" placeholder={t("Monotone Sequences")} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
      </div>
      <div className="field">
        <label>{t("Date (optional)")}</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("Description (optional)")}</label>
        <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Dialog>
  );
}

/** Parses "7-12", "7, 8, 9" or lines like "7 Convergence and Boundedness" / "Lecture 8 — Algebra of Limits". */
export function parseLectureSpec(text: string): { number: string; title: string }[] {
  const s = text.trim();
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (b < a || b - a > 80) return [];
    return Array.from({ length: b - a + 1 }, (_, i) => ({ number: String(a + i), title: "" }));
  }
  if (/^[\d\s,]+$/.test(s)) return s.split(/[\s,]+/).filter(Boolean).map((n) => ({ number: n, title: "" }));
  return s
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(?:lecture|lec\.?|l)?\s*(\d+[a-z]?)\s*[.:)\-–—]*\s*(.*)$/i.exec(line);
      return m ? { number: m[1], title: m[2].trim() } : { number: "", title: line };
    });
}

function LecturesBulkDialog({ courseId }: { courseId: string }) {
  const course = useStore((s) => s.index.courses.get(courseId));
  const existing = useStore((s) => s.lectures.filter((l) => l.courseId === courseId).map((l) => l.number).join(","));
  const [text, setText] = useState("");
  const parsed = parseLectureSpec(text);
  const have = new Set(existing.split(","));
  const fresh = parsed.filter((p) => !p.number || !have.has(p.number));
  const submit = async () => {
    if (!fresh.length) return;
    await A.createLectures(fresh.map((p) => ({ courseId, number: p.number, title: p.title })));
    A.closeDialog();
  };
  return (
    <Dialog
      title={t("Add lectures to {course}", { course: course ? course.code || course.title : "" })}
      onClose={A.closeDialog}
      footer={
        <>
          <span className="muted grow">{fresh.length ? t("{n} lecture(s) will be added", { n: fresh.length }) : ""}</span>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!fresh.length}>
            {t("Add lectures")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("Lectures")}</label>
        <textarea
          className="textarea"
          autoFocus
          rows={6}
          placeholder={"7-12\n\n" + t("or one per line:") + "\n7 Convergence and Boundedness\n8 Algebra of Limits"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="hint">{t("Enter a range such as 7-12, a list of numbers, or one lecture per line with its title. Existing lecture numbers are skipped.")}</span>
      </div>
      {fresh.length > 0 && (
        <div className="bulk-preview">
          {fresh.slice(0, 12).map((p, i) => (
            <div key={i}>
              {p.number ? `${t("Lecture")} ${p.number}` : ""} {p.title && <span className="muted">— {p.title}</span>}
            </div>
          ))}
          {fresh.length > 12 && <div className="faint">… {t("and {n} more", { n: fresh.length - 12 })}</div>}
        </div>
      )}
    </Dialog>
  );
}

function TopicDialog({ topicId, parentId }: { topicId?: string; parentId?: string | null }) {
  const tp = useStore((s) => (topicId ? s.index.topics.get(topicId) : undefined));
  const topics = useStore((s) => s.topics);
  const [name, setName] = useState(tp?.name ?? "");
  const [parent, setParent] = useState<string>(tp?.parentId ?? parentId ?? "");
  const [keywords, setKeywords] = useState(tp?.keywords ?? "");
  const [description, setDescription] = useState(tp?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const banned = tp ? new Set(topicWithDescendants(tp.id, topics)) : new Set<string>();
  const submit = async () => {
    if (!name.trim()) return;
    try {
      if (tp) await A.updateTopic(tp.id, { name: name.trim(), parentId: parent || null, keywords, description });
      else await A.createTopic({ name: name.trim(), parentId: parent || null, keywords, description });
      A.closeDialog();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      title={tp ? t("Edit topic") : t("New topic")}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            {tp ? t("Save") : t("Create topic")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("Name")}</label>
        <input className="input" autoFocus placeholder={t("Cauchy Sequences")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <div className="field">
        <label>{t("Parent topic (optional)")}</label>
        <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">{t("None — top level")}</option>
          {topics
            .filter((x) => !banned.has(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </div>
      <div className="field">
        <label>{t("Aliases and keywords")}</label>
        <input className="input" placeholder={t("e.g. MCT, monotone convergence")} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <span className="hint">{t("Comma-separated. Used by search and by import suggestions.")}</span>
      </div>
      <div className="field">
        <label>{t("Description (optional)")}</label>
        <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {error && <div className="mx-errors">{error}</div>}
    </Dialog>
  );
}

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

function SourceDialog({ sourceId }: { sourceId: string }) {
  const src = useStore((s) => s.index.sources.get(sourceId));
  const courses = useStore((s) => s.courses);
  const [title, setTitle] = useState(src?.title ?? "");
  const [kind, setKind] = useState<SourceKind>(src?.kind ?? "other");
  const [author, setAuthor] = useState(src?.author ?? "");
  const [section, setSection] = useState(src?.section ?? "");
  const [url, setUrl] = useState(src?.url ?? "");
  const [courseId, setCourseId] = useState(src?.courseId ?? "");
  const [notes, setNotes] = useState(src?.notes ?? "");
  if (!src) return null;
  const submit = async () => {
    await A.updateSource(src.id, { title: title.trim() || src.title, kind, author, section, url, notes, courseId: courseId || null });
    A.closeDialog();
  };
  return (
    <Dialog
      title={t("Edit source")}
      wide
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t("Save")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("Title")}</label>
        <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="fields-2">
        <div className="field">
          <label>{t("Type")}</label>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABEL[k])}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("Course")}</label>
          <select className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">{t("None")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {courseLabel(c)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="fields-2">
        <div className="field">
          <label>{t("Author")}</label>
          <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("Textbook section")}</label>
          <input className="input" placeholder={t("e.g. §2.4")} value={section} onChange={(e) => setSection(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>{t("Link (optional)")}</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("Notes")}</label>
        <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="prov-grid faint" style={{ fontSize: 12 }}>
        {src.fileName && <div>{t("File")}: <span className="mono">{src.fileName}</span></div>}
        {src.importedAt && <div>{t("Imported")}: {fmtDateTime(src.importedAt)}</div>}
        {src.pageCount && <div>{t("Pages")}: {src.pageCount}</div>}
      </div>
    </Dialog>
  );
}

function ExportDialog({ problemIds, title }: { problemIds: string[]; title: string }) {
  const [format, setFormat] = useState<"md" | "tex" | "json" | "pdf">("md");
  const [opts, setOpts] = useState<ExportOptions>({ ...DEFAULT_EXPORT, title });
  const toggle = (k: keyof ExportOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const submit = async () => {
    A.closeDialog();
    if (format === "pdf") await printProblems(problemIds, opts.title, opts);
    else await A.exportProblems(problemIds, format, opts);
  };
  return (
    <Dialog
      title={t("Export {n} problem(s)", { n: problemIds.length })}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!problemIds.length}>
            {format === "pdf" ? t("Print…") : t("Export…")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("Format")}</label>
        <div className="seg">
          {(
            [
              ["md", "Markdown"],
              ["tex", "LaTeX"],
              ["json", "JSON"],
              ["pdf", "PDF (print)"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={format === k ? "on" : ""} onClick={() => setFormat(k)}>
              {t(label)}
            </button>
          ))}
        </div>
        <span className="hint">
          {
            {
              md: t("Markdown with the LaTeX of every formula preserved."),
              tex: t("A complete .tex document (amsmath, amsthm) including your macros."),
              json: t("Marée problem data with courses, lectures and topics; can be imported again."),
              pdf: t("Typeset with KaTeX and sent to the print dialog. Choose “Save as PDF”."),
            }[format]
          }
        </span>
      </div>
      <div className="field">
        <label>{t("Title")}</label>
        <input className="input" value={opts.title} onChange={(e) => setOpts({ ...opts, title: e.target.value })} />
      </div>
      {format !== "json" && (
        <div className="field">
          <label>{t("Include")}</label>
          <div className="col" style={{ gap: 6 }}>
            <label className="checkbox">
              <input type="checkbox" checked={opts.includeSolution} onChange={() => toggle("includeSolution")} /> {t("My solutions")}
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={opts.includeReference} onChange={() => toggle("includeReference")} /> {t("Reference solutions")}
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={opts.includeNotes} onChange={() => toggle("includeNotes")} /> {t("Notes")}
            </label>
            {format === "md" && (
              <label className="checkbox">
                <input type="checkbox" checked={opts.includeAttempts} onChange={() => toggle("includeAttempts")} /> {t("Attempt history")}
              </label>
            )}
            <label className="checkbox">
              <input type="checkbox" checked={opts.includeMetadata} onChange={() => toggle("includeMetadata")} /> {t("Course, lecture, topics and status")}
            </label>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SaveViewDialog({ viewId }: { viewId?: string }) {
  const v = useStore((s) => s.views.find((x) => x.id === viewId));
  const origin = useStore((s) => s.origin);
  const [name, setName] = useState(v?.name ?? (origin.kind === "view" ? origin.label : ""));
  const submit = async () => {
    if (!name.trim()) return;
    if (v) {
      // Renaming keeps the stored filter.
      await A.repo.saveView({ id: v.id, name: name.trim(), filter: v.filter, sort: v.sort });
      await A.reloadEntities();
    } else await A.saveView(name.trim());
    A.closeDialog();
  };
  return (
    <Dialog
      title={v ? t("Rename view") : t("Save view")}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            {t("Save")}
          </button>
        </>
      }
    >
      {!v && <p>{t("The current search, filters and sort order are saved and appear under Saved Views.")}</p>}
      <div className="field">
        <label>{t("Name")}</label>
        <input className="input" autoFocus placeholder={t("e.g. Unfinished Lecture 9")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </Dialog>
  );
}

function LibraryImportDialog({ lib, name, filesRestored }: Extract<ReturnType<typeof get>["dialog"], { kind: "library-import" }>) {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [mode, setMode] = useState<"keep" | "overwrite">("keep");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void summarizeLibraryImport(A.repo, lib).then(setSummary);
  }, [lib]);
  return (
    <Dialog
      title={t("Import library")}
      wide
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await A.applyLibraryImport(lib, mode);
                A.closeDialog();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t("Importing…") : t("Import")}
          </button>
        </>
      }
    >
      <p>
        <span className="mono">{name}</span> — {lib.app}, {fmtDateTime(lib.exportedAt)}
      </p>
      {summary && (
        <p className="muted">
          {t("{p} problems, {c} courses, {l} lectures, {tp} topics, {s} sources.", {
            p: summary.problems,
            c: summary.courses,
            l: summary.lectures,
            tp: summary.topics,
            s: summary.sources,
          })}{" "}
          {summary.existingProblems > 0 && t("{n} of the problems already exist in this library.", { n: summary.existingProblems })}
          {filesRestored !== undefined && ` ${t("{n} original file(s) restored.", { n: filesRestored })}`}
        </p>
      )}
      <div className="col" style={{ gap: 8 }}>
        <label className="checkbox">
          <input type="radio" name="mode" checked={mode === "keep"} onChange={() => setMode("keep")} />
          <span>
            <strong>{t("Merge")}</strong> — {t("add what is missing; items that already exist keep their current content.")}
          </span>
        </label>
        <label className="checkbox">
          <input type="radio" name="mode" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
          <span>
            <strong>{t("Restore")}</strong> — {t("items that exist in both are replaced by the version in the file.")}
          </span>
        </label>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        {t("Nothing is deleted. A snapshot of the current database is taken first.")}
      </p>
    </Dialog>
  );
}

function ReviewDateDialog({ problemIds }: { problemIds: string[] }) {
  const current = useStore((s) => (problemIds.length === 1 ? s.problems.find((p) => p.id === problemIds[0])?.reviewDue : null));
  const [date, setDate] = useState(current ?? todayLocal(7));
  return (
    <Dialog
      title={t("Schedule review")}
      onClose={A.closeDialog}
      footer={
        <>
          {current && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                void A.setReviewDate(problemIds, null);
                A.closeDialog();
              }}
            >
              {t("Clear date")}
            </button>
          )}
          <span className="grow" />
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              void A.setReviewDate(problemIds, date);
              A.closeDialog();
            }}
          >
            {t("Schedule")}
          </button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {[
          [t("Tomorrow"), 1],
          [t("3 days"), 3],
          [t("1 week"), 7],
          [t("2 weeks"), 14],
          [t("1 month"), 30],
        ].map(([label, d]) => (
          <button key={String(d)} className={`chip static${date === todayLocal(d as number) ? " accent" : ""}`} onClick={() => setDate(todayLocal(d as number))}>
            {label}
          </button>
        ))}
      </div>
      <div className="field">
        <label>{t("Date")}</label>
        <input className="input" type="date" autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Dialog>
  );
}

function DeleteCourseDialog({ courseId }: { courseId: string }) {
  const c = useStore((s) => s.index.courses.get(courseId));
  const n = useStore((s) => s.problems.filter((p) => p.courseId === courseId && !p.deletedAt).length);
  const lectures = useStore((s) => s.lectures.filter((l) => l.courseId === courseId).length);
  const [mode, setMode] = useState<"keep" | "trash">("keep");
  if (!c) return null;
  return (
    <Dialog
      title={t("Delete {name}?", { name: c.code || c.title })}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              A.closeDialog();
              await A.deleteCourse(courseId, mode);
            }}
          >
            {t("Delete course")}
          </button>
        </>
      }
    >
      <p>{t("The course and its {n} lecture(s) are deleted.", { n: lectures })}</p>
      {n > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <label className="checkbox">
            <input type="radio" checked={mode === "keep"} onChange={() => setMode("keep")} />
            {t("Keep its {n} problem(s) in the library without a course", { n })}
          </label>
          <label className="checkbox">
            <input type="radio" checked={mode === "trash"} onChange={() => setMode("trash")} />
            {t("Move its {n} problem(s) to the Trash", { n })}
          </label>
        </div>
      )}
      <p className="faint" style={{ fontSize: 12 }}>
        {t("Tip: archiving hides a finished course without deleting anything.")}
      </p>
    </Dialog>
  );
}

function AboutDialog() {
  const info = useStore((s) => s.info);
  return (
    <Dialog title={t("About Marée")} onClose={A.closeDialog}>
      <div className="about">
        <BrandGlyph size={56} />
        <div className="wordmark" style={{ fontSize: 34 }}>
          Marée
        </div>
        <WaveRule width={60} />
        <p>{t("A personal library of mathematical problems.")}</p>
        <p className="faint">
          {t("Version {v}", { v: info?.version ?? "" })} · {info?.kind === "tauri" ? t("Desktop") : t("Browser preview")}
        </p>
        <p className="faint" style={{ fontSize: 12 }}>
          {t("Mathematics typeset with KaTeX. PDF reading by PDF.js. Data stored locally in SQLite.")}
        </p>
      </div>
    </Dialog>
  );
}

function PromptDialog({ title, label, value, allowEmpty, onSubmit }: Extract<ReturnType<typeof get>["dialog"], { kind: "prompt" }>) {
  const [v, setV] = useState(value);
  const submit = () => {
    if (!allowEmpty && !v.trim()) return;
    A.closeDialog();
    void onSubmit(v.trim());
  };
  return (
    <Dialog
      title={title}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t("OK")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{label}</label>
        <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </Dialog>
  );
}

function ConfirmDialog(d: Extract<ReturnType<typeof get>["dialog"], { kind: "confirm" }>) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={d.title}
      onClose={A.closeDialog}
      footer={
        <>
          {d.secondary && (
            <button
              className="btn"
              onClick={async () => {
                A.closeDialog();
                await d.secondary!.run();
              }}
            >
              {d.secondary.label}
            </button>
          )}
          <span className="grow" />
          <button className="btn btn-ghost" onClick={A.closeDialog}>
            {t("Cancel")}
          </button>
          <button
            className={`btn ${d.danger ? "btn-danger" : "btn-primary"}`}
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              try {
                await d.onConfirm();
              } finally {
                setBusy(false);
                A.closeDialog();
              }
            }}
          >
            {d.confirmLabel}
          </button>
        </>
      }
    >
      <p>{d.message}</p>
    </Dialog>
  );
}

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "course":
      return <CourseDialog courseId={d.courseId} />;
    case "lecture":
      return <LectureDialog lectureId={d.lectureId} courseId={d.courseId} />;
    case "lectures-bulk":
      return <LecturesBulkDialog courseId={d.courseId} />;
    case "topic":
      return <TopicDialog topicId={d.topicId} parentId={d.parentId} />;
    case "source":
      return <SourceDialog sourceId={d.sourceId} />;
    case "confirm":
      return <ConfirmDialog {...d} />;
    case "export":
      return <ExportDialog problemIds={d.problemIds} title={d.title} />;
    case "save-view":
      return <SaveViewDialog viewId={d.viewId} />;
    case "library-import":
      return <LibraryImportDialog {...d} />;
    case "review-date":
      return <ReviewDateDialog problemIds={d.problemIds} />;
    case "delete-course":
      return <DeleteCourseDialog courseId={d.courseId} />;
    case "about":
      return <AboutDialog />;
    case "phone":
      return <PhoneDialog />;
    case "prompt":
      return <PromptDialog {...d} />;
  }
}

