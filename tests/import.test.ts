import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { segment, matchPart } from "../src/import/segment";
import { extractMarkdown } from "../src/import/extract-text";
import { extractLatex } from "../src/import/extract-latex";
import { extractPdf, type PdfjsLike } from "../src/import/extract-pdf";
import { extractProblemSetJson } from "../src/import/extract-json";
import { detectCourseCodes, parseLectureNumbers, suggestCategory, suggestTopics } from "../src/import/classify";
import { DuplicateIndex } from "../src/import/duplicates";
import { commitPlans, extractDocument, planDocument, sha256Hex, type LibraryContext } from "../src/import/pipeline";
import { assistedLatex, hasTexControlDelimiters, normalizeExtracted } from "../src/math/unicode";
import { freshRepo } from "./helpers/node-driver";
import type { Topic } from "../src/data/types";

const FIXTURE = join(__dirname, "fixtures", "MATH147_Proof_Practice_Lectures_7-12.pdf");
const lib = pdfjs as unknown as PdfjsLike;

function topic(id: string, name: string, keywords = ""): Topic {
  return { id, name, keywords, parentId: null, description: "", sortOrder: 0, isSample: false, createdAt: "", updatedAt: "" };
}

describe("segmentation", () => {
  it("splits keyword-style problems and tracks lecture headings", () => {
    const doc = extractMarkdown(
      "set.md",
      [
        "# Proof practice",
        "Instructions: write full proofs.",
        "## Lecture 9 — Monotone Sequences",
        "**Problem 5.** Define \\(x_1=1\\), \\(x_{n+1}=\\sqrt{2+x_n}\\).",
        "(a) Show \\((x_n)\\) is increasing.",
        "(b) Show it is bounded above by 2.",
        "(c) Find the limit.",
        "",
        "Problem 6 (Euler). Show \\((1+1/n)^n\\) converges.",
        "## Lecture 10: Subsequences",
        "Problem 7. Every subsequence of a convergent sequence converges.",
      ].join("\n"),
    );
    const seg = segment(doc.lines);
    expect(seg.style).toBe("keyword");
    expect(seg.problems.map((p) => p.number)).toEqual(["5", "6", "7"]);
    expect(seg.problems[0].parts.map((p) => p.label)).toEqual(["a", "b", "c"]);
    expect(seg.problems[0].lecture?.number).toBe("9");
    expect(seg.problems[1].title).toBe("Euler");
    expect(seg.problems[2].lecture).toEqual({ number: "10", title: "Subsequences" });
    expect(seg.lectures.map((l) => l.number)).toEqual(["9", "10"]);
    expect(seg.preamble.map((l) => l.text).join(" ")).toContain("Instructions");
  });

  it("falls back to ascending numbered items and ignores inner restarts", () => {
    const doc = extractMarkdown(
      "list.txt",
      "1. Prove that \\(\\sqrt2\\) is irrational.\n2. Show that:\n   1. first claim\n   2. second claim\n3. Compute \\(\\sum_{k=1}^n k\\).",
    );
    const seg = segment(doc.lines);
    expect(seg.style).toBe("numbered");
    expect(seg.problems.map((p) => p.number)).toEqual(["1", "2", "3"]);
    expect(seg.problems[1].confidence).toBe("medium");
  });

  it("merges 4(a), 4(b) into one problem with parts", () => {
    const doc = extractMarkdown("x.md", "Problem 4(a). Show A.\n\nProblem 4(b). Show B.\n\nProblem 5. Other.");
    const seg = segment(doc.lines);
    expect(seg.problems.map((p) => p.number)).toEqual(["4", "5"]);
    expect(seg.problems[0].parts.map((p) => p.label)).toEqual(["a", "b"]);
  });

  it("only accepts parts in sequence", () => {
    expect(matchPart("(a) foo")).toEqual({ label: "a", rest: "foo" });
    const doc = extractMarkdown("x.md", "Problem 1. Note (c) is a remark.\n(b) not a part\n(a) first\n(b) second");
    const seg = segment(doc.lines);
    expect(seg.problems[0].parts.map((p) => p.label)).toEqual(["a", "b"]);
  });

  it("treats an unstructured document as one low-confidence problem", () => {
    const doc = extractMarkdown("x.txt", "Show that every Cauchy sequence is bounded.");
    const seg = segment(doc.lines);
    expect(seg.style).toBe("single");
    expect(seg.problems).toHaveLength(1);
    expect(seg.problems[0].confidence).toBe("low");
  });
});

