// Import pipeline: file → ExtractedDocument → DocPlan (editable candidates) → commit.

import type { Course, ImportFlag, Lecture, Source, SourceFormat, SourceKind, Topic } from "../data/types";
import type { Repo } from "../data/repo";
import type { Statement } from "../data/driver";
import { nowIso } from "../data/ids";
import { courseLabel, lectureLabel } from "../domain/filters";
import { extractMarkdown, extractPlainText } from "./extract-text";
import { extractLatex } from "./extract-latex";
import { extractDocx } from "./extract-docx";
import { extractPdf, type PdfjsLike } from "./extract-pdf";
import { extractProblemSetJson, isLibraryJson } from "./extract-json";
import { linesToText, segment } from "./segment";
import {
  findLecture,
  normalize,
  parseLectureNumbers,
  suggestCategory,
  suggestCourse,
  suggestDifficulty,
  suggestTopics,
} from "./classify";
import { DuplicateIndex, type ExistingStatement } from "./duplicates";
import type { Candidate, CandidatePart, ExtractedDocument, ExtractedLine } from "./types";

export type DetectedFormat = SourceFormat | "backup" | "unsupported";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export function extOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function detectFormat(name: string): DetectedFormat {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown" || ext === "mdown") return "markdown";
  if (ext === "tex" || ext === "ltx" || ext === "latex") return "latex";
  if (ext === "txt" || ext === "text") return "text";
  if (ext === "docx") return "docx";
  if (ext === "json") return "json";
  if (ext === "zip") return "backup";
  if (ext in IMAGE_MIME) return "image";
  return "unsupported";
}

