import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Flag,
  GraduationCap,
  Hash,
  History as HistoryIcon,
  ImagePlus,
  MoreHorizontal,
  Paperclip,
  PencilLine,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useStore, get } from "../state/store";
import * as A from "../state/actions";
import type { Attempt, Category, HistoryEvent, Outcome, Problem, ProblemPart, Status } from "../data/types";
import { OUTCOMES, STATUSES } from "../data/types";
import { CATEGORY_LABEL, DIFFICULTY_LABEL, OUTCOME_LABEL, PRIORITY_LABEL, STATUS_KEYS, STATUS_LABEL } from "../domain/status";
import { courseLabel, lectureLabel } from "../domain/filters";
import { DifficultyMeter, StatusIcon } from "../ui/icons";
import { openContextMenu, openMenuBelow, type MenuItem } from "../ui/Menu";
import { TagPicker, type PickOption } from "../ui/TagPicker";
import { Popover } from "../ui/Popover";
import { MathEditor, type EditorMode } from "./MathEditor";
import { renderInline } from "../math/render";
import { MathView } from "./MathView";
import { problemMenuItems, reviewDateItems } from "./problemMenu";
import { platform } from "../platform";
import { fileFromDom } from "../platform/dom-drop";
import { todayLocal } from "../data/ids";
import { fmtDateTime, t } from "../i18n";

type WorkTab = "solution" | "reference" | "notes" | "attempts" | "history";

// UI state that should survive switching tabs, kept per problem for the session.
const viewState = new Map<string, { work: WorkTab; revealed: boolean; mode?: EditorMode }>();

/** Shows the title typeset (KaTeX); becomes a plain input with the LaTeX source when clicked or focused. */
function TitleField({
  value,
  onChange,
  onEnter,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing, inputRef]);
  if (editing || !value.trim()) {
    return (
      <input
        ref={inputRef}
        className="pv-title"
        value={value}
        placeholder={t("Add a title")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            if (e.key === "Enter") onEnter();
          }
        }}
        aria-label={t("Title")}
        spellCheck={false}
      />
    );
  }
  return (
    <div
      className="pv-title rendered"
      role="textbox"
      tabIndex={0}
      aria-label={t("Title")}
      title={t("Click to edit")}
      onClick={() => setEditing(true)}
      onFocus={() => setEditing(true)}
      dangerouslySetInnerHTML={{ __html: renderInline(value) }}
    />
  );
}

export function StatusControl({ value, onChange, compact }: { value: Status; onChange: (s: Status) => void; compact?: boolean }) {
  return (
    <div className="seg status-seg" role="radiogroup" aria-label={t("Status")}>
      {STATUSES.map((st) => (
        <button
          key={st}
          role="radio"
          aria-checked={value === st}
          className={value === st ? "on" : ""}
          title={`${t(STATUS_LABEL[st])}  (Alt+${STATUS_KEYS[st]})`}
          onClick={() => onChange(st)}
        >
          <StatusIcon status={st} size={13} />
          {(!compact || value === st) && <span>{t(STATUS_LABEL[st])}</span>}
        </button>
      ))}
    </div>
  );
}

function DifficultyPicker({ value, onChange }: { value: number | null; onChange: (d: number | null) => void }) {
  return (
    <button
      className="diff meta-btn"
      title={value ? `${t("Difficulty")}: ${value}/4 — ${t(DIFFICULTY_LABEL[value])}` : t("Set difficulty")}
      onClick={(e) =>
        openMenuBelow(e.currentTarget, [
          ...[1, 2, 3, 4].map((d) => ({
            label: `${d} — ${t(DIFFICULTY_LABEL[d])}`,
            checked: value === d ? true : undefined,
            icon: <DifficultyMeter value={d} />,
            onSelect: () => onChange(d),
          })),
          { separator: true },
          { label: t("No difficulty"), onSelect: () => onChange(null) },
        ])
      }
    >
      <DifficultyMeter value={value} />
      <span className="meta-label">{value ? t(DIFFICULTY_LABEL[value]) : t("Difficulty")}</span>
    </button>
  );
}

function Crumbs({ p }: { p: Problem }) {
  const index = useStore((s) => s.index);
  const course = p.courseId ? index.courses.get(p.courseId) : null;
  const lec = p.lectureIds.map((id) => index.lectures.get(id)).filter(Boolean).sort((a, b) => a!.sortOrder - b!.sortOrder)[0];
  return (
    <nav className="crumbs" aria-label={t("Breadcrumbs")}>
      <button onClick={A.showAll}>{t("Library")}</button>
      {course && (
        <>
          <ChevronRight size={12} />
          <button onClick={() => A.showCourse(course.id)}>{course.code || course.title}</button>
        </>
      )}
      {lec && (
        <>
          <ChevronRight size={12} />
          <button onClick={() => A.showLecture(lec.id)}>{lectureLabel(lec)}</button>
        </>
      )}
      <ChevronRight size={12} />
      <span>{p.sourceNumber ? `${t("Problem")} ${p.sourceNumber}` : t("Problem")}</span>
    </nav>
  );
}

