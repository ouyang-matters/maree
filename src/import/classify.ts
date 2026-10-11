// Classification suggestions for imported problems. Everything here is a suggestion:
// the import wizard shows the reason and lets the user accept or change it in bulk.

import type { Category, Course, Lecture, Topic } from "../data/types";
import { plainText } from "../math/segments";

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[–—_\-/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------ courses

/** "MATH147", "math_147", "MATH 147", "CS-145" → "MATH 147" / "CS 145". */
export function detectCourseCodes(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[^A-Za-z])([A-Za-z]{2,5})[\s_\-.]?(\d{2,4}[A-Za-z]?)(?![\d])/g;
  const stop = new Set(["lec", "lecture", "lectures", "week", "chapter", "section", "page", "pages", "problem", "problems", "ex", "hw", "ps", "pset", "set", "sheet", "part", "fall", "spring", "winter", "summer", "q", "no", "v", "ver", "rev", "draft", "final", "midterm", "unit", "a", "tut", "ch", "sec"]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const subject = m[1].toLowerCase();
    if (stop.has(subject)) continue;
    // Years such as "Fall2025" are not course codes.
    if (/^(19|20)\d\d$/.test(m[2])) continue;
    const code = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s_\-.]+/g, "");
}

export interface CourseSuggestion {
  courseId: string | null;
  newCourse: { code: string; title: string } | null;
  reason: string;
}

export function suggestCourse(fileName: string, docTitle: string, preamble: string, courses: Course[]): CourseSuggestion {
  const sources: [string, string][] = [
    [fileName, "file name"],
    [docTitle, "document title"],
    [preamble.slice(0, 600), "document heading"],
  ];
  for (const [text, where] of sources) {
    for (const code of detectCourseCodes(text)) {
      const hit = courses.find((c) => c.code && normalizeCode(c.code) === normalizeCode(code));
      if (hit) return { courseId: hit.id, newCourse: null, reason: `Course code ${code} found in the ${where}` };
    }
  }
  // Course titles mentioned in the heading ("Advanced Calculus").
  const head = normalize(`${fileName} ${docTitle} ${preamble.slice(0, 600)}`);
  for (const c of courses) {
    const t = normalize(c.title);
    if (t.length >= 6 && head.includes(t)) return { courseId: c.id, newCourse: null, reason: `Course title “${c.title}” found in the document` };
  }
  const codes = detectCourseCodes(fileName).concat(detectCourseCodes(docTitle));
  if (codes.length) return { courseId: null, newCourse: { code: codes[0], title: "" }, reason: `New course code ${codes[0]} found in the file name` };
  return { courseId: null, newCourse: null, reason: "" };
}

// ----------------------------------------------------------------- lectures

/** "Lectures_7-12" → [7..12], "Lec09" → [9], "L7-L9" → [7,8,9], "lectures 3, 5" → [3, 5]. */
export function parseLectureNumbers(text: string): number[] {
  const out = new Set<number>();
  const range = /(?:lectures?|lec|^l|[_\s-]l)[\s_.-]*(\d{1,3})\s*(?:-|–|to|_)\s*l?(?:ec)?[\s_.-]*(\d{1,3})/gi;
  let m: RegExpExecArray | null;
  while ((m = range.exec(text))) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (b >= a && b - a <= 40) for (let i = a; i <= b; i++) out.add(i);
  }
  if (out.size) return [...out];
  const single = /(?:lectures?|lec)[\s_.-]*(\d{1,3})(?:\s*(?:,|and|&)\s*(\d{1,3}))*/gi;
  while ((m = single.exec(text))) {
    for (const n of m[0].match(/\d{1,3}/g) ?? []) out.add(parseInt(n, 10));
  }
  return [...out];
}

export function findLecture(courseId: string | null, ref: string | null, lectures: Lecture[]): Lecture | null {
  if (!courseId || !ref) return null;
  const n = ref.replace(/^0+(?=\d)/, "");
  return lectures.find((l) => l.courseId === courseId && l.number.replace(/^0+(?=\d)/, "") === n) ?? null;
}

// ------------------------------------------------------------------- topics

export interface TopicRule {
  name: string;
  aliases: string[];
  patterns: RegExp[];
}