describe("LaTeX extraction", () => {
  it("reads problem environments, numbering, parts and solutions verbatim", () => {
    const tex = String.raw`\documentclass{article}
\newtheorem{problem}{Problem}[section]
\title{MATH 147 Assignment 3}
\begin{document}
\section{Lecture 11: Bolzano--Weierstrass}
% a comment that must disappear
\begin{problem}[Bounded sequences]
Let $(x_n)$ be bounded. % trailing comment
\begin{enumerate}[label=(\alph*)]
\item Show $\limsup x_n$ exists.
\item Prove $\liminf x_n \le \limsup x_n$.
\end{enumerate}
\end{problem}
\begin{solution}
Use \(\sup_{k\ge n} x_k\).
\end{solution}
\begin{problem}
Prove that $\sum_{n=1}^\infty \frac{1}{n^2} < 2$.
\end{problem}
\end{document}`;
    const doc = extractLatex("a3.tex", tex);
    expect(doc.title).toBe("MATH 147 Assignment 3");
    const seg = segment(doc.lines);
    expect(seg.style).toBe("structured");
    expect(seg.problems.map((p) => p.number)).toEqual(["1.1", "1.2"]);
    const p1 = seg.problems[0];
    expect(p1.title).toBe("Bounded sequences");
    expect(p1.parts.map((p) => p.label)).toEqual(["a", "b"]);
    expect(p1.parts[1].lines[0].text).toBe("Prove $\\liminf x_n \\le \\limsup x_n$.");
    expect(p1.solution.map((l) => l.text).join("")).toContain("\\sup_{k\\ge n}");
    expect(p1.lecture?.number).toBe("11");
    expect(JSON.stringify(doc.lines)).not.toContain("comment");
    expect(seg.problems[1].lines[0].text).toBe("Prove that $\\sum_{n=1}^\\infty \\frac{1}{n^2} < 2$.");
  });

  it("uses top-level enumerate items as problems when there are no problem environments", () => {
    const doc = extractLatex(
      "ps.tex",
      "\\begin{enumerate}\n\\item Show $a$.\n\\begin{enumerate}\n\\item first\n\\item second\n\\end{enumerate}\n\\item Show $b$.\n\\end{enumerate}",
    );
    const seg = segment(doc.lines);
    expect(seg.problems.map((p) => p.number)).toEqual(["1", "2"]);
    expect(seg.problems[0].parts.map((p) => p.label)).toEqual(["a", "b"]);
  });
});

describe("PDF extraction (real LaTeX-typeset PDF)", () => {
  it("recovers all ten problems with numbers, pages, lectures and parts", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const doc = await extractPdf("MATH147_Proof_Practice_Lectures_7-12.pdf", bytes, lib);
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    expect(doc.reliability).toBe("uncertain");
    const seg = segment(doc.lines);
    expect(seg.style).toBe("keyword");
    expect(seg.problems.map((p) => p.number)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(seg.lectures.map((l) => l.number)).toEqual(["7", "8", "9", "10", "11", "12"]);
    const byNum = Object.fromEntries(seg.problems.map((p) => [p.number, p]));
    expect(byNum["1"].lecture?.number).toBe("7");
    expect(byNum["5"].lecture).toEqual({ number: "9", title: "Monotone Sequences" });
    expect(byNum["9"].lecture?.number).toBe("12");
    expect(byNum["4"].parts.map((p) => p.label)).toEqual(["a", "b"]);
    for (const p of seg.problems) expect(p.page).toBeGreaterThanOrEqual(1);
    // The plain text is preserved as extracted, including Unicode symbols.
    const p2 = byNum["2"].lines.map((l) => l.text).join(" ");
    expect(p2).toContain("≤");
    expect(p2).toContain("∈");
    // Subscripts are detected and flagged; assisted text proposes LaTeX for them.
    const flags = byNum["2"].raw.flatMap((l) => l.flags ?? []).map((f) => f.code);
    expect(flags).toContain("lost-scripts");
    expect(flags).toContain("math-unicode");
    const assisted = byNum["2"].lines.map((l) => l.assisted).join(" ");
    expect(assisted).toContain("x_{n}");
    expect(assisted).toContain("\\le");
  });

  it("builds a plan with course, lecture mapping, topics and categories", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const doc = await extractDocument("MATH147_Proof_Practice_Lectures_7-12.pdf", bytes, { loadPdfjs: async () => lib });
    const ctx: LibraryContext = {
      courses: [{ id: "c147", code: "MATH 147", title: "Advanced Calculus", term: "", description: "", color: null, archived: false, sortOrder: 1, isSample: false, createdAt: "", updatedAt: "" }],
      lectures: [7, 8, 9, 10, 11, 12].map((n) => ({
        id: `l${n}`, courseId: "c147", number: String(n), title: "", date: null, description: "", sortOrder: n, isSample: false, createdAt: "", updatedAt: "",
      })),
      topics: [topic("t-mct", "MCT"), topic("t-sub", "Subsequences"), topic("t-cau", "Cauchy Sequences"), topic("t-bw", "Bolzano–Weierstrass")],
      existing: [],
    };
    const plan = planDocument({ fileName: doc.fileName, hash: null, size: bytes.length, doc }, ctx);
    expect(plan.courseId).toBe("c147");
    expect(plan.courseReason).toMatch(/MATH 147/);
    expect(plan.sourceKind).toBe("problem-set");
    expect(plan.lectureMap.map((m) => [m.ref, m.lectureId])).toEqual([
      ["7", "l7"], ["8", "l8"], ["9", "l9"], ["10", "l10"], ["11", "l11"], ["12", "l12"],
    ]);
    const c = Object.fromEntries(plan.candidates.map((x) => [x.number, x]));
    expect(c["5"].lectureIds).toEqual(["l9"]);
    expect(c["5"].topicIds).toContain("t-mct");
    expect(c["7"].topicIds).toContain("t-sub");
    expect(c["8"].topicIds).toContain("t-bw");
    expect(c["9"].topicIds).toContain("t-cau");
    expect(c["1"].category).toBe("proof");
    expect(c["4"].splitParts).toBe(true);
    expect(c["2"].flags.length).toBeGreaterThan(0);
    expect(c["2"].rawText).toContain("Problem 2.");
  });
});

