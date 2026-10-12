// Detects problem boundaries, sub-parts and lecture context in extracted lines.
//
// Strategy (most to least reliable):
//   1. structured  – explicit markers from LaTeX environments / DOCX numbering
//   2. keyword     – "Problem 3", "Exercise 2.4", "Question 5", "Q7."
//   3. numbered    – top-level "3." / "3)" items in ascending order
//   4. headings    – one problem per Markdown heading section
//   5. single      – the whole document becomes one problem (low confidence)

import type { ExtractedLine, Segmentation, SegmentedProblem } from "./types";

const NUM = String.raw`\d+(?:\.\d+)*(?:\([a-z]\)|[a-z](?![a-z]))?`;

export const KEYWORD_RE = new RegExp(
  String.raw`^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(Problem|Exercise|Exercice|Question|Prob\.|Ex\.|Q)\s*(${NUM}|[IVX]{1,5}\b)` +
    String.raw`\s*(?:\*\*|__)?\s*(?:\(([^()]{1,80})\))?\s*(?:\*\*|__)?\s*[.:)\-–—]?\s*(?:\*\*|__)?\s*(.*)$`,
  "i",
);

export const NUMBERED_RE = /^\s*(?:\*\*)?(\d{1,3})(?:\*\*)?\s*[.)]\s+(?=\S)(.*)$/;

export const LECTURE_RE =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(Lecture|Lec\.|Week|Chapter|Section|Unit|Tutorial)\s+(\d+[A-Za-z]?(?:\.\d+)*)\s*(?:[:.\-–—]+\s*(.*?))?\s*(?:\*\*|__)?\s*$/i;

const PART_RE = /^\s*(?:\*\*)?\(([a-z]|[ivx]{1,5})\)(?:\*\*)?\s*(.*)$|^\s*(?:\*\*)?([a-z]|[ivx]{1,5})\)(?:\*\*)?\s+(.*)$|^\s*([a-h])\.\s+(.*)$/;

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

function nextLabels(prev: string | null): string[] {
  if (prev === null) return ["a", "i"];
  const li = LETTERS.indexOf(prev);
  const ri = ROMAN.indexOf(prev);
  const out: string[] = [];
  if (li >= 0 && li + 1 < LETTERS.length) out.push(LETTERS[li + 1]);
  if (ri >= 0 && ri + 1 < ROMAN.length) out.push(ROMAN[ri + 1]);
  return out;
}

export function matchPart(text: string): { label: string; rest: string } | null {
  const m = PART_RE.exec(text);
  if (!m) return null;
  const label = (m[1] ?? m[3] ?? m[5]).toLowerCase();
  const rest = m[2] ?? m[4] ?? m[6] ?? "";
  return { label, rest };
}

/** "LECTURE 7    NOTES PP. 27–30": a lecture label followed by detail rather than a title. */
const LECTURE_LOOSE_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(Lecture|Lec\.|Week|Chapter|Section|Unit|Tutorial)\s+(\d+[A-Za-z]?(?:\.\d+)*)\b\s*(.*?)\s*(?:\*\*|__)?\s*$/i;

interface LectureHeading {
  number: string;
  title: string;
  /** Extra text on the heading line, e.g. "Notes pp. 27–30". */
  detail: string;
  /** Index of a following line that holds the title, if any. */
  titleLine: number | null;
}

