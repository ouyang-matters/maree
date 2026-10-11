// A small demonstration library. Every row is marked `is_sample` and can be removed
// with Library › Remove Sample Data without touching anything the user created.

import type { Repo } from "./repo";
import { todayLocal } from "./ids";

export async function loadSampleLibrary(repo: Repo): Promise<void> {
  const course = await repo.createCourse({
    code: "SAMPLE",
    title: "Real Analysis — Sample Library",
    description: "Demonstration data shipped with Marée. Remove it with Library › Remove Sample Data.",
    isSample: true,
  });
  const [l1, l2, l3] = await repo.createLectures([
    { courseId: course.id, number: "1", title: "Completeness of the Real Numbers", isSample: true },
    { courseId: course.id, number: "2", title: "Sequences and Limits", isSample: true },
    { courseId: course.id, number: "3", title: "Series", isSample: true },
  ]);
  const [sup, epsN, mct, rec, series, linalg] = await repo.createTopics([
    { name: "Supremum and Infimum", keywords: "sup, inf, least upper bound", isSample: true },
    { name: "Epsilon–N Proofs", keywords: "epsilon, definition of limit", isSample: true },
    { name: "Monotone Convergence Theorem", keywords: "MCT, monotone, bounded monotone", isSample: true },
    { name: "Recursive Sequences", keywords: "recursive, recurrence", isSample: true },
    { name: "Series", keywords: "sum, convergence of series", isSample: true },
    { name: "Linear Algebra", isSample: true },
  ]);
  const [eigen] = await repo.createTopics([{ name: "Eigenvalues", parentId: linalg.id, keywords: "eigenvector, diagonalization", isSample: true }]);
  const source = await repo.createSource({
    title: "Sample problem sheet",
    kind: "problem-set",
    notes: "Sample source without an attached file.",
    isSample: true,
  });

  const base = { courseId: course.id, sourceId: source.id, isSample: true };

  const archimedes = await repo.createProblem({
    ...base,
    title: "Archimedean property",
    sourceNumber: "1",
    statement: "Prove that for every \\(x \\in \\mathbb{R}\\) there exists \\(n \\in \\mathbb{N}\\) with \\(n > x\\).",
    lectureIds: [l1.id],
    topicIds: [sup.id],
    difficulty: 1,
    category: "proof",
    solution: [
      "\\begin{proof}",
      "Suppose not. Then \\(n \\le x\\) for every \\(n\\in\\mathbb{N}\\), so \\(\\mathbb{N}\\) is bounded above and,",
      "by completeness, \\(s = \\sup \\mathbb{N}\\) exists. Since \\(s - 1 < s\\), the number \\(s-1\\) is not an upper bound:",
      "there is \\(m \\in \\mathbb{N}\\) with \\(m > s - 1\\). But then \\(m + 1 \\in \\mathbb{N}\\) and \\(m + 1 > s\\), a contradiction.",
      "\\end{proof}",
    ].join("\n"),
    notes: "**Technique.** Contradiction + the defining property of the supremum: \\(s-\\varepsilon\\) is never an upper bound.",
  });
  await repo.updateProblem(archimedes, { status: "mastered" });

  const supA = await repo.createProblem({
    ...base,
    title: "Supremum and infimum of a set",
    sourceNumber: "2",
    statement:
      "Let \\(A = \\set{1 - \\tfrac{1}{n} : n \\in \\mathbb{N}}\\). Find \\(\\sup A\\) and \\(\\inf A\\), and prove that your answers are correct.",
    lectureIds: [l1.id],
    topicIds: [sup.id],
    difficulty: 2,
    category: "proof",
    solution:
      "\\(\\inf A = 0\\) is attained at \\(n=1\\). For the supremum, every element is \\(< 1\\), and given \\(\\varepsilon > 0\\) choose \\(n > 1/\\varepsilon\\) (Archimedean property); then \\(1 - \\tfrac1n > 1 - \\varepsilon\\). Hence \\(\\sup A = 1\\).",
  });
  await repo.updateProblem(supA, { status: "completed" });

  const limit = await repo.createProblem({
    ...base,
    title: "A limit from the definition",
    sourceNumber: "3",
    statement: "Using the \\(\\varepsilon\\)–\\(N\\) definition, prove that\n\\[\n\\lim_{n\\to\\infty}\\frac{2n^2+1}{n^2+3} = 2.\n\\]",
    lectureIds: [l2.id],
    topicIds: [epsN.id],
    difficulty: 2,
    category: "proof",
    referenceSolution: [
      "For \\(n \\ge 1\\),",
      "\\begin{align*}",
      "\\left|\\frac{2n^2+1}{n^2+3} - 2\\right| &= \\frac{5}{n^2+3} < \\frac{5}{n}.",
      "\\end{align*}",
      "Given \\(\\varepsilon>0\\), take \\(N > 5/\\varepsilon\\). Then \\(n \\ge N\\) implies the distance is \\(<\\varepsilon\\).",
    ].join("\n"),
  });
  await repo.addAttempt(
    limit,
    null,
    "Let \\(\\varepsilon > 0\\). We need \\(\\left|\\frac{2n^2+1}{n^2+3} - 2\\right| < \\varepsilon\\), i.e. \\(\\frac{5}{n^2+3} < \\varepsilon\\), so take \\(N = 5\\varepsilon\\).",
    "incorrect",
    "Inverted the inequality when choosing N.",
  );
  await repo.updateProblem(limit, {
    solution: "Let \\(\\varepsilon > 0\\). Note that\n\\[\n\\left|\\frac{2n^2+1}{n^2+3} - 2\\right| = \\frac{5}{n^2+3}.\n\\]\n*To finish:* choose \\(N\\) correctly.",
    status: "needs_review",
    reviewDue: todayLocal(0),
  });

  const recursive = await repo.createProblem({
    ...base,
    title: "Newton's iteration for \\(\\sqrt{3}\\)",
    sourceNumber: "4",
    statement: "Let \\(x_1 = 2\\) and \\(x_{n+1} = \\dfrac{1}{2}\\left(x_n + \\dfrac{3}{x_n}\\right)\\) for \\(n \\ge 1\\).",
    lectureIds: [l2.id],
    topicIds: [mct.id, rec.id],
    difficulty: 3,
    category: "proof",
    parts: [
      { label: "a", statement: "Show that \\(x_n \\ge \\sqrt{3}\\) for all \\(n\\). *Hint:* AM–GM." },
      { label: "b", statement: "Show that \\((x_n)\\) is decreasing." },
      { label: "c", statement: "Deduce that \\(x_n \\to \\sqrt{3}\\)." },
    ],
  });
  const parts = (await repo.getProblem(recursive))!.parts;
  await repo.updatePart(parts[0].id, {
    status: "completed",
    solution: "By AM–GM, \\(x_{n+1} = \\tfrac12\\left(x_n + \\tfrac{3}{x_n}\\right) \\ge \\sqrt{x_n \\cdot \\tfrac{3}{x_n}} = \\sqrt3\\).",
  });
  await repo.updatePart(parts[1].id, {
    status: "in_progress",
    solution: "\\(x_{n+1} - x_n = \\dfrac{3 - x_n^2}{2x_n} \\le 0\\) since …",
  });

  await repo.createProblem({
    ...base,
    title: "Squeeze theorem",
    sourceNumber: "5",
    statement: "Prove that \\(\\displaystyle\\lim_{n\\to\\infty} \\frac{\\sin n}{n} = 0\\).",
    lectureIds: [l2.id],
    topicIds: [epsN.id],
    difficulty: 1,
    category: "proof",
  });

  const geometric = await repo.createProblem({
    ...base,
    title: "Geometric series",
    sourceNumber: "6",
    statement: "Let \\(|r| < 1\\). Prove that \\[\\sum_{k=0}^{\\infty} r^k = \\frac{1}{1-r}.\\]",
    lectureIds: [l3.id],
    topicIds: [series.id],
    difficulty: 1,
    category: "proof",
    solution: "The partial sums are \\(S_n = \\dfrac{1 - r^{n+1}}{1-r}\\), and \\(r^{n+1} \\to 0\\) because …",
  });
  await repo.updateProblem(geometric, { status: "in_progress", reviewDue: todayLocal(5) });

  const telescoping = await repo.createProblem({
    ...base,
    title: "A telescoping series",
    sourceNumber: "7",
    statement: "Evaluate \\(\\displaystyle\\sum_{k=1}^{\\infty} \\frac{1}{k(k+1)}\\).",
    lectureIds: [l3.id],
    topicIds: [series.id],
    difficulty: 1,
    category: "calculation",
    solution: [
      "Partial fractions give \\(\\frac{1}{k(k+1)} = \\frac1k - \\frac1{k+1}\\), so",
      "\\begin{align*}",
      "S_n &= \\sum_{k=1}^n \\left(\\frac1k - \\frac1{k+1}\\right) = 1 - \\frac{1}{n+1} \\xrightarrow[n\\to\\infty]{} 1.",
      "\\end{align*}",
    ].join("\n"),
  });
  await repo.addAttempt(telescoping, null, "Partial fractions; the sum telescopes to 1.", "correct");
  await repo.updateProblem(telescoping, { status: "completed" });

  await repo.createProblem({
    isSample: true,
    sourceId: source.id,
    title: "Diagonalising a symmetric matrix",
    sourceNumber: "8",
    statement:
      "Let \\[A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}.\\] Find the eigenvalues of \\(A\\), an orthonormal basis of eigenvectors, and an orthogonal matrix \\(Q\\) with \\(Q^{\\mathsf T} A Q\\) diagonal.",
    topicIds: [eigen.id],
    difficulty: 2,
    category: "calculation",
  });
}