describe("classification", () => {
  it("detects course codes and lecture ranges in file names", () => {
    expect(detectCourseCodes("MATH147_Proof_Practice_Lectures_7-12.pdf")).toEqual(["MATH 147"]);
    expect(detectCourseCodes("cs-145 assignment 2 Fall2025")).toEqual(["CS 145"]);
    expect(parseLectureNumbers("MATH147 Proof Practice Lectures 7-12")).toEqual([7, 8, 9, 10, 11, 12]);
    expect(parseLectureNumbers("notes_lec09")).toEqual([9]);
  });

  it("maps vocabulary onto existing topics via names and aliases", () => {
    const topics = [topic("a", "MCT"), topic("b", "Limit Superior / Inferior"), topic("c", "Recursion", "recursive, recurrence")];
    const r = suggestTopics("Show the sequence is increasing and bounded above, so it converges. Define it recursively.", topics);
    expect(r.hits.map((h) => h.topicId).sort()).toEqual(["a", "c"]);
    const s = suggestTopics("Compute \\(\\limsup x_n\\).", topics);
    expect(s.hits.map((h) => h.topicId)).toEqual(["b"]);
    expect(suggestTopics("Prove every Cauchy sequence is bounded.", []).newNames).toContain("Cauchy Sequences");
  });

  it("suggests a category from the verbs used", () => {
    expect(suggestCategory("Prove that \\(x\\ge 0\\).")).toBe("proof");
    expect(suggestCategory("Compute \\(\\int_0^1 x\\,dx\\).")).toBe("calculation");
    expect(suggestCategory("Give an example of a bounded divergent sequence.")).toBe("conceptual");
  });
});

describe("duplicates", () => {
  it("finds exact and near-duplicates but not unrelated problems", () => {
    const idx = new DuplicateIndex([
      { id: "p1", label: "P1", statement: "Prove that every convergent sequence of real numbers is bounded above and below." },
    ]);
    expect(idx.find("Prove that every convergent sequence of real numbers is bounded above and below.")?.similarity).toBe(1);
    expect(idx.find("Prove that  every convergent sequence of real numbers is bounded above and below!")?.id).toBe("p1");
    expect(idx.find("Prove that every Cauchy sequence converges in the reals.")).toBeNull();
  });
});