export function mimeOf(name: string): string {
  const ext = extOf(name);
  return IMAGE_MIME[ext] ?? (ext === "pdf" ? "application/pdf" : "application/octet-stream");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

export interface ExtractDeps {
  loadPdfjs: () => Promise<PdfjsLike>;
  onProgress?: (message: string) => void;
}

export class LibraryFileError extends Error {
  constructor(readonly library: unknown) {
    super("This JSON file is a complete Marée library export.");
  }
}

export async function extractDocument(name: string, bytes: Uint8Array, deps: ExtractDeps): Promise<ExtractedDocument> {
  const format = detectFormat(name);
  switch (format) {
    case "pdf":
      return extractPdf(name, bytes, await deps.loadPdfjs(), (p, n) => deps.onProgress?.(`Reading page ${p} of ${n}`));
    case "markdown":
      return extractMarkdown(name, decodeText(bytes));
    case "text":
      return extractPlainText(name, decodeText(bytes));
    case "latex":
      return extractLatex(name, decodeText(bytes));
    case "docx":
      return extractDocx(name, bytes);
    case "json": {
      let value: unknown;
      try {
        value = JSON.parse(decodeText(bytes));
      } catch (e) {
        throw new Error(`Invalid JSON: ${(e as Error).message}`);
      }
      if (isLibraryJson(value)) throw new LibraryFileError(value);
      return extractProblemSetJson(name, value);
    }
    case "image":
      return {
        fileName: name,
        format: "image",
        title: name.replace(/\.[^.]+$/, ""),
        lines: [],
        images: [{ name, bytes, mime: mimeOf(name) }],
        reliability: "uncertain",
        warnings: ["Images are stored as attachments. Transcribe the statement while viewing the image."],
      };
    case "backup":
      throw new Error("Library backups (.zip) are restored with File › Restore Library Backup…");
    default:
      throw new Error(
        extOf(name) === "doc"
          ? "Legacy .doc files are not supported. Save the document as .docx and import it again."
          : `Unsupported file type “.${extOf(name)}”. Supported: PDF, Markdown, LaTeX, plain text, DOCX, JSON and images.`,
      );
  }
}

// ---------------------------------------------------------------- planning

export interface LibraryContext {
  courses: Course[];
  lectures: Lecture[];
  topics: Topic[];
  existing: ExistingStatement[];
}

export interface LectureMapping {
  ref: string;
  title: string;
  lectureId: string | null;
  create: boolean;
  count: number;
}

export interface DocPlan {
  key: string;
  fileName: string;
  path: string | null;
  bytes: Uint8Array | null;
  hash: string | null;
  size: number;
  doc: ExtractedDocument;
  style: string;
  preamble: string;
  courseId: string | null;
  newCourse: { code: string; title: string } | null;
  courseReason: string;
  sourceTitle: string;
  sourceKind: SourceKind;
  sourceAuthor: string;
  lectureMap: LectureMapping[];
  /** Lecture from the file name, used when the document has no lecture headings. */
  fileLectureRefs: string[];
  candidates: Candidate[];
  existingSources: Source[];
  newTopicNames: { name: string; accept: boolean; count: number }[];
  skip: boolean;
}

export function guessSourceKind(fileName: string, title: string): SourceKind {
  const t = `${fileName} ${title}`.toLowerCase();
  if (/assignment|homework|\bhw\s?\d|\bhw\b|\ba\d+\b/.test(t)) return "assignment";
  if (/exam|midterm|final|quiz|test\b/.test(t)) return "exam";
  if (/practice|problem.?set|pset|exercises|worksheet|tutorial|problems/.test(t)) return "problem-set";
  if (/textbook|chapter|\bch\.?\s?\d/.test(t)) return "textbook";
  if (/notes|lecture/.test(t)) return "lecture-notes";
  return "other";
}

export function prettyFileTitle(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeFlags(flags: ImportFlag[]): ImportFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
}

function linesFlags(lines: ExtractedLine[]): ImportFlag[] {
  return dedupeFlags(lines.flatMap((l) => l.flags ?? []));
}

function wholeText(statement: string, parts: CandidatePart[]): string {
  if (!parts.length) return statement;
  const body = parts.map((p) => `(${p.label}) ${p.statement}`).join("\n\n");
  return statement ? `${statement}\n\n${body}` : body;
}

let planCounter = 0;

export function planDocument(
  input: { fileName: string; path?: string | null; bytes?: Uint8Array | null; hash: string | null; size: number; doc: ExtractedDocument },
  ctx: LibraryContext,
  existingSources: Source[] = [],
): DocPlan {
  const { doc } = input;
  const key = `doc${++planCounter}`;
  const dup = new DuplicateIndex(ctx.existing);
  const pdf = doc.format === "pdf";

  type Draft = Omit<Candidate, "key" | "lectureIds"> & { lectureIds: string[] };
  const drafts: Draft[] = [];
  let style = "structured";
  let preamble = "";
  const fileLectureRefs = parseLectureNumbers(prettyFileTitle(input.fileName)).map(String);

  if (doc.structured) {
    style = "structured";
    for (const sp of doc.structured) {
      const parts = (sp.parts ?? []).map((p) => ({ label: p.label, statement: p.statement }));
      const topicNames = (sp.topics ?? []).map(normalize);
      const topicIds = ctx.topics.filter((t) => topicNames.includes(normalize(t.name))).map((t) => t.id);
      const missing = (sp.topics ?? []).filter((n) => !ctx.topics.some((t) => normalize(t.name) === normalize(n)));
      drafts.push({
        include: true,
        number: sp.number ?? "",
        title: sp.title ?? "",
        statement: sp.statement,
        wholeStatement: wholeText(sp.statement, parts),
        rawText: wholeText(sp.statement, parts),
        assistedStatement: null,
        assistedParts: null,
        usingAssisted: false,
        parts,
        splitParts: parts.length > 0,
        referenceSolution: sp.referenceSolution ?? "",
        notes: sp.notes ?? "",
        page: sp.page ?? null,
        pageEnd: sp.page ?? null,
        section: "",
        lectureRef: sp.lecture || null,
        confidence: "high",
        flags: [],
        reviewed: true,
        lectureIds: [],
        topicIds,
        suggestedTopicNames: missing,
        category: sp.category ?? suggestCategory(sp.statement),
        difficulty: sp.difficulty ?? null,
        duplicateOf: null,
      });
    }
  } else if (doc.format === "image") {
    style = "single";
    drafts.push({
      include: true,
      number: "",
      title: doc.title,
      statement: "",
      wholeStatement: "",
      rawText: "",
      assistedStatement: null,
      assistedParts: null,
      usingAssisted: false,
      parts: [],
      splitParts: false,
      referenceSolution: "",
      notes: "",
      page: null,
      pageEnd: null,
      section: "",
      lectureRef: null,
      confidence: "low",
      flags: [{ code: "no-text", message: "The statement is in the attached image and must be transcribed." }],
      reviewed: false,
      lectureIds: [],
      topicIds: [],
      suggestedTopicNames: [],
      category: null,
      difficulty: null,
      duplicateOf: null,
      images: doc.images,
    });
  } else {
    const seg = segment(doc.lines);
    style = seg.style;
    preamble = linesToText(seg.preamble);
    for (const sp of seg.problems) {
      const statement = linesToText(sp.lines);
      const parts = sp.parts.map((p) => ({ label: p.label, statement: linesToText(p.lines) }));
      const whole = wholeText(statement, parts);
      const assistedStatement = pdf ? linesToText(sp.lines, true) : null;
      const assistedParts = pdf ? sp.parts.map((p) => ({ label: p.label, statement: linesToText(p.lines, true) })) : null;
      const flags: ImportFlag[] = pdf ? linesFlags(sp.raw) : [];
      if (doc.format === "docx" && doc.reliability === "uncertain") {
        flags.push({ code: "docx-math-partial", message: "Some equation elements were converted approximately." });
      }
      if (sp.confidence === "low") flags.push({ code: "low-confidence", message: "No clear problem boundaries were found; check where this problem starts and ends." });
      if (whole.length > 5000) flags.push({ code: "long", message: "Unusually long statement; it may contain several problems." });
      if (whole.replace(/\s/g, "").length < 15) flags.push({ code: "short", message: "Very short statement; text may be missing." });
      const topics = suggestTopics(`${sp.title}\n${whole}`, ctx.topics);
      drafts.push({
        include: true,
        number: sp.number,
        title: sp.title,
        statement,
        wholeStatement: whole,
        rawText: linesToText(sp.raw),
        assistedStatement,
        assistedParts,
        usingAssisted: false,
        parts,
        splitParts: parts.length > 0,
        referenceSolution: linesToText(sp.solution),
        notes: "",
        page: sp.page,
        pageEnd: sp.pageEnd,
        section: sp.section,
        lectureRef: sp.lecture?.number ?? null,
        confidence: sp.confidence,
        flags: dedupeFlags(flags),
        reviewed: false,
        lectureIds: [],
        topicIds: topics.hits.slice(0, 4).map((h) => h.topicId),
        suggestedTopicNames: topics.newNames,
        category: suggestCategory(whole),
        difficulty: suggestDifficulty(linesToText(sp.raw)),
        duplicateOf: null,
      });
    }
    if (pdf && doc.emptyPages?.length && doc.emptyPages.length === doc.pageCount) {
      // Scanned PDF: one empty problem per page, to be transcribed beside the page image.
      for (const page of doc.emptyPages) {
        drafts.push({
          include: false,
          number: "",
          title: `Page ${page}`,
          statement: "",
          wholeStatement: "",
          rawText: "",
          assistedStatement: null,
          assistedParts: null,
          usingAssisted: false,
          parts: [],
          splitParts: false,
          referenceSolution: "",
          notes: "",
          page,
          pageEnd: page,
          section: "",
          lectureRef: null,
          confidence: "low",
          flags: [{ code: "no-text", message: "No text layer on this page; transcribe from the page image." }],
          reviewed: false,
          lectureIds: [],
          topicIds: [],
          suggestedTopicNames: [],
          category: null,
          difficulty: null,
          duplicateOf: null,
        });
      }
    }
  }

  for (const d of drafts) {
    const hit = dup.find(d.wholeStatement);
    if (hit) {
      d.duplicateOf = hit;
      d.include = false;
      d.flags = [...d.flags, { code: "possible-duplicate", message: `Similar to an existing problem (${Math.round(hit.similarity * 100)}% match).` }];
    }
  }

  const course = suggestCourse(input.fileName, doc.title, `${doc.meta?.course ?? ""}\n${preamble}`, ctx.courses);
  const newTopicCounts = new Map<string, number>();
  for (const d of drafts) for (const n of d.suggestedTopicNames) newTopicCounts.set(n, (newTopicCounts.get(n) ?? 0) + 1);

  const plan: DocPlan = {
    key,
    fileName: input.fileName,
    path: input.path ?? null,
    bytes: input.bytes ?? null,
    hash: input.hash,
    size: input.size,
    doc,
    style,
    preamble,
    courseId: course.courseId,
    newCourse: course.newCourse,
    courseReason: course.reason,
    sourceTitle: doc.meta?.sourceTitle || (doc.title && doc.title !== doc.fileName.replace(/\.[^.]+$/, "") ? doc.title : prettyFileTitle(input.fileName)),
    sourceKind: doc.meta?.sourceKind ?? guessSourceKind(input.fileName, doc.title),
    sourceAuthor: doc.meta?.author ?? "",
    lectureMap: [],
    fileLectureRefs,
    candidates: drafts.map((d, i) => ({ ...d, key: `${key}:${i}` })),
    existingSources,
    newTopicNames: [...newTopicCounts].map(([name, count]) => ({ name, count, accept: false })),
    skip: existingSources.length > 0,
  };
  return mapLectures(plan, plan.courseId, ctx);
}

/** (Re)computes the lecture mapping after the course changes. */
export function mapLectures(plan: DocPlan, courseId: string | null, ctx: Pick<LibraryContext, "lectures">): DocPlan {
  const refs = new Map<string, { title: string; count: number }>();
  const fallback = plan.fileLectureRefs.length === 1 ? plan.fileLectureRefs[0] : null;
  for (const c of plan.candidates) {
    const ref = c.lectureRef ?? fallback;
    if (!ref) continue;
    const prev = refs.get(ref);
    refs.set(ref, { title: prev?.title ?? "", count: (prev?.count ?? 0) + 1 });
  }
  // Lecture titles from the document's own headings.
  const headingTitles = new Map<string, string>();
  for (const l of plan.doc.lines) {
    const m = /^\s*(?:#+\s*)?(?:\*\*)?\s*(?:Lecture|Lec\.|Week|Tutorial|Unit)\s+(\d+[A-Za-z]?)\s*(?:[:.\-–—]+\s*(.*?))?\s*(?:\*\*)?\s*$/i.exec(l.text);
    if (m && m[2] && !headingTitles.has(m[1])) headingTitles.set(m[1], m[2].replace(/[*_]+$/g, "").trim());
  }
  const lectureMap: LectureMapping[] = [...refs].map(([ref, v]) => {
    const existing = findLecture(courseId, ref, ctx.lectures);
    const prev = plan.lectureMap.find((m) => m.ref === ref);
    return {
      ref,
      title: existing?.title || headingTitles.get(ref) || prev?.title || "",
      lectureId: existing?.id ?? null,
      create: !existing && !!(courseId || plan.newCourse),
      count: v.count,
    };
  });
  lectureMap.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const candidates = plan.candidates.map((c) => {
    const ref = c.lectureRef ?? fallback;
    const m = ref ? lectureMap.find((x) => x.ref === ref) : undefined;
    // Keep lectures the user picked by hand; replace only those that came from the mapping.
    const mapped = new Set(plan.lectureMap.map((x) => x.lectureId).filter(Boolean) as string[]);
    const manual = c.lectureIds.filter((id) => !mapped.has(id));
    return { ...c, lectureIds: m?.lectureId ? [...new Set([m.lectureId, ...manual])] : manual };
  });
  return { ...plan, courseId, lectureMap, candidates };
}

export function candidateText(c: Candidate): { statement: string; parts: CandidatePart[] } {
  const statement = c.usingAssisted && c.assistedStatement !== null ? c.assistedStatement : c.statement;
  const parts = c.usingAssisted && c.assistedParts ? c.assistedParts : c.parts;
  if (!c.splitParts) return { statement: c.usingAssisted && c.assistedStatement !== null ? wholeText(statement, parts) : c.wholeStatement, parts: [] };
  return { statement, parts };
}

/** Flags kept on the stored problem so it shows up under "Needs import review". */
export function storedFlags(c: Candidate): ImportFlag[] {
  if (c.reviewed) return [];
  const flags = c.flags.filter((f) => f.code !== "possible-duplicate");
  if (c.usingAssisted) flags.push({ code: "assisted-latex", message: "LaTeX was reconstructed automatically from PDF text." });
  return dedupeFlags(flags);
}

// ------------------------------------------------------------------ commit

export interface CommitDeps {
  repo: Repo;
  storeFile: (
    kind: "sources" | "attachments",
    name: string,
    bytes: Uint8Array | null,
    path: string | null,
  ) => Promise<{ storedPath: string; hash: string; size: number }>;
}

export interface CommitResult {
  sourceIds: string[];
  problemIds: string[];
  createdCourses: number;
  createdLectures: number;
  createdTopics: number;
}

export async function commitPlans(plans: DocPlan[], deps: CommitDeps): Promise<CommitResult> {
  const { repo } = deps;
  const result: CommitResult = { sourceIds: [], problemIds: [], createdCourses: 0, createdLectures: 0, createdTopics: 0 };
  let topics = await repo.listTopics();
  for (const plan of plans) {
    const included = plan.candidates.filter((c) => c.include);
    if (plan.skip || included.length === 0) continue;

    // 1. Course
    let courseId = plan.courseId;
    if (!courseId && plan.newCourse && (plan.newCourse.code || plan.newCourse.title)) {
      const c = await repo.createCourse({ code: plan.newCourse.code, title: plan.newCourse.title });
      courseId = c.id;
      result.createdCourses++;
    }

    // 2. Lectures referenced by included problems
    const lectureIdByRef = new Map<string, string>();
    const toCreate = plan.lectureMap.filter((m) => !m.lectureId && m.create && courseId);
    if (toCreate.length) {
      const created = await repo.createLectures(
        toCreate.map((m) => ({ courseId: courseId!, number: m.ref, title: m.title })),
      );
      created.forEach((l, i) => lectureIdByRef.set(toCreate[i].ref, l.id));
      result.createdLectures += created.length;
    }
    for (const m of plan.lectureMap) if (m.lectureId) lectureIdByRef.set(m.ref, m.lectureId);
    const fallback = plan.fileLectureRefs.length === 1 ? plan.fileLectureRefs[0] : null;

    // 3. Accepted new topics
    const accepted = plan.newTopicNames.filter((t) => t.accept).map((t) => t.name);
    const missing = accepted.filter((n) => !topics.some((t) => normalize(t.name) === normalize(n)));
    if (missing.length) {
      await repo.createTopics(missing.map((name) => ({ name })));
      result.createdTopics += missing.length;
      topics = await repo.listTopics();
    }
    const topicByName = new Map(topics.map((t) => [normalize(t.name), t.id]));

    // 4. Original file
    let stored: { storedPath: string; hash: string; size: number } | null = null;
    if (plan.bytes || plan.path) {
      stored = await deps.storeFile("sources", plan.fileName, plan.bytes, plan.path);
    }

    // 5. Source + problems in one transaction
    const now = nowIso();
    const statements: Statement[] = [];
    const src = repo.sourceInsert(
      {
        title: plan.sourceTitle,
        kind: plan.sourceKind,
        format: plan.doc.format,
        author: plan.sourceAuthor,
        fileName: plan.fileName,
        storedPath: stored?.storedPath ?? null,
        originalPath: plan.path,
        fileHash: stored?.hash ?? plan.hash,
        fileSize: stored?.size ?? plan.size,
        pageCount: plan.doc.pageCount ?? null,
        courseId,
        importedAt: now,
        notes: plan.doc.warnings.join("\n"),
      },
      now,
    );
    statements.push(src.statement);
    const attachmentJobs: { problemId: string; image: { name: string; bytes: Uint8Array; mime: string } }[] = [];
    for (const c of included) {
      const { statement, parts } = candidateText(c);
      const ref = c.lectureRef ?? fallback;
      const lectureIds = new Set(c.lectureIds);
      if (ref && lectureIdByRef.has(ref)) lectureIds.add(lectureIdByRef.get(ref)!);
      const topicIds = new Set(c.topicIds);
      for (const n of c.suggestedTopicNames) {
        const id = accepted.includes(n) ? topicByName.get(normalize(n)) : undefined;
        if (id) topicIds.add(id);
      }
      const { id, statements: ps } = repo.problemInsert(
        {
          title: c.title,
          statement,
          parts: parts.map((p) => ({ label: p.label, statement: p.statement })),
          courseId,
          sourceId: src.id,
          sourceNumber: c.number,
          sourcePage: c.page,
          sourceSection: c.section,
          sourceExcerpt: c.rawText || null,
          difficulty: c.difficulty,
          category: c.category,
          referenceSolution: c.referenceSolution,
          notes: c.notes,
          importFlags: storedFlags(c),
          lectureIds: [...lectureIds],
          topicIds: [...topicIds],
          historyKind: "imported",
        },
        now,
      );
      statements.push(...ps);
      result.problemIds.push(id);
      for (const image of c.images ?? []) attachmentJobs.push({ problemId: id, image });
    }
    await repo.run(statements);
    result.sourceIds.push(src.id);

    for (const job of attachmentJobs) {
      const f = await deps.storeFile("attachments", job.image.name, job.image.bytes, null);
      await repo.addAttachment({
        problemId: job.problemId,
        fileName: job.image.name,
        storedPath: f.storedPath,
        mime: job.image.mime,
        size: f.size,
        hash: f.hash,
        caption: "",
      });
    }
  }
  return result;
}

export function describeTarget(plan: DocPlan, ctx: Pick<LibraryContext, "courses" | "lectures">): string {
  const c = ctx.courses.find((x) => x.id === plan.courseId);
  const course = c ? courseLabel(c) : plan.newCourse ? `${plan.newCourse.code} (new)` : "No course";
  const lecs = plan.lectureMap
    .map((m) => {
      const l = ctx.lectures.find((x) => x.id === m.lectureId);
      return l ? lectureLabel(l) : m.create ? `Lecture ${m.ref} (new)` : null;
    })
    .filter(Boolean);
  return lecs.length ? `${course} · ${lecs.join(", ")}` : course;
}
