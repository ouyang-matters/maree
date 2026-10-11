import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshRepo } from "./helpers/node-driver";
import { loadSampleLibrary } from "../src/data/sample";
import { exportLibrary, importLibrary, libraryStatements, validateLibrary } from "../src/export/library-json";
import { collectionToLatex, collectionToMarkdown, DEFAULT_EXPORT, markdownToLatex } from "../src/export/documents";
import { buildIndex } from "../src/domain/filters";
import { DEFAULT_MACROS, checkLatex } from "../src/math/render";
import type { Problem } from "../src/data/types";

async function sampleRepo() {
  const r = await freshRepo();
  await loadSampleLibrary(r.repo);
  return r;
}

async function fullProblems(repo: Awaited<ReturnType<typeof freshRepo>>["repo"]): Promise<Problem[]> {
  const out: Problem[] = [];
  for (const s of await repo.listSummaries()) out.push((await repo.getProblem(s.id))!);
  return out;
}

describe("sample library", () => {
  it("loads valid LaTeX everywhere and is fully removable", async () => {
    const { repo } = await sampleRepo();
    const problems = await fullProblems(repo);
    expect(problems.length).toBe(8);
    for (const p of problems) {
      const all = [p.statement, p.solution, p.referenceSolution, p.notes, ...p.parts.flatMap((x) => [x.statement, x.solution])].join("\n\n");
      expect(checkLatex(all), p.title).toEqual([]);
    }
    const newton = problems.find((p) => p.sourceNumber === "4")!;
    expect(newton.status).toBe("in_progress");
    await repo.removeSample();
    expect(await repo.listSummaries()).toEqual([]);
    expect(await repo.listCourses()).toEqual([]);
    expect(await repo.listTopics()).toEqual([]);
  });
});

describe("library JSON", () => {
  it("round-trips a complete library into an empty one", async () => {
    const { repo } = await sampleRepo();
    const json = JSON.parse(JSON.stringify(await exportLibrary(repo, "1.0.0")));
    const lib = validateLibrary(json);
    const { repo: target } = await freshRepo();
    await importLibrary(target, lib, "keep");
    const a = await fullProblems(repo);
    const b = await fullProblems(target);
    const strip = (ps: Problem[]) =>
      ps
        .map((p) => ({ ...p, topicIds: [...p.topicIds].sort(), lectureIds: [...p.lectureIds].sort() }))
        .sort((x, y) => x.id.localeCompare(y.id));
    expect(strip(b)).toEqual(strip(a));
    expect((await target.listTopics()).length).toBe((await repo.listTopics()).length);
    expect((await target.search("telescoping")).size).toBe(1);
  });

  it("merging keeps local edits while overwrite restores the export", async () => {
    const { repo } = await sampleRepo();
    const lib = await exportLibrary(repo, "1.0.0");
    const id = lib.problems[0].id;
    await repo.updateProblem(id, { notes: "local edit" });
    await importLibrary(repo, lib, "keep");
    expect((await repo.getProblem(id))!.notes).toBe("local edit");
    await importLibrary(repo, lib, "overwrite");
    expect((await repo.getProblem(id))!.notes).toBe(lib.problems[0].notes);
    // Overwrite never deletes children.
    const withParts = lib.problems.find((p) => p.parts.length)!;
    expect((await repo.getProblem(withParts.id))!.parts).toHaveLength(withParts.parts.length);
  });

  it("rejects files that are not libraries or come from a newer version", () => {
    expect(() => validateLibrary({ format: "other" })).toThrow(/Not a Marée library/);
    expect(() => validateLibrary({ format: "maree-library", version: 99 })).toThrow(/newer version/);
    expect(libraryStatements(validateLibrary({ format: "maree-library", version: 1, courses: [], lectures: [], topics: [], sources: [], problems: [] }), "keep")).toEqual([]);
  });
});

describe("Markdown and LaTeX export", () => {
  it("keeps every formula verbatim in Markdown", async () => {
    const { repo } = await sampleRepo();
    const problems = await fullProblems(repo);
    const index = buildIndex(await repo.listCourses(), await repo.listLectures(), await repo.listTopics(), await repo.listSources());
    const md = collectionToMarkdown(problems, index, { ...DEFAULT_EXPORT, title: "Sample", includeReference: true });
    for (const p of problems) expect(md).toContain(p.statement.trim());
    expect(md).toContain("## SAMPLE — Real Analysis — Sample Library · Lecture 2 — Sequences and Limits");
    expect(md).toContain("#### Reference solution");
  });

  it("converts Markdown structure but not mathematics", () => {
    expect(markdownToLatex("**Key** idea: \\(a_n \\to 0\\) and $$\\sum a_n$$ costs 5% & more")).toBe(
      "\\textbf{Key} idea: \\(a_n \\to 0\\) and \\[\\sum a_n\\] costs 5\\% \\& more",
    );
    expect(markdownToLatex("- one\n- two")).toBe("\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}");
  });

  const hasPdflatex = (() => {
    try {
      execFileSync("pdflatex", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasPdflatex)("produces a .tex file that compiles with pdflatex", async () => {
    const { repo } = await sampleRepo();
    const problems = await fullProblems(repo);
    const index = buildIndex(await repo.listCourses(), await repo.listLectures(), await repo.listTopics(), await repo.listSources());
    const tex = collectionToLatex(problems, index, { ...DEFAULT_EXPORT, title: "Sample — export", includeReference: true, includeNotes: true }, DEFAULT_MACROS);
    const dir = mkdtempSync(join(tmpdir(), "maree-tex-"));
    writeFileSync(join(dir, "export.tex"), tex);
    execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "export.tex"], { cwd: dir, stdio: "pipe", timeout: 120000 });
    expect(existsSync(join(dir, "export.pdf"))).toBe(true);
  }, 150000);
});
