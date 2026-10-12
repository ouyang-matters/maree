import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardCopy, MessageSquareShare, X } from "lucide-react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import { CHATGPT_FILE_LIMIT, copyForChatGpt, openInbox } from "../state/inbox";
import { clearTray, moveInTray, removeFromTray } from "../state/tray";
import { chatGptSections } from "../export/chatgpt";
import { MathView } from "./MathView";
import { t } from "../i18n";
import type { Problem } from "../data/types";

/** Number of pictures a problem becomes when copied (typed text counts as one picture). */
function pictureCount(p: Problem): { question: number; answer: number } {
  const { question, answer } = chatGptSections(p);
  return { question: (question.text ? 1 : 0) + question.images.length, answer: (answer.text ? 1 : 0) + answer.images.length };
}

export function TrayView() {
  const tray = useStore((s) => s.settings.chatTray);
  const problems = useStore((s) => s.problems);
  const cache = useStore((s) => s.problemCache);
  const ids = useMemo(() => {
    const live = new Set(problems.filter((p) => !p.deletedAt).map((p) => p.id));
    return tray.filter((id) => live.has(id));
  }, [tray, problems]);
  // Everything starts ticked; unticking leaves a problem in the tray but out of the copy.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    for (const id of ids) if (!cache[id]) void A.loadProblem(id);
  }, [ids, cache]);

  const chosen = ids.filter((id) => !unticked.has(id));
  const images = chosen.reduce((n, id) => {
    const p = cache[id];
    if (!p) return n;
    const c = pictureCount(p);
    return n + c.question + c.answer;
  }, 0);
  const toggle = (id: string) =>
    setUnticked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!ids.length) {
    return (
      <div className="tray-empty empty-state">
        <MessageSquareShare size={28} strokeWidth={1.3} className="faint" />
        <div className="title">{t("Nothing gathered for ChatGPT")}</div>
        <p>{t("Problems you crop from a photo land here, each with your answer. You can also add problems from the list (right-click › Add to To ChatGPT).")}</p>
        <button className="btn" onClick={openInbox}>
          {t("Open Photo Inbox")}
        </button>
      </div>
    );
  }

  return (
    <div className="tray">
      <div className="tray-head">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={chosen.length === ids.length}
            ref={(el) => {
              if (el) el.indeterminate = chosen.length > 0 && chosen.length < ids.length;
            }}
            onChange={() => setUnticked(chosen.length === ids.length ? new Set(ids) : new Set())}
          />
          {t("{n} of {m} problems", { n: chosen.length, m: ids.length })}
        </label>
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => void clearTray()}>
          {t("Clear")}
        </button>
        <button
          className="btn btn-primary"
          disabled={!chosen.length || busy}
          onClick={async () => {
            setBusy(true);
            await copyForChatGpt(chosen);
            setBusy(false);
          }}
          title="Ctrl+V in ChatGPT"
        >
          <ClipboardCopy size={14} /> {t("Copy {n} images", { n: images })}
        </button>
      </div>
      {images > CHATGPT_FILE_LIMIT && (
        <p className="tray-warn">{t("ChatGPT takes about {max} files per message; untick some problems and send them in two messages.", { max: CHATGPT_FILE_LIMIT })}</p>
      )}
      <ol className="tray-list">
        {ids.map((id, i) => {
          const p = cache[id];
          const on = !unticked.has(id);
          const parts = p ? [...p.parts].sort((a, b) => a.sortOrder - b.sortOrder) : [];
          return (
            <li key={id} className={`tray-item${on ? "" : " off"}`}>
              <div className="tray-item-head">
                <input type="checkbox" checked={on} onChange={() => toggle(id)} aria-label={t("Include in the copy")} />
                <span className="tray-num">Q{i + 1}</span>
                <button className="tray-title link-btn" onClick={() => void A.openProblem(id, { preview: false })}>
                  {p?.title || t("Untitled problem")}
                </button>
                <span className="grow" />
                <button className="icon-btn sm" title={t("Move up")} disabled={i === 0} onClick={() => void moveInTray(id, -1)}>
                  <ArrowUp size={13} />
                </button>
                <button className="icon-btn sm" title={t("Move down")} disabled={i === ids.length - 1} onClick={() => void moveInTray(id, 1)}>
                  <ArrowDown size={13} />
                </button>
                <button className="icon-btn sm" title={t("Remove from To ChatGPT")} onClick={() => void removeFromTray([id])}>
                  <X size={13} />
                </button>
              </div>
              {p ? (
                <div className="tray-cols">
                  <div className="tray-col">
                    <div className="tray-col-label">{t("Problem")}</div>
                    <MathView source={p.statement} attachments={p.attachments} className="tray-prose" empty={t("No statement")} />
                    {parts.map((pt) => (
                      <MathView key={pt.id} source={`**(${pt.label})** ${pt.statement}`} attachments={p.attachments} className="tray-prose" />
                    ))}
                  </div>
                  <div className="tray-col">
                    <div className="tray-col-label">{t("My answer")}</div>
                    {p.solution.trim() || parts.some((pt) => pt.solution.trim()) ? (
                      <>
                        <MathView source={p.solution} attachments={p.attachments} className="tray-prose" />
                        {parts
                          .filter((pt) => pt.solution.trim())
                          .map((pt) => (
                            <MathView key={pt.id} source={`**(${pt.label})** ${pt.solution}`} attachments={p.attachments} className="tray-prose" />
                          ))}
                      </>
                    ) : (
                      <p className="faint tray-none">{t("No answer yet — only the problem will be sent.")}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="faint tray-none">{t("Loading…")}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