/** Built-in vocabulary; hits are mapped onto the user's own topics by name or alias. */
export const TOPIC_RULES: TopicRule[] = [
  { name: "Epsilon–N Proofs", aliases: ["epsilon n", "epsilon-n", "ε-N", "epsilon delta"], patterns: [/(\\(?:var)?epsilon|ε|\bepsilon\b)[\s\S]{0,240}?(\bN\b|n\s*(\\ge|≥|>)|\\exists\s*N|∃\s*N)/i, /epsilon.?n proof|ε.?N/i] },
  { name: "Triangle Inequality", aliases: ["triangle inequality"], patterns: [/triangle inequality/i, /\|\s*a\s*\+\s*b\s*\|\s*\\le/i] },
  { name: "Algebra of Limits", aliases: ["limit laws", "limit theorems", "algebra of limits"], patterns: [/algebra of limits|limit laws?/i, /\\lim[^.]*\\lim/] },
  { name: "Monotone Convergence Theorem", aliases: ["MCT", "monotone convergence", "monotone sequences"], patterns: [/monotone convergence|\bMCT\b/i, /\b(monoton\w*|increasing|decreasing|non-?decreasing|non-?increasing)\b[^.]{0,80}\bbounded\b/i, /\bbounded\b[^.]{0,80}\b(monoton\w*|increasing|decreasing)\b/i] },
  { name: "Recursive Sequences", aliases: ["recursive sequences", "recurrence", "recursively defined"], patterns: [/recursive|recursively|recurrence/i, /x_\{?n\s*\+\s*1\}?\s*=/] },
  { name: "Subsequences", aliases: ["subsequence", "subsequences"], patterns: [/subsequen/i, /x_\{?n_\{?k/] },
  { name: "Bolzano–Weierstrass", aliases: ["bolzano weierstrass", "BW theorem", "B-W"], patterns: [/bolzano|weierstrass/i] },
  { name: "Limit Superior / Inferior", aliases: ["limsup", "liminf", "lim sup", "limit superior", "limit inferior"], patterns: [/\\limsup|\\liminf|lim\s*sup|lim\s*inf|limit (superior|inferior)/i] },
  { name: "Cauchy Sequences", aliases: ["cauchy", "cauchy sequences", "cauchy criterion"], patterns: [/cauchy/i] },
  { name: "Supremum and Infimum", aliases: ["supremum", "infimum", "least upper bound", "completeness"], patterns: [/supremum|infimum|least upper bound|greatest lower bound|\\sup\b|\\inf\b/i] },
  { name: "Squeeze Theorem", aliases: ["squeeze", "sandwich"], patterns: [/squeeze|sandwich/i] },
  { name: "Series", aliases: ["series", "infinite series"], patterns: [/\bseries\b|\\sum_\{?[nk]\s*=\s*[01]\}?\^\{?\\infty/i] },
  { name: "Convergence Tests", aliases: ["ratio test", "root test", "comparison test"], patterns: [/(ratio|root|comparison|integral|alternating series) test/i] },
  { name: "Continuity", aliases: ["continuous", "continuity"], patterns: [/\bcontinu(ous|ity)\b/i] },
  { name: "Uniform Continuity", aliases: ["uniformly continuous"], patterns: [/uniform(ly)? continu/i] },
  { name: "Differentiation", aliases: ["derivative", "differentiable"], patterns: [/differentiab|derivative|f'\(/i] },
  { name: "Mean Value Theorem", aliases: ["MVT", "mean value theorem", "rolle"], patterns: [/mean value theorem|\bMVT\b|rolle/i] },
  { name: "Integration", aliases: ["integral", "riemann integral"], patterns: [/riemann|integrab|\\int\b|integral/i] },
  { name: "Compactness", aliases: ["compact"], patterns: [/\bcompact/i] },
  { name: "Open and Closed Sets", aliases: ["open sets", "closed sets", "topology of R"], patterns: [/\b(open|closed) (set|interval|ball)s?\b|\binterior\b|\bclosure\b/i] },
  { name: "Metric Spaces", aliases: ["metric", "metric space"], patterns: [/metric space|\bmetric\b/i] },
  { name: "Induction", aliases: ["mathematical induction", "induction"], patterns: [/induction|inductive/i] },
  { name: "Countability", aliases: ["countable", "uncountable"], patterns: [/\b(un)?countabl/i] },
  { name: "Functions and Bijections", aliases: ["injective", "surjective", "bijection"], patterns: [/injective|surjective|bijecti|one-to-one|onto\b/i] },
  { name: "Number Theory", aliases: ["divisibility", "primes", "gcd", "modular arithmetic"], patterns: [/\bprime\b|\\gcd|\bgcd\b|divides|\\mid|\\pmod|\bmod\b|congruen/i] },
  { name: "Groups", aliases: ["group theory", "subgroup"], patterns: [/\b(sub)?groups?\b|homomorphism|isomorphism|cyclic|coset/i] },
  { name: "Rings and Fields", aliases: ["rings", "fields", "ideals"], patterns: [/\brings?\b|\bideals?\b|\bfield\b|integral domain/i] },
  { name: "Polynomials", aliases: ["polynomial"], patterns: [/polynomial/i] },
  { name: "Complex Numbers", aliases: ["complex numbers"], patterns: [/complex number|\\mathbb\{C\}|\bmodulus\b|\bargument\b/i] },
  { name: "Vector Spaces", aliases: ["vector space", "subspace", "span", "basis"], patterns: [/vector space|subspace|\bspan\b|\bbasis\b|linear(ly)? (in)?dependen/i] },
  { name: "Linear Maps", aliases: ["linear transformation", "linear map"], patterns: [/linear (map|transformation|operator)|kernel|\bimage\b|\\ker\b/i] },
  { name: "Eigenvalues", aliases: ["eigenvalues", "eigenvectors", "diagonalization"], patterns: [/eigen|diagonaliz/i] },
  { name: "Matrices and Determinants", aliases: ["matrix", "determinant"], patterns: [/matri(x|ces)|determinant|\\det\b|pmatrix|bmatrix/i] },
  { name: "Inner Product Spaces", aliases: ["inner product", "orthogonal", "Gram-Schmidt"], patterns: [/inner product|orthogonal|orthonormal|gram.?schmidt|\\langle/i] },
  { name: "Combinatorics", aliases: ["counting", "binomial coefficients"], patterns: [/how many|\\binom|binomial|permutation|combination|pigeonhole/i] },
  { name: "Probability", aliases: ["probability"], patterns: [/probabilit|random variable|expected value|\\mathbb\{P\}/i] },
  { name: "Recursion (Programming)", aliases: ["recursion", "structural recursion"], patterns: [/\(define\b|racket|scheme|structural recursion|accumulative recursion/i] },
];

export interface TopicHit {
  topicId: string;
  score: number;
  reason: string;
}

function topicTerms(t: Topic): string[] {
  const kws = t.keywords
    .split(/[,\n;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return [t.name, ...kws].map(normalize).filter((x) => x.length >= 3);
}

function containsTerm(haystack: string, term: string): boolean {
  if (term.length <= 4) return new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(haystack);
  return haystack.includes(term);
}

/** Matches existing topics (by name and user-defined keywords) and the built-in vocabulary. */
export function suggestTopics(
  statement: string,
  topics: Topic[],
): { hits: TopicHit[]; newNames: string[] } {
  const raw = statement;
  const text = normalize(plainText(statement));
  const hits = new Map<string, TopicHit>();
  const add = (topicId: string, score: number, reason: string) => {
    const prev = hits.get(topicId);
    if (!prev || prev.score < score) hits.set(topicId, { topicId, score, reason });
  };
  for (const t of topics) {
    for (const term of topicTerms(t)) {
      if (containsTerm(text, term)) {
        add(t.id, 2, `mentions “${term}”`);
        break;
      }
    }
  }
  const newNames: string[] = [];
  for (const rule of TOPIC_RULES) {
    if (!rule.patterns.some((p) => p.test(raw) || p.test(text))) continue;
    const names = [rule.name, ...rule.aliases].map(normalize);
    const existing = topics.find((t) => {
      const terms = [normalize(t.name), ...topicTerms(t)];
      return terms.some((x) => names.includes(x));
    });
    if (existing) add(existing.id, 1, `matches “${rule.name}” vocabulary`);
    else newNames.push(rule.name);
  }
  return {
    hits: [...hits.values()].sort((a, b) => b.score - a.score),
    newNames: newNames.slice(0, 4),
  };
}

// ----------------------------------------------------------------- category

export function suggestCategory(statement: string): Category | null {
  const t = plainText(statement).toLowerCase();
  if (/\b(prove|show that|show|demonstrate|deduce|verify that|justify|disprove)\b/.test(t)) return "proof";
  if (/\b(compute|calculate|evaluate|find|determine|solve|simplify|approximate)\b/.test(t)) return "calculation";
  if (/\b(explain|true or false|is it true|give an example|counterexample|define|state|describe|why)\b/.test(t)) return "conceptual";
  if (/\b(model|apply|application|estimate|design|write a function|implement)\b/.test(t)) return "application";
  return null;
}

/** Explicit difficulty hints from the source: "(*)", "★★", "[Hard]". */
export function suggestDifficulty(text: string): number | null {
  const stars = /(\(\*{1,3}\)|★{1,4}|\[(easy|medium|hard|challenge)\])/i.exec(text);
  if (!stars) return null;
  const s = stars[0].toLowerCase();
  if (s.includes("easy")) return 1;
  if (s.includes("medium")) return 2;
  if (s.includes("hard")) return 3;
  if (s.includes("challenge")) return 4;
  const n = (s.match(/[*★]/g) ?? []).length;
  return Math.min(4, n + 1);
}
