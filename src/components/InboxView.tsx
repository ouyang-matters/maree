import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ImagePlus, RotateCcw, RotateCw, Smartphone, Trash2 } from "lucide-react";
import { useStore, get, toast } from "../state/store";
import * as A from "../state/actions";
import * as I from "../state/inbox";
import { platform } from "../platform";
import type { InboxItem } from "../platform/types";
import { fmtDateTime, t } from "../i18n";
import { courseLabel, lectureLabel } from "../domain/filters";
import { isUsableRect, moveRect, readingOrder, rectFrom, rotateRect, type Point, type Region, type RegionKind } from "../domain/photos";
import { decodeImage, rotated, toBlob, type Quarter } from "../image/photo";

// Object URLs of inbox photos, shared by thumbnails and the editor.
const urls = new Map<string, Promise<string>>();
function photoUrl(item: InboxItem): Promise<string> {
  let u = urls.get(item.id);
  if (!u) {
    u = platform()
      .inbox.read(item.id)
      .then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: mimeOf(item) })));
    urls.set(item.id, u);
  }
  return u;
}
function mimeOf(item: InboxItem): string {
  return item.fileName.endsWith(".png") ? "image/png" : item.fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
function forget(ids: Set<string>): void {
  for (const [id, u] of urls) {
    if (!ids.has(id)) {
      void u.then((x) => URL.revokeObjectURL(x));
      urls.delete(id);
    }
  }
}

function useUrl(item: InboxItem | null, quarter: Quarter): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    if (!item) return;
    void (async () => {
      const base = await photoUrl(item);
      if (quarter === 0) {
        if (alive) setUrl(base);
        return;
      }
      const bmp = await decodeImage(await platform().inbox.read(item.id), mimeOf(item));
      const c = rotated(bmp, quarter);
      bmp.close();
      made = URL.createObjectURL(await toBlob(c, "image/jpeg", 0.9));
      if (alive) setUrl(made);
      else URL.revokeObjectURL(made);
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [item, quarter]);
  return url;
}

function Thumb({ item, active, onClick }: { item: InboxItem; active: boolean; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void photoUrl(item).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [item]);
  return (
    <button className={`inbox-thumb${active ? " active" : ""}`} onClick={onClick} title={fmtDateTime(new Date(item.receivedAt))}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="inbox-thumb-blank" />}
      {item.kind !== "unknown" && <span className={`inbox-kind ${item.kind}`}>{item.kind === "answer" ? t("Answer") : t("Problem")}</span>}
    </button>
  );
}

interface PhotoState {
  quarter: Quarter;
  regions: Region[];
  /** Used when no region is drawn: the whole photo is one piece. */
  wholeKind: RegionKind;
  wholeTarget: string | null;
}

type Drag =
  | { mode: "draw"; id: string; start: Point }
  | { mode: "move"; id: string; start: Point; orig: Region }
  | { mode: "resize"; id: string; fixed: Point };

let regionSeq = 0;

