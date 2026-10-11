// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocx } from "../src/import/extract-docx";
import { segment } from "../src/import/segment";
import { checkLatex } from "../src/math/render";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const r = (t: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const mr = (t: string, plain = false) => `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}<m:t>${t}</m:t></m:r>`;

async function makeDocx(body: string, numbering?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles ${W}><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  );
  if (numbering) zip.file("word/numbering.xml", `<?xml version="1.0"?><w:numbering ${W}>${numbering}</w:numbering>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("DOCX extraction", () => {
  it("converts Word equations (OMML) to valid LaTeX", async () => {
    const frac = `<m:f><m:num>${mr("1")}</m:num><m:den><m:sSup><m:e>${mr("n")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup></m:den></m:f>`;
    const sum = `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${mr("n=1")}</m:sub><m:sup>${mr("∞")}</m:sup><m:e>${frac}</m:e></m:nary>`;
    const lim = `<m:func><m:fName><m:limLow><m:e>${mr("lim", true)}</m:e><m:lim>${mr("n→∞")}</m:lim></m:limLow></m:fName><m:e><m:sSub><m:e>${mr("x")}</m:e><m:sub>${mr("n")}</m:sub></m:sSub></m:e></m:func>`;
    const sqrt = `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mr("2+")}<m:sSub><m:e>${mr("x")}</m:e><m:sub>${mr("n")}</m:sub></m:sSub></m:e></m:rad>`;
    const abs = `<m:d><m:dPr><m:begChr m:val="|"/><m:endChr m:val="|"/></m:dPr><m:e>${mr("x−L")}</m:e></m:d>`;
    const matrix = `<m:d><m:e><m:m><m:mr><m:e>${mr("1")}</m:e><m:e>${mr("0")}</m:e></m:mr><m:mr><m:e>${mr("0")}</m:e><m:e>${mr("1")}</m:e></m:mr></m:m></m:e></m:d>`;
    const body = [
      p(r("Problem Set 2"), '<w:pStyle w:val="Heading2"/>'),
      p(`${r("Problem 1. ", "<w:b/>")}${r("Show that ")}<m:oMath>${sum}</m:oMath>${r(" converges.")}`),
      p(`${r("Problem 2. ", "<w:b/>")}${r("Let ")}<m:oMath>${mr("x")}</m:oMath>${r(" be such that")}`),
      p(`<m:oMathPara><m:oMath>${lim}${mr("=")}${sqrt}</m:oMath></m:oMathPara>`),
      p(`${r("and ")}<m:oMath>${abs}${mr("&lt;ε")}</m:oMath>${r(". Compute ")}<m:oMath>${matrix}</m:oMath>`),
    ].join("");
    const doc = await extractDocx("set2.docx", await makeDocx(body));
    const all = doc.lines.map((l) => l.text).join("\n");
    expect(all).toContain("\\sum_{n=1}^{\\infty}");
    expect(all).toContain("\\frac{1}{n^{2}}");
    expect(all).toContain("\\lim_{n\\to \\infty}");
    expect(all).toContain("\\sqrt{2+x_{n}}");
    expect(all).toContain("\\left|x-L\\right|");
    expect(all).toContain("\\begin{matrix}1 & 0 \\\\ 0 & 1\\end{matrix}");
    expect(all).toContain("**Problem 1.**");
    expect(checkLatex(all)).toEqual([]);
    expect(doc.reliability).toBe("structured");
    const seg = segment(doc.lines);
    expect(seg.problems.map((x) => x.number)).toEqual(["1", "2"]);
  });

  it("reconstructs automatic list numbering for problems and parts", async () => {
    const numbering = `<w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl>
    </w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
    const li = (lvl: number, text: string) => p(r(text), `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr>`);
    const body = [li(0, "Prove the first claim."), li(1, "first part"), li(1, "second part"), li(0, "Prove the second claim.")].join("");
    const doc = await extractDocx("list.docx", await makeDocx(body, numbering));
    const seg = segment(doc.lines);
    expect(seg.style).toBe("numbered");
    expect(seg.problems.map((x) => x.number)).toEqual(["1", "2"]);
    expect(seg.problems[0].parts.map((x) => x.label)).toEqual(["a", "b"]);
  });
});