function looksLikeTitle(text: string): boolean {
  const t = text.trim().replace(/^[#*\s]+|[*\s]+$/g, "");
  if (!t || t.length > 80 || t.split(/\s+/).length > 9) return false;
  if (/[.;:?]$/.test(t) || /[=<>∈≤≥]|\\\(|\$/.test(t)) return false;
  return /^\p{Lu}/u.test(t) && !KEYWORD_RE.test(t);
}

function isLectureHeading(lines: ExtractedLine[], i: number): LectureHeading | null {
  const line = lines[i];
  const text = line.text.trim();
  if (text.length > 120) return null;
  const m = LECTURE_RE.exec(text);
  if (m) {
    const title = (m[3] ?? "").replace(/[*_]+$/g, "").trim();
    // A long sentence that merely starts with "Lecture 9 …" is prose, not a heading.
    if (!line.heading && /[.;]$/.test(title) && title.split(/\s+/).length > 8) return null;
    if (title) return { number: m[2], title, detail: "", titleLine: null };
  }
  const loose = m ? null : LECTURE_LOOSE_RE.exec(text);
  if (!m && !loose) return null;
  const number = (m ?? loose)![2];
  const detail = loose ? loose[3].replace(/[*_]+$/g, "").trim() : "";
  // Only headings, upper-case labels ("LECTURE 7") or short detail count; prose does not.
  if (loose && !line.heading && !/^[\s#*_]*[A-Z]{3,}/.test(text)) return null;
  if (detail.split(/\s+/).length > 6) return null;
  // The title may sit on the next non-empty line, set as a heading.
  let titleLine: number | null = null;
  for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
    if (!lines[j].text.trim()) continue;
    if ((lines[j].heading || !line.heading) && looksLikeTitle(lines[j].text)) titleLine = j;
    break;
  }
  const title = titleLine !== null ? lines[titleLine].text.replace(/^[#*\s]+|[*\s]+$/g, "").trim() : "";
  return { number, title, detail, titleLine };
}

const SENTENCE_START =
  /^(Prove|Show|Let|Suppose|Compute|Calculate|Find|Determine|Evaluate|Give|Use|Using|Define|Consider|Is|Are|Does|Do|For|If|Assume|Explain|Describe|State|Write|Verify|Deduce|Solve|Simplify|Sketch|In|We|Our|This|Then|Recall|Note)\b/;

/** "A Non-Cauchy Sequence" is a title; "A bounded sequence converges" is a sentence. */
function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w.length > 3);
  if (!words.length) return true;
  return words.filter((w) => /^\p{Lu}/u.test(w)).length / words.length >= 0.6;
}

/** Levels ("L1"…"L4", "Level 3") and priority marks ("CORE", "★") printed after a problem heading. */
export function parseTrailingTags(rest: string, levelsDefined: boolean): { rest: string; difficulty: number | null; priority: number } {
  let r = rest;
  let difficulty: number | null = null;
  let priority = 0;
  for (let guard = 0; guard < 4; guard++) {
    const core = /\s*(?:\bCORE\b|\(core\)|★+)\s*$/i.exec(r);
    if (core && r.length > core[0].length) {
      priority = 3;
      r = r.slice(0, core.index);
      continue;
    }
    const lvl = /\s*\b(?:Level\s*([1-4])|\[?L([1-4])\]?)\s*$/i.exec(r);
    if (lvl && (lvl[1] || levelsDefined) && r.length > lvl[0].length) {
      difficulty = Number(lvl[1] ?? lvl[2]);
      r = r.slice(0, lvl.index);
      continue;
    }
    break;
  }
  return { rest: r.trim(), difficulty, priority };
}

function lectureKindOf(text: string): string {
  return (LECTURE_RE.exec(text.trim())?.[1] ?? "").toLowerCase();
}

interface Marker {
  index: number;
  number: string;
  title: string;
  rest: string;
  difficulty?: number | null;
  priority?: number;
}

function keywordMarkers(lines: ExtractedLine[], levelsDefined: boolean): Marker[] {
  const out: Marker[] = [];
  lines.forEach((l, index) => {
    if ((l.indent ?? 0) > 2) return;
    const m = KEYWORD_RE.exec(l.text);
    if (!m) return;
    // "Q" alone is accepted only with punctuation or a number directly attached ("Q3.").
    if (/^q$/i.test(m[1]) && !/^\s*(?:\*\*)?Q\d/i.test(l.text)) return;
    const tags = parseTrailingTags(m[4] ?? "", levelsDefined);
    let title = (m[3] ?? "").trim();
    let rest = tags.rest;
    // "Q1. Uniqueness Lemma" with the statement on the following lines: the rest is a title.
    const next = lines.slice(index + 1, index + 3).find((x) => x.text.trim());
    if (!title && rest && next && !KEYWORD_RE.test(next.text) && looksLikeTitle(rest) && !SENTENCE_START.test(rest) && (!/^(A|An|The)\b/.test(rest) || isTitleCase(rest))) {
      title = rest.replace(/^[*_]+|[*_]+$/g, "").trim();
      rest = "";
    }
    out.push({ index, number: m[2], title, rest, difficulty: tags.difficulty, priority: tags.priority });
  });
  return out;
}

const DECIMAL_RE = /^\s*(?:\*\*)?(\d{1,2})\.(\d{1,2})(?:\*\*)?\s+(?=\S)(.+?)\s*$/;

/**
 * "7.1 Direct limit and global bound L1": a short title line numbered within a lecture,
 * with the statement on the following lines. Requires a title, not a sentence.
 */
function decimalMarkers(lines: ExtractedLine[], levelsDefined: boolean): Marker[] {
  const out: Marker[] = [];
  lines.forEach((l, index) => {
    if ((l.indent ?? 0) > 2) return;
    const m = DECIMAL_RE.exec(l.text);
    if (!m) return;
    const tags = parseTrailingTags(m[3], levelsDefined);
    const title = tags.rest.replace(/^[*_]+|[*_]+$/g, "").trim();
    if (!title || title.length > 90 || /[.:;?]$/.test(title) || SENTENCE_START.test(title)) return;
    const next = lines.slice(index + 1, index + 3).find((x) => x.text.trim());
    if (!next || DECIMAL_RE.test(next.text)) return;
    out.push({ index, number: `${m[1]}.${m[2]}`, title, rest: "", difficulty: tags.difficulty, priority: tags.priority });
  });
  return out;
}

function numberedMarkers(lines: ExtractedLine[]): Marker[] {
  const out: Marker[] = [];
  let expected = 1;
  lines.forEach((l, index) => {
    if (l.heading) return;
    let n: number;
    let rest: string;
    if (l.listLabel !== undefined && (l.listLevel ?? 0) === 0 && /^\(?\d+[.)]?$/.test(l.listLabel)) {
      n = parseInt(l.listLabel.replace(/\D/g, ""), 10);
      rest = l.text;
    } else {
      if ((l.indent ?? 0) > 0) return;
      const m = NUMBERED_RE.exec(l.text);
      if (!m) return;
      n = parseInt(m[1], 10);
      rest = m[2];
    }
    const lecture = index > 0 && lines.slice(Math.max(0, index - 3), index).some((_x, k) => isLectureHeading(lines, Math.max(0, index - 3) + k));
    if (n === expected || (n === 1 && lecture)) {
      out.push({ index, number: String(n), title: "", rest });
      expected = n + 1;
    }
  });
  return out;
}

function firstPage(lines: ExtractedLine[]): number | null {
  for (const l of lines) if (l.page) return l.page;
  return null;
}
function lastPage(lines: ExtractedLine[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].page) return lines[i].page!;
  return null;
}

/** Splits a problem's lines into shared statement + sequentially labelled parts. */
export function splitParts(lines: ExtractedLine[]): { lines: ExtractedLine[]; parts: { label: string; lines: ExtractedLine[] }[] } {
  const head: ExtractedLine[] = [];
  const parts: { label: string; lines: ExtractedLine[] }[] = [];
  let prev: string | null = null;
  for (const l of lines) {
    if (l.marker?.kind === "part") {
      parts.push({ label: l.marker.label, lines: l.text.trim() ? [l] : [] });
      prev = l.marker.label;
      continue;
    }
    const level0 = (l.indent ?? 0) <= 2 && !l.heading;
    const fromList =
      l.listLabel !== undefined && (l.listLevel ?? 0) >= 1 ? matchPart(`${l.listLabel} ${l.text}`) : null;
    const m = fromList ?? (level0 ? matchPart(l.text) : null);
    if (m && nextLabels(prev).includes(m.label)) {
      parts.push({ label: m.label, lines: m.rest.trim() ? [{ ...l, text: m.rest, assisted: l.assisted ? matchPart(l.assisted)?.rest ?? l.assisted : undefined }] : [] });
      prev = m.label;
      continue;
    }
    if (parts.length) parts[parts.length - 1].lines.push(l);
    else head.push(l);
  }
  // A single "(a)" is more likely an inline remark than a multi-part problem.
  if (parts.length < 2) return { lines, parts: [] };
  return { lines: head, parts };
}

function trimBlank(lines: ExtractedLine[]): ExtractedLine[] {
  let s = 0;
  let e = lines.length;
  while (s < e && !lines[s].text.trim()) s++;
  while (e > s && !lines[e - 1].text.trim()) e--;
  return lines.slice(s, e);
}

export function segment(input: ExtractedLine[]): Segmentation {
  const lectures: Segmentation["lectures"] = [];
  const lectureAt = new Map<number, LectureHeading>();
  const sectionAt = new Map<number, string>();
  const titleLines = new Set<number>();
  input.forEach((l, i) => {
    if (titleLines.has(i)) return;
    const lec = isLectureHeading(input, i);
    if (lec) {
      const kind = lectureKindOf(l.text) || (LECTURE_LOOSE_RE.exec(l.text.trim())?.[1] ?? "").toLowerCase();
      if (lec.titleLine !== null) titleLines.add(lec.titleLine);
      if (kind === "section" || kind === "chapter") sectionAt.set(i, l.text.replace(/^[#*\s]+|[*\s]+$/g, ""));
      else {
        lectureAt.set(i, lec);
        lectures.push({ number: lec.number, title: lec.title, detail: lec.detail, page: l.page ?? null });
      }
    } else if (l.heading && !KEYWORD_RE.test(l.text)) {
      sectionAt.set(i, l.text.replace(/^[#*\s]+|[*\s]+$/g, ""));
    }
  });
  // "L1 = basics, …" in the document defines L1–L4 as difficulty levels.
  const levelsDefined = input.some((l) => /\bL1\s*=\s*\w|\blevel\s*1\b|\blevels?\s*:\s*(?:\*\*)?L1\b/i.test(l.text));

  // ---- choose a strategy
  const structured = input.some((l) => l.marker?.kind === "problem");
  let markers: Marker[] = [];
  let style: Segmentation["style"];
  let confidence: SegmentedProblem["confidence"];
  if (structured) {
    style = "structured";
    confidence = "high";
    input.forEach((l, index) => {
      if (l.marker?.kind === "problem") {
        markers.push({ index, number: l.marker.number ?? "", title: l.marker.title ?? "", rest: l.text });
      }
    });
  } else {
    const kw = keywordMarkers(input, levelsDefined);
    const dec = decimalMarkers(input, levelsDefined);
    const nb = numberedMarkers(input);
    if (kw.length >= 1) {
      style = "keyword";
      confidence = "high";
      markers = kw;
    } else if (dec.length >= 2) {
      style = "numbered";
      confidence = "high";
      markers = dec;
    } else if (nb.length >= 2) {
      style = "numbered";
      confidence = "medium";
      markers = nb;
    } else {
      const heads = input
        .map((l, index) => ({ l, index }))
        .filter(({ l, index }) => l.heading && l.heading >= 2 && !lectureAt.has(index));
      if (heads.length >= 2) {
        style = "headings";
        confidence = "medium";
        markers = heads.map(({ l, index }) => ({
          index,
          number: "",
          title: l.text.replace(/^[#*\s]+|[*\s]+$/g, ""),
          rest: "",
        }));
      } else {
        style = "single";
        confidence = "low";
        const first = input.findIndex((l) => l.text.trim() && !l.heading && !lectureAt.has(input.indexOf(l)));
        if (first >= 0) markers = [{ index: first, number: "", title: "", rest: input[first].text }];
      }
    }
  }

  // ---- build problems
  const problems: SegmentedProblem[] = [];
  const preamble = trimBlank(input.slice(0, markers[0]?.index ?? input.length));
  let currentLecture: { number: string; title: string } | null = null;
  let currentSection = "";
  let scan = 0;
  const advanceContext = (upTo: number) => {
    for (; scan <= upTo && scan < input.length; scan++) {
      if (lectureAt.has(scan)) {
        const lec = lectureAt.get(scan)!;
        currentLecture = { number: lec.number, title: lec.title };
        currentSection = `Lecture ${lec.number}${lec.title ? ` — ${lec.title}` : ""}${lec.detail ? ` (${lec.detail.replace(/\bPP\.\s*/i, "pp. ").replace(/^NOTES\b/i, "notes")})` : ""}`;
      } else if (sectionAt.has(scan)) currentSection = sectionAt.get(scan)!;
    }
  };

  markers.forEach((mk, i) => {
    advanceContext(mk.index);
    let end = markers[i + 1]?.index ?? input.length;
    // A lecture or section heading between two problems belongs to the next problem's context.
    for (let j = mk.index + 1; j < end; j++) {
      if (lectureAt.has(j) || (style !== "headings" && sectionAt.has(j) && input[j].heading)) {
        end = j;
        break;
      }
      if (input[j].marker?.kind === "end") {
        end = j;
        break;
      }
    }
    const body: ExtractedLine[] = [];
    const solution: ExtractedLine[] = [];
    const first = input[mk.index];
    if (style !== "headings" && mk.rest.trim()) {
      body.push({
        ...first,
        text: mk.rest,
        assisted: first.assisted ? stripMarker(first.assisted, style) : undefined,
        marker: undefined,
      });
    }
    // Lines that hold a lecture title belong to the heading, not to the previous problem.
    for (let j = mk.index + 1; j < end; j++) {
      if (titleLines.has(j)) {
        end = j;
        break;
      }
    }
    for (let j = mk.index + 1; j < end; j++) {
      const l = input[j];
      if (l.role === "solution") solution.push(l);
      else body.push(l);
    }
    const { lines, parts } = splitParts(trimBlank(body));
    problems.push({
      number: mk.number,
      title: mk.title,
      raw: input.slice(mk.index, end),
      lines,
      parts: parts.map((p) => ({ label: p.label, lines: trimBlank(p.lines) })),
      solution: trimBlank(solution),
      page: first.page ?? firstPage(body),
      pageEnd: lastPage(body) ?? first.page ?? null,
      lecture: currentLecture,
      section: currentSection,
      confidence,
      difficulty: mk.difficulty ?? null,
      priority: mk.priority ?? 0,
    });
  });

  return { style, preamble, problems: mergeLetteredProblems(problems), lectures };
}

function stripMarker(text: string, style: Segmentation["style"]): string {
  if (style === "keyword") return KEYWORD_RE.exec(text)?.[4] ?? text;
  if (style === "numbered") return NUMBERED_RE.exec(text)?.[2] ?? text;
  return text;
}

/** "Problem 4a", "Problem 4b" → one Problem 4 with parts (a), (b). */
function mergeLetteredProblems(problems: SegmentedProblem[]): SegmentedProblem[] {
  const lettered = (p: SegmentedProblem) => /^(\d+(?:\.\d+)*)\(?([a-z])\)?$/.exec(p.number);
  const out: SegmentedProblem[] = [];
  for (let i = 0; i < problems.length; i++) {
    const m = lettered(problems[i]);
    let j = i + 1;
    while (m && j < problems.length && lettered(problems[j])?.[1] === m[1]) j++;
    if (!m || j - i < 2) {
      out.push(problems[i]);
      continue;
    }
    const group = problems.slice(i, j);
    out.push({
      ...group[0],
      number: m[1],
      raw: group.flatMap((g) => g.raw),
      lines: [],
      parts: group.map((g) => ({ label: lettered(g)![2], lines: g.lines })),
      solution: group.flatMap((g) => g.solution),
      pageEnd: group[group.length - 1].pageEnd,
    });
    i = j - 1;
  }
  return out;
}

/** Joins lines into Markdown: consecutive lines stay in one paragraph, empty lines separate paragraphs. */
export function linesToText(lines: ExtractedLine[], useAssisted = false): string {
  const out: string[] = [];
  let blank = false;
  for (const l of lines) {
    const t = useAssisted && l.assisted !== undefined ? l.assisted : l.text;
    if (!t.trim()) {
      blank = out.length > 0;
      continue;
    }
    if (blank) out.push("");
    blank = false;
    out.push(l.heading ? `${"#".repeat(Math.min(6, l.heading + 1))} ${t.replace(/^#+\s*/, "")}` : t);
  }
  return out.join("\n").trim();
}