function ProblemOptions({ extra }: { extra?: { id: string; label: string }[] }) {
  const problems = useStore((s) => s.problems);
  const courses = useStore((s) => s.courses);
  const groups = useMemo(() => {
    const live = problems.filter((p) => !p.deletedAt);
    const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : Number.MAX_SAFE_INTEGER);
    const label = (p: (typeof live)[number]) => `${p.sourceNumber ? `${p.sourceNumber} · ` : ""}${p.title || t("Untitled problem")}`;
    const out: { label: string; items: { id: string; label: string }[] }[] = [];
    const recent = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    if (recent.length) out.push({ label: t("Recent"), items: recent.map((p) => ({ id: p.id, label: label(p) })) });
    for (const c of courses.filter((c) => !c.archived)) {
      const list = live.filter((p) => p.courseId === c.id).sort((a, b) => num(a.sourceNumber) - num(b.sourceNumber) || a.title.localeCompare(b.title));
      if (list.length) out.push({ label: c.code || c.title, items: list.map((p) => ({ id: p.id, label: label(p) })) });
    }
    const loose = live.filter((p) => !p.courseId);
    if (loose.length) out.push({ label: t("No course"), items: loose.map((p) => ({ id: p.id, label: label(p) })) });
    return out;
  }, [problems, courses]);
  return (
    <>
      {extra && extra.length > 0 && (
        <optgroup label={t("From this photo")}>
          {extra.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((o) => (
            <option key={`${g.label}:${o.id}`} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function KindSwitch({ value, onChange }: { value: RegionKind; onChange: (k: RegionKind) => void }) {
  return (
    <div className="seg seg-sm" role="radiogroup">
      {(["question", "answer"] as RegionKind[]).map((k) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {k === "question" ? t("Problem") : t("Answer")}
        </button>
      ))}
    </div>
  );
}

export function InboxView() {
  const items = useStore((s) => s.inbox);
  const phone = useStore((s) => s.phone.status);
  const folder = useStore((s) => s.settings.inboxFolder);
  const courses = useStore((s) => s.courses);
  const lectures = useStore((s) => s.lectures);
  const activeCourseId = useStore((s) => s.activeCourseId);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, PhotoState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const liveCourses = useMemo(() => courses.filter((c) => !c.archived), [courses]);
  const [courseId, setCourseId] = useState<string | null>(() => activeCourseId ?? liveCourses[0]?.id ?? null);
  const [lectureId, setLectureId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void I.refreshInbox();
  }, []);
  useEffect(() => {
    forget(new Set(items.map((i) => i.id)));
    if (!items.some((i) => i.id === currentId)) setCurrentId(items[0]?.id ?? null);
  }, [items, currentId]);

  const item = items.find((i) => i.id === currentId) ?? null;
  const st: PhotoState = (item && states[item.id]) || {
    quarter: 0,
    regions: [],
    wholeKind: item?.kind === "answer" ? "answer" : "question",
    wholeTarget: item?.problemId ?? null,
  };
  const url = useUrl(item, st.quarter);
  const ordered = readingOrder(st.regions);
  const numberOf = (id: string) => ordered.findIndex((r) => r.id === id) + 1;
  const questionRegions = ordered.filter((r) => r.kind === "question");
  const fromPhoto = questionRegions.map((r) => ({ id: `region:${r.id}`, label: t("Problem {n} (new, from this photo)", { n: numberOf(r.id) }) }));

  const update = (patch: Partial<PhotoState>) => item && setStates((all) => ({ ...all, [item.id]: { ...st, ...patch } }));
  const setRegion = (id: string, patch: Partial<Region>) => update({ regions: st.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const removeRegion = (id: string) => {
    update({ regions: st.regions.filter((r) => r.id !== id).map((r) => (r.target === `region:${id}` ? { ...r, target: null } : r)) });
    if (selected === id) setSelected(null);
  };
  const rotate = (clockwise: boolean) =>
    update({ quarter: (((st.quarter + (clockwise ? 1 : 3)) % 4) as Quarter), regions: st.regions.map((r) => rotateRect(r, clockwise)) });

  const courseLectures = useMemo(() => lectures.filter((l) => l.courseId === courseId), [lectures, courseId]);

  const point = (e: { clientX: number; clientY: number }): Point => {
    const b = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!item || e.button !== 0) return;
    const el = e.target as HTMLElement;
    const p = point(e);
    const handle = el.closest<HTMLElement>("[data-handle]");
    const regionEl = el.closest<HTMLElement>("[data-region]");
    e.currentTarget.setPointerCapture(e.pointerId);
    if (handle && regionEl) {
      const r = st.regions.find((x) => x.id === regionEl.dataset.region)!;
      const h = handle.dataset.handle!;
      const fixed = { x: h.includes("w") ? r.x + r.w : r.x, y: h.includes("n") ? r.y + r.h : r.y };
      drag.current = { mode: "resize", id: r.id, fixed };
      setSelected(r.id);
      return;
    }
    if (regionEl) {
      const r = st.regions.find((x) => x.id === regionEl.dataset.region)!;
      drag.current = { mode: "move", id: r.id, start: p, orig: r };
      setSelected(r.id);
      return;
    }
    const id = `r${++regionSeq}`;
    const lastQuestion = [...questionRegions].pop();
    const kind: RegionKind = item.kind === "answer" ? "answer" : "question";
    const region: Region = { id, ...rectFrom(p, p), kind, target: kind === "answer" ? (item.problemId ?? (lastQuestion ? `region:${lastQuestion.id}` : null)) : null, title: "" };
    update({ regions: [...st.regions, region] });
    drag.current = { mode: "draw", id, start: p };
    setSelected(id);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.mode === "draw") setRegion(d.id, rectFrom(d.start, p));
    else if (d.mode === "resize") setRegion(d.id, rectFrom(d.fixed, p));
    else setRegion(d.id, moveRect(d.orig, p.x - d.start.x, p.y - d.start.y));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const r = st.regions.find((x) => x.id === d.id);
    if (r && !isUsableRect(r)) removeRegion(r.id);
    rootRef.current?.focus();
  };

  const pieces: Region[] = st.regions.length ? st.regions : [{ id: "whole", x: 0, y: 0, w: 1, h: 1, kind: st.wholeKind, target: st.wholeTarget, title: "" }];
  const { questions, unassigned } = I.regionProblems(pieces);
  const answers = pieces.length - questions;
  const actionLabel =
    questions && answers
      ? t("Create {q} problem(s) and attach {a} answer(s)", { q: questions, a: answers })
      : questions
        ? t("Create {q} problem(s)", { q: questions })
        : t("Attach {a} answer(s)", { a: answers });

  const next = (dir: 1 | -1) => {
    if (!item) return;
    const i = items.findIndex((x) => x.id === item.id);
    const n = items[i + dir];
    if (n) {
      setCurrentId(n.id);
      setSelected(null);
    }
  };

  const commit = async () => {
    if (!item || busy || unassigned) return;
    setBusy(true);
    const i = items.findIndex((x) => x.id === item.id);
    const following = items[i + 1] ?? items[i - 1] ?? null;
    try {
      await I.commitPhoto(item, st.quarter, pieces, { courseId, lectureId });
      setStates((all) => {
        const { [item.id]: _, ...rest } = all;
        return rest;
      });
      setSelected(null);
      setCurrentId(following?.id ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const typing = (e.target as HTMLElement).closest("input, select, textarea");
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void commit();
      return;
    }
    if (typing) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      removeRegion(selected);
    } else if (e.key.toLowerCase() === "r" && !e.ctrlKey) rotate(!e.shiftKey);
    else if (e.key.toLowerCase() === "q" && selected) setRegion(selected, { kind: "question" });
    else if (e.key.toLowerCase() === "a" && selected && !e.ctrlKey) setRegion(selected, { kind: "answer" });
    else if (e.key === "ArrowRight" || e.key === "j") next(1);
    else if (e.key === "ArrowLeft" || e.key === "k") next(-1);
    else if (e.key === "Escape") setSelected(null);
  };

  if (!items.length) {
    return (
      <div className="inbox-empty empty-state">
        <Smartphone size={28} strokeWidth={1.3} className="faint" />
        <div className="title">{t("No photos waiting")}</div>
        <p>
          {phone
            ? t("Photos you take with the phone page appear here.")
            : t("Connect your phone to send photos of problems and answers straight to this inbox.")}
        </p>
        <div className="row" style={{ gap: 8, justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={() => A.openDialog({ kind: "phone" })}>
            <Smartphone size={14} /> {phone ? t("Phone Link…") : t("Connect Phone…")}
          </button>
          <button className="btn" onClick={() => void I.addPhotos()}>
            <ImagePlus size={14} /> {t("Add Photos…")}
          </button>
          {folder && (
            <button className="btn btn-ghost" onClick={() => void I.collectFolder(true)}>
              {t("Check Folder")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="inbox" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="inbox-strip">
        {items.map((it) => (
          <Thumb
            key={it.id}
            item={it}
            active={it.id === item?.id}
            onClick={() => {
              setCurrentId(it.id);
              setSelected(null);
            }}
          />
        ))}
        <button className="inbox-add" title={t("Add Photos…")} onClick={() => void I.addPhotos()}>
          <ImagePlus size={16} />
        </button>
      </div>

      <div className="inbox-stage-wrap">
        <div className="inbox-toolbar">
          <span className="faint">
            {item && t("{origin} · {time}", { origin: item.origin === "phone" ? t("From phone") : item.origin === "folder" ? t("From folder") : t("Added here"), time: fmtDateTime(new Date(item.receivedAt)) })}
          </span>
          <span className="grow" />
          <button className="icon-btn" title={t("Rotate left (Shift+R)")} onClick={() => rotate(false)}>
            <RotateCcw size={15} />
          </button>
          <button className="icon-btn" title={t("Rotate right (R)")} onClick={() => rotate(true)}>
            <RotateCw size={15} />
          </button>
        </div>
        <div className="inbox-scroll">
          {url ? (
            <div
              className="inbox-stage"
              ref={stageRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <img src={url} alt="" draggable={false} />
              {st.regions.map((r) => (
                <div
                  key={r.id}
                  data-region={r.id}
                  className={`inbox-region ${r.kind}${selected === r.id ? " selected" : ""}`}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                >
                  <span className="inbox-region-num">{numberOf(r.id)}</span>
                  {["nw", "ne", "sw", "se"].map((h) => (
                    <span key={h} data-handle={h} className={`inbox-handle ${h}`} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="inbox-loading faint">{t("Loading…")}</div>
          )}
        </div>
      </div>

      <aside className="inbox-panel">
        <div className="inbox-panel-body">
          <div className="field">
            <div className="field-label">{t("New problems go to")}</div>
            <select
              className="select"
              value={courseId ?? ""}
              onChange={(e) => {
                setCourseId(e.target.value || null);
                setLectureId(null);
              }}
            >
              <option value="">{t("No course")}</option>
              {liveCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {courseLabel(c)}
                </option>
              ))}
            </select>
            {courseLectures.length > 0 && (
              <select className="select" style={{ marginTop: 6 }} value={lectureId ?? ""} onChange={(e) => setLectureId(e.target.value || null)}>
                <option value="">{t("No lecture")}</option>
                {courseLectures.map((l) => (
                  <option key={l.id} value={l.id}>
                    {lectureLabel(l)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {st.regions.length === 0 ? (
            <div className="inbox-whole">
              <p className="faint small">{t("Drag on the photo to mark each problem or answer. Without a selection the whole photo is used.")}</p>
              <div className="inbox-piece">
                <span className="inbox-piece-num">·</span>
                <div className="inbox-piece-body">
                  <KindSwitch value={st.wholeKind} onChange={(k) => update({ wholeKind: k })} />
                  {st.wholeKind === "answer" && (
                    <select className={`select${st.wholeTarget ? "" : " missing"}`} value={st.wholeTarget ?? ""} onChange={(e) => update({ wholeTarget: e.target.value || null })}>
                      <option value="">{t("Answer for which problem?")}</option>
                      <ProblemOptions />
                    </select>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="inbox-pieces">
              {ordered.map((r) => (
                <div key={r.id} className={`inbox-piece${selected === r.id ? " selected" : ""}`} onClick={() => setSelected(r.id)}>
                  <span className={`inbox-piece-num ${r.kind}`}>{numberOf(r.id)}</span>
                  <div className="inbox-piece-body">
                    <div className="row" style={{ gap: 6 }}>
                      <KindSwitch value={r.kind} onChange={(k) => setRegion(r.id, { kind: k, target: k === "answer" ? r.target : null })} />
                      <span className="grow" />
                      <button className="icon-btn sm" title={t("Remove selection (Delete)")} onClick={() => removeRegion(r.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {r.kind === "question" ? (
                      <input className="input" placeholder={t("Title (optional)")} value={r.title} onChange={(e) => setRegion(r.id, { title: e.target.value })} />
                    ) : (
                      <select className={`select${r.target ? "" : " missing"}`} value={r.target ?? ""} onChange={(e) => setRegion(r.id, { target: e.target.value || null })}>
                        <option value="">{t("Answer for which problem?")}</option>
                        <ProblemOptions extra={fromPhoto} />
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="inbox-panel-foot">
          {unassigned > 0 && <p className="inbox-warn small">{t("Choose the problem each answer belongs to.")}</p>}
          <button className="btn btn-primary inbox-commit" disabled={busy || unassigned > 0} onClick={() => void commit()} title="Ctrl+Enter">
            {actionLabel}
          </button>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => item && void I.discardPhoto(item)}>
              <Trash2 size={13} /> {t("Discard Photo")}
            </button>
            <span className="grow" />
            <span className="faint small">
              {items.findIndex((x) => x.id === item?.id) + 1} / {items.length}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Used by the app-wide drop handler while the inbox is in front. */
export function inboxInFront(): boolean {
  const s = get();
  const g = s.groups[s.activeGroup];
  return g?.tabs.find((x) => x.id === g.activeId)?.kind === "inbox";
}