describe("unicode handling", () => {
  it("decodes TeX extension-font delimiters and drops variation selectors", () => {
    // Fonts without a Unicode map give large brackets as control characters at their cmex positions.
    const raw = String.fromCharCode(0x12) + "1 + 1/n" + String.fromCharCode(0x13) + "n, " + "√" + String.fromCharCode(0xfe01) + "2";
    expect(normalizeExtracted(raw)).toBe("(1 + 1/n)n, √2");
    expect(hasTexControlDelimiters(raw)).toBe(true);
    expect(hasTexControlDelimiters("plain (text)")).toBe(false);
  });

  it("normalises ligatures and math alphanumerics losslessly", () => {
    expect(normalizeExtracted("ﬁnite 𝑥 𝑛")).toBe("finite x n");
  });

  it("assisted conversion wraps math runs and leaves prose alone", () => {
    expect(assistedLatex("Let (x_{n}) be a sequence with x_{n} → L as n → ∞.")).toBe(
      "Let \\((x_{n})\\) be a sequence with \\(x_{n} \\to L\\) as \\(n \\to \\infty\\).",
    );
    expect(assistedLatex("Prove that a bounded sequence converges.")).toBe("Prove that a bounded sequence converges.");
  });
});

describe("JSON problem sets", () => {
  it("reads the documented format", () => {
    const doc = extractProblemSetJson("set.json", {
      format: "maree-problems",
      version: 1,
      course: "MATH 147",
      source: { title: "Problem Set 4", kind: "problem-set" },
      problems: [{ number: "1", statement: "Prove \\(1+1=2\\).", lecture: "9", topics: ["MCT"], difficulty: 2, category: "proof" }],
    });
    expect(doc.structured).toHaveLength(1);
    expect(doc.meta?.course).toBe("MATH 147");
    expect(() => extractProblemSetJson("bad.json", { nope: true })).toThrow(/Unrecognised JSON/);
  });
});

describe("import commit", () => {
  it("stores provenance, creates lectures and detects re-imports", async () => {
    const { repo } = await freshRepo();
    const course = await repo.createCourse({ code: "MATH 147", title: "Advanced Calculus" });
    await repo.createLectures([{ courseId: course.id, number: "7" }, { courseId: course.id, number: "8" }]);
    const [mct] = await repo.createTopics([{ name: "MCT" }]);
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const hash = await sha256Hex(bytes);
    const doc = await extractDocument("MATH147_Proof_Practice_Lectures_7-12.pdf", bytes, { loadPdfjs: async () => lib });
    const ctx = async (): Promise<LibraryContext> => ({
      courses: await repo.listCourses(),
      lectures: await repo.listLectures(),
      topics: await repo.listTopics(),
      existing: (await repo.listStatements()).map((s) => ({ id: s.id, label: s.title, statement: s.statement })),
    });
    const plan = planDocument({ fileName: doc.fileName, bytes, hash, size: bytes.length, doc }, await ctx());
    // Lectures 9–12 do not exist yet and will be created.
    expect(plan.lectureMap.filter((m) => m.create).map((m) => m.ref)).toEqual(["9", "10", "11", "12"]);
    expect(plan.lectureMap.find((m) => m.ref === "9")?.title).toBe("Monotone Sequences");
    const stored: string[] = [];
    const res = await commitPlans([plan], {
      repo,
      storeFile: async (kind, name) => {
        stored.push(`${kind}/${name}`);
        return { storedPath: `${kind}/x/${hash}.pdf`, hash, size: bytes.length };
      },
    });
    expect(res.problemIds).toHaveLength(10);
    expect(res.createdLectures).toBe(4);
    expect(stored).toEqual(["sources/MATH147_Proof_Practice_Lectures_7-12.pdf"]);

    const [src] = await repo.listSources();
    expect(src.fileHash).toBe(hash);
    expect(src.fileName).toBe("MATH147_Proof_Practice_Lectures_7-12.pdf");
    expect(src.format).toBe("pdf");
    expect(src.pageCount).toBe(doc.pageCount);
    expect(src.courseId).toBe(course.id);
    const sums = await repo.listSummaries();
    const p5 = sums.find((s) => s.sourceNumber === "5")!;
    const full = (await repo.getProblem(p5.id))!;
    expect(full.sourceId).toBe(src.id);
    expect(full.sourcePage).toBeGreaterThanOrEqual(1);
    expect(full.sourceExcerpt).toContain("Problem 5.");
    expect(full.topicIds).toContain(mct.id);
    expect(full.importFlags.length).toBeGreaterThan(0);
    expect(full.history[0].kind).toBe("imported");
    const lec9 = (await repo.listLectures()).find((l) => l.number === "9")!;
    expect(full.lectureIds).toEqual([lec9.id]);
    const p4 = (await repo.getProblem(sums.find((s) => s.sourceNumber === "4")!.id))!;
    expect(p4.parts.map((p) => p.label)).toEqual(["a", "b"]);

    // Importing the same file again: the source is recognised and problems are duplicates.
    const again = planDocument(
      { fileName: doc.fileName, bytes, hash, size: bytes.length, doc },
      await ctx(),
      await repo.findSourcesByHash(hash),
    );
    expect(again.skip).toBe(true);
    expect(again.existingSources).toHaveLength(1);
    expect(again.candidates.every((c) => c.duplicateOf && !c.include)).toBe(true);
  });
});

