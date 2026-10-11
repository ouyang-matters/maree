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

function isLectureHeading(line: ExtractedLine): { number: string; title: string } | null {
  const text = line.text.trim();
  if (text.length > 120) return null;
  const m = LECTURE_RE.exec(text);
  if (!m) return null;
  const title = (m[3] ?? "").replace(/[*_]+$/g, "").trim();
  // A long sentence that merely starts with "Lecture 9 …" is prose, not a heading.
  if (!line.heading && /[.;]$/.test(title) && title.split(/\s+/).length > 8) return null;
  return { number: m[2], title };
}

function lectureKindOf(text: string): string {
  return (LECTURE_RE.exec(text.trim())?.[1] ?? "").toLowerCase();
}

interface Marker {
  index: number;
  number: string;
  title: string;
  rest: string;
}

function keywordMarkers(lines: ExtractedLine[]): Marker[] {
  const out: Marker[] = [];
  lines.forEach((l, index) => {
    if ((l.indent ?? 0) > 2) return;
    const m = KEYWORD_RE.exec(l.text);
    if (!m) return;
    // "Q" alone is accepted only with punctuation or a number directly attached ("Q3.").
    if (/^q$/i.test(m[1]) && !/^\s*(?:\*\*)?Q\d/i.test(l.text)) return;
    out.push({ index, number: m[2], title: (m[3] ?? "").trim(), rest: m[4] ?? "" });
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
    const lecture = index > 0 && lines.slice(Math.max(0, index - 3), index).some((x) => isLectureHeading(x));
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
  const lectureAt = new Map<number, { number: string; title: string }>();
  const sectionAt = new Map<number, string>();
  input.forEach((l, i) => {
    const lec = isLectureHeading(l);
    if (lec) {
      const kind = lectureKindOf(l.text);
      if (kind === "section" || kind === "chapter") sectionAt.set(i, l.text.replace(/^[#*\s]+|[*\s]+$/g, ""));
      else {
        lectureAt.set(i, lec);
        lectures.push({ ...lec, page: l.page ?? null });
      }
    } else if (l.heading && !KEYWORD_RE.test(l.text)) {
      sectionAt.set(i, l.text.replace(/^[#*\s]+|[*\s]+$/g, ""));
    }
  });

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
    const kw = keywordMarkers(input);
    const nb = numberedMarkers(input);
    if (kw.length >= 1) {
      style = "keyword";
      confidence = "high";
      markers = kw;
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
        currentLecture = lectureAt.get(scan)!;
        currentSection = input[scan].text.replace(/^[#*\s]+|[*\s]+$/g, "");
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
