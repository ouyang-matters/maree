import { describe, expect, it } from "vitest";
import { freshRepo, NodeDriver } from "./helpers/node-driver";
import { currentVersion, LATEST_VERSION, migrate } from "../src/data/schema";
import { Repo, toFtsQuery } from "../src/data/repo";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("migrations", () => {
  it("creates the schema once and is idempotent", async () => {
    const driver = new NodeDriver();
    const first = await migrate(driver);
    expect(first.applied).toEqual([1]);
    expect(await currentVersion(driver)).toBe(LATEST_VERSION);
    const second = await migrate(driver);
    expect(second.applied).toEqual([]);
    // Fresh database: no pre-migration snapshot needed.
    expect(driver.snapshots).toEqual([]);
  });

  it("refuses to open a library from a newer schema without modifying it", async () => {
    const driver = new NodeDriver();
    await driver.execute("PRAGMA user_version = 999");
    await expect(migrate(driver)).rejects.toThrow(/newer version/);
  });
});

describe("courses, lectures, topics", () => {
  it("creates MATH 147 with Lectures 7–12 in order", async () => {
    const { repo } = await freshRepo();
    const course = await repo.createCourse({ code: "MATH 147", title: "Advanced Calculus" });
    const lectures = await repo.createLectures(
      [7, 8, 9, 10, 11, 12].map((n) => ({ courseId: course.id, number: String(n), title: `Lecture ${n}` })),
    );
    expect(lectures.map((l) => l.number)).toEqual(["7", "8", "9", "10", "11", "12"]);
    const all = await repo.listLectures();
    expect(all.map((l) => l.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("supports hierarchical topics and refuses cycles", async () => {
    const { repo } = await freshRepo();
    const [seq] = await repo.createTopics([{ name: "Sequences" }]);
    const [cauchy] = await repo.createTopics([{ name: "Cauchy Sequences", parentId: seq.id }]);
    expect(cauchy.parentId).toBe(seq.id);
    await expect(repo.updateTopic(seq.id, { parentId: cauchy.id })).rejects.toThrow(/inside itself/);
  });

  it("deleting a course keeps its problems unassigned (or trashes them on request)", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCourse({ code: "MATH 145" });
    const [lec] = await repo.createLectures([{ courseId: c.id, number: "1" }]);
    const id = await repo.createProblem({ title: "Kept", courseId: c.id, lectureIds: [lec.id] });
    await repo.deleteCourse(c.id, "keep");
    const p = await repo.getProblem(id);
    expect(p?.courseId).toBeNull();
    expect(p?.lectureIds).toEqual([]);
    expect(p?.deletedAt).toBeNull();

    const c2 = await repo.createCourse({ code: "CS 145" });
    const id2 = await repo.createProblem({ title: "Trashed", courseId: c2.id });
    await repo.deleteCourse(c2.id, "trash");
    expect((await repo.getProblem(id2))?.deletedAt).not.toBeNull();
  });
});

describe("problems", () => {
  it("round-trips every field including LaTeX source verbatim", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCourse({ code: "MATH 147" });
    const [l9] = await repo.createLectures([{ courseId: c.id, number: "9", title: "Monotone Sequences" }]);
    const [mct, rec] = await repo.createTopics([{ name: "MCT" }, { name: "Recursive Sequences" }]);
    const statement = "Let \\(x_1 = 1\\) and \\(x_{n+1} = \\sqrt{2 + x_n}\\). Prove that\n\\[\\lim_{n\\to\\infty} x_n = 2.\\]";
    const id = await repo.createProblem({
      title: "A recursive sequence",
      statement,
      courseId: c.id,
      lectureIds: [l9.id],
      topicIds: [mct.id, rec.id],
      difficulty: 3,
      priority: 2,
      category: "proof",
      sourceNumber: "4",
      sourcePage: 2,
      parts: [{ label: "a", statement: "Show \\((x_n)\\) is bounded above by 2." }, { label: "b" }],
    });
    const p = (await repo.getProblem(id))!;
    expect(p.statement).toBe(statement);
    expect(p.topicIds.sort()).toEqual([mct.id, rec.id].sort());
    expect(p.lectureIds).toEqual([l9.id]);
    expect(p.parts.map((x) => x.label)).toEqual(["a", "b"]);
    expect(p.difficulty).toBe(3);
    expect(p.category).toBe("proof");
    expect(p.history[0].kind).toBe("created");
  });

  it("records status changes in the history and updates last attempt", async () => {
    const { repo } = await freshRepo();
    const id = await repo.createProblem({ title: "T" });
    await repo.updateProblem(id, { status: "needs_review" });
    const p = (await repo.getProblem(id))!;
    expect(p.status).toBe("needs_review");
    expect(p.lastAttemptAt).not.toBeNull();
    const ev = p.history.find((h) => h.kind === "status")!;
    expect(ev.fromValue).toBe("not_started");
    expect(ev.toValue).toBe("needs_review");
  });

  it("derives the parent status from part statuses", async () => {
    const { repo } = await freshRepo();
    const id = await repo.createProblem({ title: "Multi", parts: [{ label: "a" }, { label: "b" }, { label: "c" }] });
    const parts = (await repo.getProblem(id))!.parts;
    expect(await repo.updatePart(parts[0].id, { status: "completed" })).toBe("in_progress");
    await repo.updatePart(parts[1].id, { status: "completed" });
    expect(await repo.updatePart(parts[2].id, { status: "completed" })).toBe("completed");
    expect((await repo.getProblem(id))!.status).toBe("completed");
    expect(await repo.updatePart(parts[1].id, { status: "needs_review" })).toBe("needs_review");
  });

  it("keeps attempts as an immutable history", async () => {
    const { repo } = await freshRepo();
    const id = await repo.createProblem({ title: "Proof" });
    await repo.updateProblem(id, { solution: "First idea" });
    await repo.addAttempt(id, null, "First idea", "incorrect", "Forgot the base case");
    await repo.updateProblem(id, { solution: "Second idea" });
    await repo.addAttempt(id, null, "Second idea", "correct");
    const p = (await repo.getProblem(id))!;
    expect(p.attempts.map((a) => a.content)).toEqual(["Second idea", "First idea"]);
    expect(p.status).toBe("in_progress");
    const [s] = await repo.getSummaries([id]);
    expect(s.attemptCount).toBe(2);
    expect(s.lastOutcome).toBe("correct");
  });

  it("moves problems through the trash before permanent deletion", async () => {
    const { repo } = await freshRepo();
    const id = await repo.createProblem({ title: "Disposable" });
    await repo.trashProblems([id]);
    expect((await repo.listSummaries()).find((s) => s.id === id)?.deletedAt).not.toBeNull();
    await repo.restoreProblems([id]);
    expect((await repo.listSummaries()).find((s) => s.id === id)?.deletedAt).toBeNull();
    await repo.trashProblems([id]);
    expect(await repo.emptyTrash()).toBe(1);
    expect(await repo.getProblem(id)).toBeNull();
  });

  it("bulk-assigns topics and lectures", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCourse({ code: "MATH 147" });
    const [l] = await repo.createLectures([{ courseId: c.id, number: "12" }]);
    const [t] = await repo.createTopics([{ name: "Cauchy Sequences" }]);
    const a = await repo.createProblem({ title: "A" });
    const b = await repo.createProblem({ title: "B" });
    await repo.bulkUpdate([a, b], { addTopicIds: [t.id], addLectureIds: [l.id], courseId: c.id, difficulty: 4 });
    const sums = await repo.getSummaries([a, b]);
    for (const s of sums) {
      expect(s.topicIds).toEqual([t.id]);
      expect(s.lectureIds).toEqual([l.id]);
      expect(s.courseId).toBe(c.id);
      expect(s.difficulty).toBe(4);
    }
  });
});

describe("full-text search", () => {
  it("builds prefix queries from free text", () => {
    expect(toFtsQuery("Cauchy seq")).toBe("cauchy* seq*");
    expect(toFtsQuery("  ")).toBeNull();
    expect(toFtsQuery('"); DROP TABLE problems; --')).toBe("drop* table* problems*");
  });

  it("finds problems by statement, notes, topic and source metadata", async () => {
    const { repo } = await freshRepo();
    const [t] = await repo.createTopics([{ name: "Bolzano–Weierstrass" }]);
    const src = await repo.createSource({ title: "Abbott, Understanding Analysis", kind: "textbook" });
    const a = await repo.createProblem({ title: "Bounded sequences", statement: "Every bounded sequence has a convergent subsequence." });
    const b = await repo.createProblem({ title: "Other", statement: "Compute the limit.", notes: "Uses the squeeze theorem", topicIds: [t.id], sourceId: src.id });
    expect([...(await repo.search("subseq")).keys()]).toEqual([a]);
    expect([...(await repo.search("squeeze")).keys()]).toEqual([b]);
    expect([...(await repo.search("bolzano")).keys()]).toEqual([b]);
    expect([...(await repo.search("abbott")).keys()]).toEqual([b]);
    // Title hits rank above body hits.
    const r = await repo.search("bounded");
    expect(r.get(a)).toBe(2);
  });

  it("keeps the index in sync after edits and renames", async () => {
    const { repo } = await freshRepo();
    const [t] = await repo.createTopics([{ name: "MCT" }]);
    const id = await repo.createProblem({ title: "x", statement: "alpha", topicIds: [t.id] });
    await repo.updateProblem(id, { statement: "omega" });
    expect((await repo.search("alpha")).size).toBe(0);
    expect((await repo.search("omega")).size).toBe(1);
    await repo.updateTopic(t.id, { name: "Monotone Convergence Theorem" });
    expect((await repo.search("monotone")).size).toBe(1);
    expect(await repo.reindexAll()).toBe(1);
    expect((await repo.search("omega")).size).toBe(1);
  });
});

describe("data preservation", () => {
  it("persists everything across closing and reopening the database file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maree-"));
    const file = join(dir, "maree.db");
    let id: string;
    {
      const { driver, repo } = await freshRepo(file);
      const c = await repo.createCourse({ code: "MATH 147" });
      id = await repo.createProblem({ title: "Persist me", statement: "\\(\\varepsilon > 0\\)", courseId: c.id });
      await repo.updateProblem(id, { solution: "Let \\(\\varepsilon>0\\).", status: "needs_review" });
      await repo.setSetting("theme", "dark");
      driver.close();
    }
    {
      const driver = new NodeDriver(file);
      const report = await migrate(driver);
      expect(report.applied).toEqual([]);
      const repo = new Repo(driver);
      const p = (await repo.getProblem(id))!;
      expect(p.solution).toBe("Let \\(\\varepsilon>0\\).");
      expect(p.status).toBe("needs_review");
      expect((await repo.getSettings()).theme).toBe("dark");
      driver.close();
    }
  });

  it("rolls back a failed batch completely", async () => {
    const { repo } = await freshRepo();
    const id = await repo.createProblem({ title: "Original" });
    await expect(
      repo.run([
        { sql: "UPDATE problems SET title = 'Changed' WHERE id = ?", params: [id] },
        { sql: "INSERT INTO problems (id) VALUES (?)", params: [id] }, // duplicate key
      ]),
    ).rejects.toThrow();
    expect((await repo.getProblem(id))!.title).toBe("Original");
  });

  it("removes sample data without touching user data", async () => {
    const { repo } = await freshRepo();
    const sc = await repo.createCourse({ code: "SAMPLE", isSample: true });
    const [st] = await repo.createTopics([{ name: "Sample topic", isSample: true }]);
    await repo.createProblem({ title: "Sample", courseId: sc.id, isSample: true });
    const mine = await repo.createProblem({ title: "Mine", topicIds: [st.id] });
    expect(await repo.hasSample()).toBe(true);
    await repo.removeSample();
    expect(await repo.hasSample()).toBe(false);
    const sums = await repo.listSummaries();
    expect(sums.map((s) => s.id)).toEqual([mine]);
    // A sample topic used by the user's own problem is kept (and becomes a regular topic).
    expect((await repo.listTopics()).map((t) => t.name)).toEqual(["Sample topic"]);
  });
});