function ChipPicker({
  icon,
  label,
  chips,
  options,
  selected,
  onToggle,
  onCreate,
  single,
  emptyLabel,
}: {
  icon: ReactNode;
  label: string;
  chips: { id: string; label: string; onClick?: () => void }[];
  options: PickOption[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
  onCreate?: (name: string) => Promise<void>;
  single?: boolean;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="meta-line">
      <span className="meta-key">
        {icon}
        {label}
      </span>
      <div className="meta-chips">
        {chips.map((c) => (
          <span key={c.id} className="chip">
            <button className="chip-link label" onClick={c.onClick}>
              {c.label}
            </button>
            <button className="x" aria-label={t("Remove")} onClick={() => onToggle(c.id, false)}>
              <X size={11} />
            </button>
          </span>
        ))}
        <button ref={ref} className="chip add" onClick={() => setOpen(true)}>
          <Plus size={11} /> {chips.length ? "" : emptyLabel}
        </button>
      </div>
      {open && (
        <TagPicker
          anchor={ref.current}
          options={options}
          selected={selected}
          onToggle={onToggle}
          onCreate={onCreate}
          onClose={() => setOpen(false)}
          single={single}
        />
      )}
    </div>
  );
}

function ImportBanner({ p }: { p: Problem }) {
  const [showRaw, setShowRaw] = useState(false);
  const src = p.sourceId ? get().index.sources.get(p.sourceId) : undefined;
  return (
    <div className="import-banner" role="note">
      <div className="row">
        <AlertTriangle size={15} />
        <strong>{t("Check the imported text")}</strong>
        <span className="grow" />
        {src?.storedPath && src.format === "pdf" && (
          <button className="btn btn-sm" onClick={() => A.openSource(src.id, p.sourcePage ?? undefined, true)}>
            <FileText size={13} /> {t("Show page {n} beside", { n: p.sourcePage ?? 1 })}
          </button>
        )}
        <button className="btn btn-sm btn-primary" onClick={() => A.patchProblem(p.id, { importFlags: [] })}>
          <Check size={13} /> {t("Mark as reviewed")}
        </button>
      </div>
      <ul>
        {p.importFlags.map((f) => (
          <li key={f.code}>{t(f.message)}</li>
        ))}
      </ul>
      {p.sourceExcerpt && (
        <>
          <button className="link-btn" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {t("Original extracted text")}
          </button>
          {showRaw && <pre className="raw-excerpt selectable">{p.sourceExcerpt}</pre>}
        </>
      )}
    </div>
  );
}

function AttemptDialog({ anchor, onClose, onSave }: { anchor: HTMLElement | null; onClose: () => void; onSave: (o: Outcome, note: string, fresh: boolean) => void }) {
  const [outcome, setOutcome] = useState<Outcome>("unsure");
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState(false);
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} align="end">
      <div className="col" style={{ padding: 8, gap: 10 }}>
        <div className="field-label">{t("Record this attempt")}</div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {t("A snapshot of the current proof is kept in the attempt history.")}
        </p>
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          {OUTCOMES.map((o) => (
            <button key={o} className={outcome === o ? "on" : ""} onClick={() => setOutcome(o)}>
              {t(OUTCOME_LABEL[o])}
            </button>
          ))}
        </div>
        <textarea className="textarea" rows={2} placeholder={t("What went wrong or right? (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="checkbox">
          <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
          {t("Start a fresh draft afterwards")}
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(outcome, note, fresh);
              onClose();
            }}
          >
            {t("Record attempt")}
          </button>
        </div>
      </div>
    </Popover>
  );
}