describe("review sheets with level tags (PDF)", () => {
  it("reads lecture labels with titles on the next line, question titles, levels and CORE", async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", "levels-problem-set.pdf")));
    const doc = await extractDocument("MATH147_Midterm_Review.pdf", bytes, { loadPdfjs: async () => lib });
    const plan = planDocument({ fileName: doc.fileName, hash: null, size: bytes.length, doc }, { courses: [], lectures: [], topics: [], existing: [] });
    expect(plan.candidates.map((c) => c.number)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(plan.lectureMap.map((m) => [m.ref, m.title, m.description, m.count])).toEqual([
      ["7", "Convergence & Divergence", "Notes pp. 27–30", 3],
      ["8", "Algebra of Limits", "Notes pp. 31–32", 3],
    ]);
    const c = Object.fromEntries(plan.candidates.map((x) => [x.number, x]));
    expect(c["1"].title).toBe("Uniqueness Lemma");
    expect(c["3"].title).toBe("A Non-Cauchy Sequence");
    expect(c["5"].title).toBe("Euler’s Number");
    expect(plan.candidates.map((x) => x.difficulty)).toEqual([1, 2, 2, 1, 3, 4]);
    expect(plan.candidates.map((x) => x.priority)).toEqual([0, 3, 0, 0, 0, 3]);
    // Headings, running header/footer and the next lecture never leak into statements.
    expect(c["1"].statement.startsWith("Let a, b")).toBe(true);
    for (const x of plan.candidates) expect(x.statement).not.toMatch(/LECTURE|NO SOLUTIONS|MIDTERM|Algebra of Limits$/);
    expect(c["4"].section).toBe("Lecture 8 — Algebra of Limits (notes pp. 31–32)");
    expect(c["5"].statement).toContain("(1 + ");
  });

  it("only reads L1–L4 as levels when the document defines them", async () => {
    const { parseTrailingTags } = await import("../src/import/segment");
    expect(parseTrailingTags("Squeeze Theorem L2 CORE", true)).toEqual({ rest: "Squeeze Theorem", difficulty: 2, priority: 3 });
    expect(parseTrailingTags("Squeeze Theorem L2", false)).toEqual({ rest: "Squeeze Theorem L2", difficulty: null, priority: 0 });
    expect(parseTrailingTags("Squeeze Theorem Level 3", false)).toEqual({ rest: "Squeeze Theorem", difficulty: 3, priority: 0 });
  });
});

describe("decimal problem headings", () => {
  it("splits '7.1 Title L1' problem sets by lecture, with levels as difficulty", () => {
    const lines = [
      "Levels: L1 direct, L2 standard application, L3 multi-step, L4 challenge.",
      "Lecture 7 — Convergence, Boundedness & Divergence",
      "7.1 Direct limit and global bound L1",
      "Let an = 2n−1 n+3 . Prove directly from the definition that an → 2.",
      "",
      "7.2 Bounded but divergent L2",
      "Let an = (−1)n(2 + 1n ). Show that {an} is bounded.",
      "Lecture 8 — Infinite Limits & Algebra of Limits",
      "8.1 Rational limit, direct proof L1",
      "Prove directly, with an explicit Nε, that the limit is 5/3.",
    ].map((text) => ({ text, page: 1, heading: text.startsWith("Lecture") ? 3 : undefined }));
    const seg = segment(lines);
    expect(seg.problems.map((p) => [p.number, p.title, p.difficulty, p.lecture?.number])).toEqual([
      ["7.1", "Direct limit and global bound", 1, "7"],
      ["7.2", "Bounded but divergent", 2, "7"],
      ["8.1", "Rational limit, direct proof", 1, "8"],
    ]);
    expect(seg.problems[0].lines.map((l) => l.text).join(" ")).toContain("Prove directly from the definition");
  });
});
