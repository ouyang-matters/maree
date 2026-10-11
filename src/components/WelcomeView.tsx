import { useState } from "react";
import { Check, FileInput, PencilLine } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore, get } from "../state/store";
import * as A from "../state/actions";
import { courseLabel } from "../domain/filters";
import { WaveRule } from "../ui/icons";
import { t } from "../i18n";

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={`ob-step${done ? " done" : ""}`}>
      <span className="ob-n">{done ? <Check size={13} /> : n}</span>
      <div className="ob-content">
        <div className="ob-title">{title}</div>
        {children}
      </div>
    </li>
  );
}

export function WelcomeView() {
  const courses = useStore(useShallow((s) => s.courses.filter((c) => !c.isSample)));
  const lectures = useStore(useShallow((s) => s.lectures.filter((l) => !l.isSample)));
  const topics = useStore(useShallow((s) => s.topics.filter((x) => !x.isSample)));
  const sources = useStore(useShallow((s) => s.sources.filter((x) => !x.isSample)));
  const problems = useStore(useShallow((s) => s.problems.filter((p) => !p.isSample && !p.deletedAt)));
  const hasSample = useStore((s) => s.hasSample);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("12");
  const [courseId, setCourseId] = useState<string>("");
  const [topicText, setTopicText] = useState("");
  const course = courses.find((c) => c.id === courseId) ?? courses[courses.length - 1];
  const worked = problems.some((p) => p.hasSolution || p.status !== "not_started");

  const finish = async () => {
    await A.updateSettings({ onboardingDone: true });
    await A.closeTab(get().activeGroup, "welcome");
  };

  return (
    <div className="doc-view welcome">
      <div className="doc-inner narrow">
        <div className="welcome-mark">
          <span className="wordmark">Marée</span>
          <WaveRule width={72} />
          <p className="muted">{t("A quiet place for the mathematics you are learning: collect exercises, write proofs, and come back to them.")}</p>
        </div>
        <ol className="ob-steps">
          <Step n={1} done={courses.length > 0} title={t("Create a course")}>
            {courses.length > 0 ? (
              <p className="muted">{courses.map((c) => courseLabel(c)).join(" · ")}</p>
            ) : (
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!code.trim() && !title.trim()) return;
                  const id = await A.createCourse({ code, title });
                  setCourseId(id);
                  setCode("");
                  setTitle("");
                }}
              >
                <input className="input" style={{ width: 120 }} placeholder="MATH 147" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("Course code")} />
                <input className="input grow" placeholder={t("Advanced Calculus")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Course title")} />
                <button className="btn btn-primary" type="submit">
                  {t("Create")}
                </button>
              </form>
            )}
          </Step>
          <Step n={2} done={lectures.length > 0} title={t("Add lectures")}>
            {course ? (
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const a = parseInt(from, 10);
                  const b = parseInt(to, 10);
                  if (!(a >= 0) || !(b >= a) || b - a > 60) return;
                  const existing = new Set(get().lectures.filter((l) => l.courseId === course.id).map((l) => l.number));
                  const nums = Array.from({ length: b - a + 1 }, (_, i) => String(a + i)).filter((n) => !existing.has(n));
                  await A.createLectures(nums.map((n) => ({ courseId: course.id, number: n })));
                }}
              >
                {courses.length > 1 && (
                  <select className="select" value={course.id} onChange={(e) => setCourseId(e.target.value)}>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code || c.title}
                      </option>
                    ))}
                  </select>
                )}
                <span className="muted">{t("Lectures")}</span>
                <input className="input" style={{ width: 56 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("First lecture")} />
                <span className="muted">–</span>
                <input className="input" style={{ width: 56 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("Last lecture")} />
                <button className="btn" type="submit">
                  {t("Add")}
                </button>
                {lectures.length > 0 && <span className="muted">{t("{n} lectures", { n: lectures.length })}</span>}
              </form>
            ) : (
              <p className="muted">{t("Create a course first. Titles and dates can be added later from the sidebar.")}</p>
            )}
          </Step>
          <Step n={3} done={topics.length > 0} title={t("Add topics")}>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                const names = topicText
                  .split(/[,;\n]/)
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .filter((n) => !get().topics.some((tp) => tp.name.toLowerCase() === n.toLowerCase()));
                for (const name of names) await A.createTopic({ name });
                setTopicText("");
              }}
            >
              <input
                className="input grow"
                placeholder={t("MCT, Subsequences, Cauchy Sequences")}
                value={topicText}
                onChange={(e) => setTopicText(e.target.value)}
                aria-label={t("Topics, separated by commas")}
              />
              <button className="btn" type="submit">
                {t("Add")}
              </button>
            </form>
            {topics.length > 0 && <p className="muted">{topics.map((x) => x.name).join(" · ")}</p>}
          </Step>
          <Step n={4} done={sources.length > 0} title={t("Import an exercise document")}>
            <div className="row">
              <button className="btn" onClick={() => A.pickAndImport()}>
                <FileInput size={14} /> {t("Choose files…")}
              </button>
              <span className="muted">{t("PDF, LaTeX, Markdown, Word, text or JSON — or drop files anywhere.")}</span>
            </div>
          </Step>
          <Step n={5} done={worked} title={t("Open a problem and begin writing")}>
            <div className="row">
              {problems.length ? (
                <button className="btn" onClick={() => A.openProblem(problems[0].id)}>
                  <PencilLine size={14} /> {t("Open a problem")}
                </button>
              ) : (
                <button className="btn" onClick={() => A.createProblem()}>
                  <PencilLine size={14} /> {t("Write a problem by hand")}
                </button>
              )}
              <span className="muted">{t("Your proof is saved automatically as you type.")}</span>
            </div>
          </Step>
        </ol>
        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" onClick={finish}>
            {t("Start using Marée")}
          </button>
          {!hasSample && (
            <button className="btn btn-ghost" onClick={() => A.loadSample()}>
              {t("Load a small sample library")}
            </button>
          )}
        </div>
        <p className="faint" style={{ marginTop: 18, fontSize: 12 }}>
          {t("Everything stays on this computer. No account, no cloud.")}
        </p>
      </div>
    </div>
  );
}
