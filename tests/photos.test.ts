import { describe, expect, it } from "vitest";
import { freshRepo } from "./helpers/node-driver";
import {
  appendBlock,
  attachmentImages,
  encodeBmp,
  imageMarkdown,
  isUsableRect,
  moveRect,
  photoFileName,
  readingOrder,
  rectFrom,
  regionPixels,
  rotateRect,
  withoutAttachmentImages,
} from "../src/domain/photos";
import { chatGptSections } from "../src/export/chatgpt";
import type { Attachment, Problem } from "../src/data/types";

describe("crop regions", () => {
  it("normalises a dragged rectangle and keeps it inside the photo", () => {
    expect(rectFrom({ x: 0.8, y: 0.6 }, { x: 0.2, y: 1.4 })).toEqual({ x: 0.2, y: 0.6, w: 0.6000000000000001, h: 0.4 });
    expect(moveRect({ x: 0.7, y: 0.1, w: 0.5, h: 0.2 }, 0.3, -0.5)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.2 });
    expect(isUsableRect({ w: 0.01, h: 0.5 })).toBe(false);
    expect(isUsableRect({ w: 0.3, h: 0.1 })).toBe(true);
  });

  it("maps regions to pixels without overflowing", () => {
    expect(regionPixels({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 3001, 2001)).toEqual({ x: 1501, y: 1001, w: 1500, h: 1000 });
  });

  it("keeps regions on the same content when the photo is rotated", () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const cw = rotateRect(r, true);
    expect(cw).toEqual({ x: 0.4, y: 0.1, w: 0.4, h: 0.3 });
    const back = rotateRect(cw, false);
    expect(back.x).toBeCloseTo(r.x);
    expect(back.y).toBeCloseTo(r.y);
    expect(back.w).toBeCloseTo(r.w);
    expect(back.h).toBeCloseTo(r.h);
  });

  it("orders regions as they are read: by row, then left to right", () => {
    const regions = [
      { id: "c", x: 0.05, y: 0.6, h: 0.2 },
      { id: "b", x: 0.55, y: 0.12, h: 0.3 },
      { id: "a", x: 0.05, y: 0.1, h: 0.3 },
    ];
    expect(readingOrder(regions).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("attachment images in Markdown", () => {
  it("finds and removes image references", () => {
    const md = `Prove it.\n\n${imageMarkdown("photo 1.jpg", "Problem")}\n\n\n${imageMarkdown("b.png", "x")}`;
    expect(attachmentImages(md)).toEqual(["photo 1.jpg", "b.png"]);
    expect(withoutAttachmentImages(md)).toBe("Prove it.");
    expect(appendBlock("", "x")).toBe("x");
    expect(appendBlock("My proof.\n", "![a](attachment:a.jpg)")).toBe("My proof.\n\n![a](attachment:a.jpg)");
  });

  it("names photos by date", () => {
    expect(photoFileName(new Date(2026, 9, 11, 14, 5), 2)).toBe("photo-2026-10-11-1405-2.jpg");
  });
});

describe("BMP encoding", () => {
  it("writes a bottom-up 24-bit bitmap with padded rows on white", () => {
    // 2×2: red, green / blue, transparent
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
    const bmp = encodeBmp(rgba, 2, 2);
    const v = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(v.getUint32(2, true)).toBe(54 + 8 * 2);
    expect(v.getInt32(18, true)).toBe(2);
    expect(v.getUint16(28, true)).toBe(24);
    // First stored row is the bottom row: blue, then transparent → white (BGR order).
    expect([...bmp.slice(54, 60)]).toEqual([255, 0, 0, 255, 255, 255]);
    // Second stored row: red, green.
    expect([...bmp.slice(62, 68)]).toEqual([0, 0, 255, 0, 255, 0]);
  });
});

describe("Copy for ChatGPT", () => {
  const att = (fileName: string, mime = "image/jpeg"): Attachment => ({
    id: fileName,
    problemId: "p",
    fileName,
    storedPath: `attachments/${fileName}`,
    mime,
    size: 1,
    hash: fileName,
    caption: "",
    createdAt: "",
  });

  it("separates the problem from my answer, keeping typed text and photos", () => {
    const p = {
      statement: `${imageMarkdown("q.jpg", "Problem")}`,
      solution: `Let \\(\\varepsilon>0\\).\n\n${imageMarkdown("a.jpg", "My answer")}`,
      attachments: [att("q.jpg"), att("a.jpg"), att("notes.pdf", "application/pdf")],
      parts: [
        { id: "x", problemId: "p", label: "b", sortOrder: 2, statement: "Second", status: "not_started", solution: "", referenceSolution: "", notes: "", lastAttemptAt: null, createdAt: "", updatedAt: "" },
        { id: "y", problemId: "p", label: "a", sortOrder: 1, statement: "First", status: "not_started", solution: imageMarkdown("notes.pdf", "pdf"), referenceSolution: "", notes: "", lastAttemptAt: null, createdAt: "", updatedAt: "" },
      ],
    } as unknown as Problem;
    const { question, answer } = chatGptSections(p);
    expect(question.images.map((a) => a.fileName)).toEqual(["q.jpg"]);
    expect(question.text).toBe("**(a)** First\n\n**(b)** Second");
    expect(answer.images.map((a) => a.fileName)).toEqual(["a.jpg"]);
    expect(answer.text).toBe("Let \\(\\varepsilon>0\\).");
  });
});

describe("photo problems in the repository", () => {
  it("creates a problem with its cropped photo in one step", async () => {
    const { repo } = await freshRepo();
    const course = await repo.createCourse({ code: "MATH 147", title: "" });
    const id = await repo.createProblemWithAttachments(
      { title: "Photo · 1", statement: imageMarkdown("photo-1.jpg", "Problem"), courseId: course.id },
      [{ fileName: "photo-1.jpg", storedPath: "attachments/ab/abc.jpg", mime: "image/jpeg", size: 10, hash: "abc", caption: "" }],
    );
    const p = (await repo.getProblem(id))!;
    expect(p.courseId).toBe(course.id);
    expect(p.attachments.map((a) => a.fileName)).toEqual(["photo-1.jpg"]);
    expect(attachmentImages(p.statement)).toEqual(["photo-1.jpg"]);
  });

  it("attaches an answer photo and references it in My Solution atomically", async () => {
    const { repo } = await freshRepo();
    const id = await repo.createProblem({ title: "Uniqueness", statement: "Prove it.", solution: "Draft." });
    await repo.addAttachmentWithPatch(
      { problemId: id, fileName: "photo-2.jpg", storedPath: "attachments/cd/cde.jpg", mime: "image/jpeg", size: 10, hash: "cde", caption: "" },
      { solution: appendBlock("Draft.", imageMarkdown("photo-2.jpg", "My answer")) },
    );
    const p = (await repo.getProblem(id))!;
    expect(p.solution).toBe("Draft.\n\n![My answer](attachment:photo-2.jpg)");
    expect(p.attachments).toHaveLength(1);
  });
});