function AttemptsList({ p, partId, onRestore }: { p: Problem; partId: string | null; onRestore: (content: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = p.attempts.filter((a) => a.partId === partId);
  if (!list.length) {
    return <div className="work-empty">{t("No recorded attempts yet. Use “Record attempt” to keep a snapshot of your proof and how it went.")}</div>;
  }
  return (
    <div className="attempts">
      {list.map((a: Attempt, i) => (
        <div key={a.id} className={`attempt outcome-${a.outcome}`}>
          <button className="attempt-head" onClick={() => setOpen(open === a.id ? null : a.id)}>
            {open === a.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="attempt-n">#{list.length - i}</span>
            <span className={`badge outcome ${a.outcome}`}>{t(OUTCOME_LABEL[a.outcome])}</span>
            <span className="muted">{fmtDateTime(a.createdAt)}</span>
            {a.note && <span className="attempt-note ellipsis">— {a.note}</span>}
          </button>
          {open === a.id && (
            <div className="attempt-body">
              <MathView source={a.content} empty={t("(empty)")} />
              <div className="row">
                <button className="btn btn-sm" onClick={() => onRestore(a.content)}>
                  <RotateCcw size={12} /> {t("Restore into editor")}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard.writeText(a.content)}>
                  <Copy size={12} /> {t("Copy")}
                </button>
                <span className="grow" />
                <button className="btn btn-sm btn-ghost" onClick={() => A.deleteAttempt(p.id, a.id)}>
                  <Trash2 size={12} /> {t("Delete")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function historyText(h: HistoryEvent): string {
  switch (h.kind) {
    case "created":
      return t("Created");
    case "imported":
      return t("Imported");
    case "restored":
      return t("Restored from Trash");
    case "status":
      return t("Status: {from} → {to}", {
        from: t(STATUS_LABEL[(h.fromValue as Status) ?? "not_started"] ?? h.fromValue ?? ""),
        to: t(STATUS_LABEL[(h.toValue as Status) ?? "not_started"] ?? h.toValue ?? ""),
      });
    case "attempt":
      return t("Attempt recorded: {outcome}", { outcome: t(OUTCOME_LABEL[(h.toValue as Outcome) ?? "unsure"] ?? "") });
    case "review-date":
      return h.toValue ? t("Review scheduled for {date}", { date: A.formatDate(h.toValue) }) : t("Review date cleared");
  }
}

function HistoryList({ p }: { p: Problem }) {
  return (
    <ol className="history">
      {p.history.map((h) => (
        <li key={h.id}>
          <span className="when">{fmtDateTime(h.createdAt)}</span>
          <span>
            {historyText(h)}
            {h.note && <span className="muted"> — {h.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function WorkArea({
  p,
  part,
  state,
  setState,
}: {
  p: Problem;
  part?: ProblemPart;
  state: { work: WorkTab; revealed: boolean; mode?: EditorMode };
  setState: (s: Partial<{ work: WorkTab; revealed: boolean; mode?: EditorMode }>) => void;
}) {
  const [attemptAnchor, setAttemptAnchor] = useState<HTMLElement | null>(null);
  const partId = part?.id ?? null;
  const solution = part ? part.solution : p.solution;
  const reference = part ? part.referenceSolution : p.referenceSolution;
  const notes = part ? part.notes : p.notes;
  const attempts = p.attempts.filter((a) => a.partId === partId).length;
  const save = (field: "solution" | "referenceSolution" | "notes", v: string) => {
    if (part) A.patchPart(p.id, part.id, { [field]: v });
    else void A.patchProblem(p.id, { [field]: v });
  };
  const tabs: [WorkTab, string, number?][] = [
    ["solution", t("My Solution")],
    ["reference", t("Reference")],
    ["notes", t("Notes")],
    ["attempts", t("Attempts"), attempts],
  ];
  if (!part) tabs.push(["history", t("History")]);

  return (
    <div className="work">
      <div className="worktabs" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={state.work === k} className={state.work === k ? "on" : ""} onClick={() => setState({ work: k })}>
            {label}
            {!!n && <span className="count">{n}</span>}
            {k === "reference" && reference && !state.revealed && <EyeOff size={11} className="faint" />}
          </button>
        ))}
      </div>
      {state.work === "solution" && (
        <MathEditor
          key={`sol-${partId ?? p.id}`}
          value={solution}
          onChange={(v) => save("solution", v)}
          placeholder={t("Write your proof here. LaTeX: \\( inline \\), \\[ display \\], \\begin{proof} … \\end{proof}")}
          mode={state.mode}
          onModeChange={(m) => setState({ mode: m })}
          attachments={p.attachments}
          label={t("My solution")}
          toolbarExtra={
            <>
              <button
                className="btn btn-ghost btn-sm"
                title={t("Copy proof as Markdown")}
                onClick={(e) =>
                  openMenuBelow(e.currentTarget, [
                    { label: t("Copy problem and proof as Markdown"), onSelect: () => A.copyProblemAs(p.id, "solution", "md") },
                    { label: t("Copy problem and proof as LaTeX"), onSelect: () => A.copyProblemAs(p.id, "solution", "tex") },
                    { label: t("Copy proof source only"), onSelect: () => void navigator.clipboard.writeText(solution).then(() => import("../state/store").then((m) => m.toast(t("Copied"), "success"))) },
                  ])
                }
              >
                <Copy size={13} /> {t("Copy")}
              </button>
              <button className="btn btn-sm" onClick={(e) => setAttemptAnchor(e.currentTarget)}>
                <HistoryIcon size={13} /> {t("Record attempt")}
              </button>
            </>
          }
        />
      )}
      {state.work === "reference" &&
        (reference && !state.revealed ? (
          <div className="reveal">
            <EyeOff size={18} strokeWidth={1.5} />
            <p>{t("The reference solution is hidden so it does not spoil your attempt.")}</p>
            <button className="btn" onClick={() => setState({ revealed: true })}>
              <Eye size={14} /> {t("Reveal reference solution")}
            </button>
          </div>
        ) : (
          <MathEditor
            key={`ref-${partId ?? p.id}`}
            value={reference}
            onChange={(v) => save("referenceSolution", v)}
            placeholder={t("Optional: an official or textbook solution, kept separate from your own attempt.")}
            mode={state.mode}
            onModeChange={(m) => setState({ mode: m })}
            attachments={p.attachments}
            label={t("Reference solution")}
            toolbarExtra={
              reference ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setState({ revealed: false })}>
                  <EyeOff size={13} /> {t("Hide")}
                </button>
              ) : undefined
            }
          />
        ))}
      {state.work === "notes" && (
        <MathEditor
          key={`notes-${partId ?? p.id}`}
          value={notes}
          onChange={(v) => save("notes", v)}
          placeholder={t("Proof techniques, mistakes to avoid, observations…")}
          mode={state.mode}
          onModeChange={(m) => setState({ mode: m })}
          attachments={p.attachments}
          minHeight={140}
          label={t("Notes")}
        />
      )}
      {state.work === "attempts" && (
        <AttemptsList
          p={p}
          partId={partId}
          onRestore={(content) => {
            save("solution", content);
            setState({ work: "solution" });
          }}
        />
      )}
      {state.work === "history" && <HistoryList p={p} />}
      {attemptAnchor && (
        <AttemptDialog anchor={attemptAnchor} onClose={() => setAttemptAnchor(null)} onSave={(o, note, fresh) => A.finishAttempt(p.id, partId, o, note, fresh)} />
      )}
    </div>
  );
}

function PartCard({ p, part }: { p: Problem; part: ProblemPart }) {
  const key = `${p.id}:${part.id}`;
  const [open, setOpen] = useState(() => viewState.get(key)?.work !== undefined);
  const [editing, setEditing] = useState(!part.statement);
  const [st, setSt] = useState(() => viewState.get(key) ?? { work: "solution" as WorkTab, revealed: false });
  const update = (s: Partial<typeof st>) => {
    const next = { ...st, ...s };
    setSt(next);
    viewState.set(key, next);
  };
  return (
    <div className="part">
      <div className="part-head">
        <button className="part-label" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}({part.label})
        </button>
        <span className="grow" />
        <StatusControl compact value={part.status} onChange={(s) => A.patchPart(p.id, part.id, { status: s })} />
        <button
          className="icon-btn sm"
          title={t("Part options")}
          onClick={(e) =>
            openMenuBelow(e.currentTarget, [
              { label: editing ? t("Done Editing Statement") : t("Edit Statement"), onSelect: () => setEditing(!editing) },
              { label: t("Rename Label…"), onSelect: () => A.promptDialog({ title: t("Rename part"), label: t("Part label"), value: part.label, onSubmit: (label) => A.patchPart(p.id, part.id, { label }) }) },
              { separator: true },
              { label: t("Delete Part"), danger: true, onSelect: () => A.confirmDialog({ title: t("Delete part ({label})?", { label: part.label }), message: t("Its statement, solution and notes are deleted."), confirmLabel: t("Delete part"), danger: true, onConfirm: () => A.deletePart(p.id, part.id) }) },
            ])
          }
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {editing ? (
        <div className="part-edit">
          <MathEditor
            value={part.statement}
            onChange={(v) => A.patchPart(p.id, part.id, { statement: v })}
            placeholder={t("Statement of part ({label})", { label: part.label })}
            minHeight={110}
            autoFocus={!part.statement}
            label={t("Part statement")}
            toolbarExtra={
              <button className="btn btn-sm" onClick={() => setEditing(false)}>
                <Check size={13} /> {t("Done")}
              </button>
            }
          />
        </div>
      ) : (
        <div className="part-statement" onDoubleClick={() => setEditing(true)} title={t("Double-click to edit")}>
          <MathView source={part.statement} attachments={p.attachments} empty={t("Empty statement — double-click to edit.")} />
        </div>
      )}
      {open && <WorkArea p={p} part={part} state={st} setState={update} />}
    </div>
  );
}

function Attachments({ p }: { p: Problem }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    for (const a of p.attachments) {
      if (urls[a.id] || !a.mime.startsWith("image/")) continue;
      void platform()
        .readStored(a.storedPath)
        .then((b) => alive && setUrls((u) => ({ ...u, [a.id]: URL.createObjectURL(new Blob([b as BlobPart], { type: a.mime })) })))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.attachments]);

  return (
    <section
      className="pv-attachments"
      data-attach-drop
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        void A.addAttachments(p.id, files.map(fileFromDom));
      }}
    >
      <div className="pv-section-head">
        <Paperclip size={13} /> {t("Attachments")}
        <span className="grow" />
        <button
          className="btn btn-ghost btn-sm"
          title={t("Drop images or PDFs here. Reference an image in any text as ![caption](attachment:file-name.png).")}
          onClick={() => A.addAttachments(p.id)}
        >
          <ImagePlus size={13} /> {t("Add file")}
        </button>
      </div>
      {p.attachments.length === 0 ? null : (
        <div className="att-grid">
          {p.attachments.map((a) => (
            <figure
              key={a.id}
              className="att"
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: t("Open"), onSelect: () => platform().openStored(a.storedPath) },
                  { label: t("Copy Reference"), onSelect: () => navigator.clipboard.writeText(`![${a.caption || a.fileName}](attachment:${a.fileName})`) },
                  { separator: true },
                  { label: t("Remove Attachment"), danger: true, onSelect: () => A.removeAttachment(p.id, a.id) },
                ])
              }
              onDoubleClick={() => platform().openStored(a.storedPath)}
            >
              {urls[a.id] ? <img src={urls[a.id]} alt={a.caption || a.fileName} /> : <div className="att-file"><FileText size={22} strokeWidth={1.4} /></div>}
              <figcaption className="ellipsis" title={a.fileName}>
                {a.fileName}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

function Provenance({ p }: { p: Problem }) {
  const src = useStore((s) => (p.sourceId ? s.index.sources.get(p.sourceId) : undefined));
  const [open, setOpen] = useState(false);
  if (!src && !p.sourceNumber && !p.sourcePage) return null;
  return (
    <section className="provenance">
      <button className="pv-section-head link-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {t("Source and provenance")}
      </button>
      {open && (
        <dl className="prov-grid selectable">
          {src && (
            <>
              <dt>{t("Document")}</dt>
              <dd>
                {src.title} <span className="faint">({t(src.kind)})</span>
              </dd>
            </>
          )}
          {src?.fileName && (
            <>
              <dt>{t("File")}</dt>
              <dd className="mono">{src.fileName}</dd>
            </>
          )}
          {p.sourceNumber && (
            <>
              <dt>{t("Original number")}</dt>
              <dd>{p.sourceNumber}</dd>
            </>
          )}
          {p.sourcePage && (
            <>
              <dt>{t("Page")}</dt>
              <dd>{p.sourcePage}</dd>
            </>
          )}
          {p.sourceSection && (
            <>
              <dt>{t("Section")}</dt>
              <dd>{p.sourceSection}</dd>
            </>
          )}
          {src?.importedAt && (
            <>
              <dt>{t("Imported")}</dt>
              <dd>{fmtDateTime(src.importedAt)}</dd>
            </>
          )}
          {src?.originalPath && (
            <>
              <dt>{t("Original location")}</dt>
              <dd className="mono">{src.originalPath}</dd>
            </>
          )}
          {src?.fileHash && (
            <>
              <dt>SHA-256</dt>
              <dd className="mono faint">{src.fileHash.slice(0, 16)}…</dd>
            </>
          )}
          {p.sourceExcerpt && (
            <>
              <dt>{t("As extracted")}</dt>
              <dd>
                <pre className="raw-excerpt">{p.sourceExcerpt}</pre>
              </dd>
            </>
          )}
        </dl>
      )}
      {open && src && (
        <div className="row" style={{ marginTop: 6 }}>
          {src.storedPath && src.format === "pdf" && (
            <button className="btn btn-sm" onClick={() => A.openSource(src.id, p.sourcePage ?? undefined, true)}>
              <FileText size={13} /> {t("Open source beside")}
            </button>
          )}
          {src.storedPath && (
            <button className="btn btn-sm btn-ghost" onClick={() => platform().openStored(src.storedPath!)}>
              {t("Open original file")}
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => A.showSource(src.id)}>
            {t("All problems from this source")}
          </button>
        </div>
      )}
    </section>
  );
}

export function ProblemView({ problemId }: { problemId: string }) {
  const p = useStore((s) => s.problemCache[problemId]);
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const topics = useStore((s) => s.topics);
  const index = useStore((s) => s.index);
  const [editStatement, setEditStatement] = useState<boolean | null>(null);
  // Course, lectures, topics, difficulty… stay folded into one summary line until asked for.
  const detailsHidden = useStore((s) => s.layout.collapsed["problem-details"] ?? true);
  const [vs, setVs] = useState(() => viewState.get(problemId) ?? { work: "solution" as WorkTab, revealed: false });
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!p) void A.loadProblem(problemId);
  }, [p, problemId]);

  useEffect(() => {
    // New, empty problems start with the title focused and the statement editor open.
    if (p && !p.title && !p.statement && titleRef.current) titleRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);

  const updateVs = (s: Partial<typeof vs>) => {
    const next = { ...vs, ...s };
    setVs(next);
    viewState.set(problemId, next);
  };

  const lectureOptions = useMemo<PickOption[]>(
    () =>
      lectures.map((l) => ({
        id: l.id,
        label: lectureLabel(l),
        group: courses.find((c) => c.id === l.courseId)?.code || courses.find((c) => c.id === l.courseId)?.title,
      })),
    [lectures, courses],
  );
  const topicOptions = useMemo<PickOption[]>(() => {
    const out: PickOption[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const tp of topics.filter((x) => x.parentId === parent)) {
        out.push({ id: tp.id, label: tp.name, depth });
        walk(tp.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [topics]);

  if (!p) return <div className="pv-loading">{t("Loading…")}</div>;
  if (p.deletedAt) {
    return (
      <div className="empty-state">
        <div className="title">{t("This problem is in the Trash")}</div>
        <button className="btn" onClick={() => A.restoreProblems([p.id])}>
          <RotateCcw size={13} /> {t("Restore")}
        </button>
      </div>
    );
  }

  const editing = editStatement ?? !p.statement;
  const course = p.courseId ? index.courses.get(p.courseId) : null;
  const src = p.sourceId ? index.sources.get(p.sourceId) : null;
  const today = todayLocal();
  const summaryParts = [
    ...p.topicIds.map((id) => index.topics.get(id)?.name).filter((x): x is string => !!x),
    p.difficulty ? t(DIFFICULTY_LABEL[p.difficulty]) : null,
    p.category ? t(CATEGORY_LABEL[p.category]) : null,
    p.priority > 0 ? t(PRIORITY_LABEL[p.priority]) : null,
    p.reviewDue ? t("Review {date}", { date: A.formatDate(p.reviewDue) }) : null,
  ].filter((x): x is string => !!x);

  const setStatus = (s: Status) => void A.patchProblem(p.id, { status: s });

  const menu: MenuItem[] = [
    { label: p.pinned ? t("Unpin") : t("Pin to Top of Lists"), icon: <Pin size={14} />, onSelect: () => A.patchProblem(p.id, { pinned: !p.pinned }) },
    { label: t("Priority"), icon: <Flag size={14} />, submenu: [0, 1, 2, 3].map((n) => ({ label: t(PRIORITY_LABEL[n]), checked: p.priority === n ? true : undefined, onSelect: () => A.patchProblem(p.id, { priority: n }) })) },
    { label: t("Original Number…"), onSelect: () => A.promptDialog({ title: t("Original problem number"), label: t("Number as printed in the source (e.g. 4, 2.3.7)"), value: p.sourceNumber, allowEmpty: true, onSubmit: (v) => A.patchProblem(p.id, { sourceNumber: v }) }) },
    { label: t("Source…"), submenu: [
      ...get().sources.map((s) => ({ label: s.title, checked: p.sourceId === s.id ? true : undefined, onSelect: () => A.patchProblem(p.id, { sourceId: s.id }) })),
      { separator: true },
      { label: t("No source"), onSelect: () => A.patchProblem(p.id, { sourceId: null }) },
    ] },
    { separator: true },
    ...problemMenuItems([p.id], { inView: true }),
  ];

  return (
    <div className="pv" onContextMenu={(e) => {
      if ((e.target as HTMLElement).closest(".cm-editor, input, textarea, .prose")) return;
      openContextMenu(e, menu);
    }}>
      <div className="pv-inner">
        <div className="pv-top">
          <Crumbs p={p} />
          <div className="row" style={{ gap: 2 }}>
            {src?.storedPath && src.format === "pdf" && (
              <button className="icon-btn" title={t("Open source PDF beside (page {n})", { n: p.sourcePage ?? 1 })} onClick={() => A.openSource(src.id, p.sourcePage ?? undefined, true)}>
                <FileText size={15} />
              </button>
            )}
            <button className="icon-btn" title={t("More")} onClick={(e) => openMenuBelow(e.currentTarget, menu)}>
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        <div className="pv-heading">
          {p.sourceNumber && <span className="pv-number">{p.sourceNumber}</span>}
          <TitleField
            inputRef={titleRef}
            value={p.title}
            onChange={(v) => A.patchProblem(p.id, { title: v })}
            onEnter={() => (document.querySelector(".pv-statement .cm-content") as HTMLElement | null)?.focus()}
          />
        </div>

        <div className="pv-meta">
          <StatusControl value={p.status} onChange={setStatus} compact={detailsHidden} />
          <button
            className="pv-details-toggle"
            aria-expanded={!detailsHidden}
            title={detailsHidden ? t("Show details") : t("Hide details")}
            onClick={() => A.updateLayout({ collapsed: { ...get().layout.collapsed, "problem-details": !detailsHidden } })}
          >
            {detailsHidden ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {detailsHidden ? (
              <span className="pv-summary ellipsis">{summaryParts.join(" · ") || t("Details")}</span>
            ) : (
              <span>{t("Hide details")}</span>
            )}
          </button>
        </div>
        {p.status === "needs_review" && !p.reviewDue && (
          <div className="inline-suggest">
            {t("Schedule a review?")}
            {[
              [t("Tomorrow"), 1],
              [t("In 3 days"), 3],
              [t("In 1 week"), 7],
            ].map(([label, d]) => (
              <button key={label as string} className="chip static" onClick={() => A.setReviewDate([p.id], todayLocal(d as number))}>
                {label}
              </button>
            ))}
          </div>
        )}

        {!detailsHidden && (
          <>
            <div className="pv-meta pv-meta-extra">
              <DifficultyPicker value={p.difficulty} onChange={(d) => A.patchProblem(p.id, { difficulty: d })} />
              <button
                className="meta-btn"
                onClick={(e) =>
                  openMenuBelow(e.currentTarget, [
                    ...(["proof", "calculation", "conceptual", "application"] as Category[]).map((c) => ({
                      label: t(CATEGORY_LABEL[c]),
                      checked: p.category === c ? true : undefined,
                      onSelect: () => A.patchProblem(p.id, { category: c }),
                    })),
                    { separator: true },
                    { label: t("None"), onSelect: () => A.patchProblem(p.id, { category: null }) },
                  ])
                }
              >
                <PencilLine size={13} />
                <span className="meta-label">{p.category ? t(CATEGORY_LABEL[p.category]) : t("Type")}</span>
              </button>
              <button className={`meta-btn${p.reviewDue && p.reviewDue <= today ? " due" : ""}`} onClick={(e) => openMenuBelow(e.currentTarget, reviewDateItems([p.id]))}>
                <CalendarClock size={13} />
                <span className="meta-label">{p.reviewDue ? t("Review {date}", { date: A.formatDate(p.reviewDue) }) : t("Schedule review")}</span>
              </button>
              {p.priority > 0 && (
                <span className="meta-btn static" title={t("Priority")}>
                  <Flag size={13} color="var(--accent)" /> <span className="meta-label">{t(PRIORITY_LABEL[p.priority])}</span>
                </span>
              )}
            </div>
            <div className="pv-taxonomy">
              <ChipPicker
                icon={<GraduationCap size={13} />}
                label={t("Course")}
                emptyLabel={t("Set course")}
                single
                chips={course ? [{ id: course.id, label: course.code || course.title, onClick: () => A.showCourse(course.id) }] : []}
                options={courses.map((c) => ({ id: c.id, label: courseLabel(c) }))}
                selected={p.courseId ? [p.courseId] : []}
                onToggle={(id, on) => A.patchProblem(p.id, { courseId: on ? id : null })}
                onCreate={async (name) => {
                  const id = await A.createCourse({ code: name });
                  await A.patchProblem(p.id, { courseId: id });
                }}
              />
              <ChipPicker
                icon={<Hash size={13} />}
                label={t("Lectures")}
                emptyLabel={t("Add lecture")}
                chips={p.lectureIds
                  .map((id) => index.lectures.get(id))
                  .filter(Boolean)
                  .map((l) => ({ id: l!.id, label: lectureLabel(l!), onClick: () => A.showLecture(l!.id) }))}
                options={p.courseId ? lectureOptions.filter((o) => index.lectures.get(o.id)?.courseId === p.courseId).concat(lectureOptions.filter((o) => index.lectures.get(o.id)?.courseId !== p.courseId)) : lectureOptions}
                selected={p.lectureIds}
                onToggle={(id, on) => {
                  const l = index.lectures.get(id);
                  void A.patchProblem(p.id, {
                    lectureIds: on ? [...p.lectureIds, id] : p.lectureIds.filter((x) => x !== id),
                    ...(on && l && !p.courseId ? { courseId: l.courseId } : {}),
                  });
                }}
                onCreate={
                  p.courseId
                    ? async (name) => {
                        const m = /^(?:lecture\s*)?(\d+[a-z]?)\s*[—–:-]?\s*(.*)$/i.exec(name);
                        const [l] = await A.createLectures([{ courseId: p.courseId!, number: m ? m[1] : "", title: m ? m[2] : name }]);
                        await A.patchProblem(p.id, { lectureIds: [...p.lectureIds, l.id] });
                      }
                    : undefined
                }
              />
              <ChipPicker
                icon={<Hash size={13} />}
                label={t("Topics")}
                emptyLabel={t("Add topic")}
                chips={p.topicIds
                  .map((id) => index.topics.get(id))
                  .filter(Boolean)
                  .map((tp) => ({ id: tp!.id, label: tp!.name, onClick: () => A.showTopic(tp!.id) }))}
                options={topicOptions}
                selected={p.topicIds}
                onToggle={(id, on) => A.patchProblem(p.id, { topicIds: on ? [...p.topicIds, id] : p.topicIds.filter((x) => x !== id) })}
                onCreate={async (name) => {
                  const tp = await A.createTopic({ name });
                  await A.patchProblem(p.id, { topicIds: [...p.topicIds, tp.id] });
                }}
              />
              {src && (
                <div className="meta-line">
                  <span className="meta-key">
                    <FileText size={13} />
                    {t("Source")}
                  </span>
                  <button className="chip static chip-link" onClick={() => (src.storedPath && src.format === "pdf" ? A.openSource(src.id, p.sourcePage ?? undefined, true) : A.showSource(src.id))}>
                    {src.title}
                    {p.sourcePage ? ` · p. ${p.sourcePage}` : ""}
                  </button>
                </div>
              )}
            </div>

          </>
        )}

        {p.importFlags.length > 0 && <ImportBanner p={p} />}

        <section className="pv-statement">
          <div className="pv-section-head">
            {t("Statement")}
            <span className="grow" />
            {editing ? (
              <button className="btn btn-sm" onClick={() => setEditStatement(false)} disabled={!p.statement.trim()}>
                <Check size={13} /> {t("Done")}
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setEditStatement(true)}>
                <PencilLine size={13} /> {t("Edit")}
              </button>
            )}
          </div>
          {editing ? (
            <MathEditor
              value={p.statement}
              onChange={(v) => A.patchProblem(p.id, { statement: v })}
              placeholder={t("State the problem. Use \\( … \\) for inline and \\[ … \\] for display mathematics.")}
              attachments={p.attachments}
              autoFocus={!!p.title && !p.statement}
              minHeight={150}
              label={t("Statement")}
            />
          ) : (
            <div className="statement-view" onDoubleClick={() => setEditStatement(true)} title={t("Double-click to edit")}>
              <MathView source={p.statement} attachments={p.attachments} className="statement" />
            </div>
          )}
        </section>

        {p.parts.length > 0 && (
          <section className="parts">
            {p.parts.map((part) => (
              <PartCard key={part.id} p={p} part={part} />
            ))}
          </section>
        )}
        <div className="row" style={{ margin: "4px 0 2px" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => A.addPart(p.id)}>
            <Plus size={13} /> {p.parts.length ? t("Add part") : t("Split into parts (a), (b), …")}
          </button>
        </div>

        <section className="pv-work">
          <WorkArea p={p} state={vs} setState={updateVs} />
        </section>

        <Attachments p={p} />
        <Provenance p={p} />
        <div className="pv-foot faint">
          {t("Created {date}", { date: A.formatDate(p.createdAt) })} · {t("Modified {date}", { date: fmtDateTime(p.updatedAt) })}
          {p.lastAttemptAt && <> · {t("Last attempt {date}", { date: A.relativeDate(p.lastAttemptAt) })}</>}
        </div>
      </div>
    </div>
  );
}
