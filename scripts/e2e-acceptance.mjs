// End-to-end acceptance test against the real Windows build of Marée.
//
//   npm run tauri build        (or: npx tauri build --no-bundle)
//   npm run e2e [-- path\to\maree.exe]
//
// The app is started with an isolated data directory (MAREE_DATA_DIR) and WebView2
// remote debugging, then driven through its UI with playwright-core over CDP.
// Native file dialogs cannot be automated, so the PDF enters through the same import
// pipeline that drag-and-drop uses (exposed only when MAREE_E2E=1).

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = resolve(process.argv[2] ?? join(root, "src-tauri", "target", "release", "maree.exe"));
const runDir = join(root, "e2e-data", `run-${Date.now()}`);
const dataDir = join(runDir, "library");
const shots = join(runDir, "screenshots");
const pdf = join(root, "tests", "fixtures", "MATH147_Proof_Practice_Lectures_7-12.pdf");
const port = 9333;
mkdirSync(shots, { recursive: true });

const results = [];
function check(step, ok, detail = "") {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

if (!existsSync(exe)) {
  console.error(`Executable not found: ${exe}\nBuild it first with: npm run tauri build`);
  process.exit(2);
}

async function launch() {
  const proc = spawn(exe, [], {
    env: {
      ...process.env,
      MAREE_DATA_DIR: dataDir,
      MAREE_E2E: "1",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
  });
  const exited = new Promise((r) => proc.on("exit", r));
  let browser;
  for (let i = 0; i < 80 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      /* not ready yet */
    }
  }
  if (!browser) throw new Error("Could not connect to the WebView2 debugging port");
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith("devtools"));
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  await page.waitForSelector(".app", { timeout: 30000 });
  await page.waitForTimeout(800);
  return { proc, browser, page, exited };
}

const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });

// ---------------------------------------------------------------- session 1
console.log(`Executable: ${exe}\nData dir:   ${dataDir}\n`);
let { proc, browser, page, exited } = await launch();
check("1. Marée launches on Windows", true, `window URL ${page.url()}`);
const title = await page.locator(".titlebar .wordmark").innerText();
check("   title bar shows the wordmark", title.trim() === "Marée", title);
await shot(page, "01-first-launch");

await page.getByLabel("Course code").fill("MATH 147");
await page.getByLabel("Course title").fill("Advanced Calculus");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForTimeout(500);
check("2. Create MATH 147", (await page.locator(".sb-item", { hasText: "MATH 147" }).count()) > 0);

await page.getByLabel("First lecture").fill("7");
await page.getByLabel("Last lecture").fill("12");
await page.locator(".ob-step", { hasText: "Add lectures" }).getByRole("button", { name: "Add" }).click();
await page.waitForTimeout(500);
const lectures = await page.locator(".sb-section", { hasText: "Lectures" }).locator(".sb-item").allInnerTexts();
check("3. Add Lectures 7–12", lectures.length === 6, lectures.map((l) => l.split("\n")[0]).join(", "));

await page.getByLabel("Topics, separated by commas").fill("MCT, Subsequences, Cauchy Sequences");
await page.locator(".ob-step", { hasText: "Add topics" }).getByRole("button", { name: "Add" }).click();
await page.waitForTimeout(500);
const topics = await page.locator(".sb-section", { hasText: "Topics" }).locator(".sb-item .label").allInnerTexts();
check("4. Create topics", ["MCT", "Subsequences", "Cauchy Sequences"].every((x) => topics.includes(x)), topics.join(", "));

await page.evaluate((p) => window.__maree.importPaths([p]), pdf);
await page.waitForSelector(".iw-head", { timeout: 30000 });
await page.waitForTimeout(1500);
const found = await page.locator(".iw-cand").count();
check("5. Import a PDF containing exercises", found === 10, `${found} problems detected`);
await shot(page, "02-import-wizard");

await page.locator(".iw-cand-label", { hasText: "Problem 5" }).click();
await page.getByLabel(/Assisted LaTeX conversion/).check();
await page.waitForTimeout(500);
const assisted = await page.locator(".iw-main .mx-source .cm-content").first().innerText();
await page.getByLabel("Text checked against the source").check();
const course = await page.evaluate(() => {
  const s = window.__maree.state();
  const plan = Object.values(s.imports)[0].plans[0];
  return { course: s.courses.find((c) => c.id === plan.courseId)?.code, lectures: plan.lectureMap.map((m) => `${m.ref}:${m.lectureId ? "existing" : m.create ? "new" : "-"}`) };
});
check("6. Review and correct extracted problems", assisted.includes("\\(x_{n+1} =") && course.course === "MATH 147", `course ${course.course}; lectures ${course.lectures.join(" ")}`);
await shot(page, "03-import-review");
await page.getByRole("button", { name: /^Import \d+ problem/ }).click();
await page.waitForSelector(".iw", { state: "detached", timeout: 30000 });
await page.waitForTimeout(800);

const assigned = await page.evaluate(() => {
  const s = window.__maree.state();
  const p5 = s.problems.find((p) => p.sourceNumber === "5");
  return {
    lectures: p5.lectureIds.map((id) => s.index.lectures.get(id)?.number),
    topics: p5.topicIds.map((id) => s.index.topics.get(id)?.name),
    total: s.problems.length,
  };
});
check("7. Assign problems to lectures and topics", assigned.lectures.includes("9") && assigned.topics.includes("MCT"), `Problem 5 → Lecture ${assigned.lectures.join(",")}; ${assigned.topics.join(", ")}`);

await page.locator(".sb-item", { hasText: "All Problems" }).click();
await page.locator(".lp-row", { hasText: "Define" }).first().dblclick();
await page.waitForTimeout(1000);
const katexCount = await page.locator(".pv-statement .katex").count();
const katexErrors = await page.locator(".pv-statement .katex-error").count();
// KaTeX lays formulas out with inline styles; if a Content Security Policy blocked them,
// the formulas would still exist but scripts would fall below the baseline.
const layout = await page.evaluate(() => {
  const strut = document.querySelector(".pv-statement .katex .strut");
  const scroller = document.querySelector(".cm-scroller");
  return {
    inlineStylesApplied: !!strut && strut.style.height !== "",
    editorFont: scroller ? getComputedStyle(scroller).fontFamily : "",
  };
});
check("8. Open a problem with correctly rendered LaTeX", katexCount > 3 && katexErrors === 0 && layout.inlineStylesApplied, `${katexCount} formulas, ${katexErrors} errors, KaTeX layout ${layout.inlineStylesApplied ? "applied" : "BLOCKED"}`);
check("   editor uses its monospace font", layout.editorFont.includes("JetBrains"), layout.editorFont);

const proof = "By induction \\(x_n \\le x_{n+1} < 2\\). By the MCT the limit \\(L\\) exists and \\(L = \\sqrt{2+L}\\), hence \\(L = 2\\).";
await page.locator(".pv-work .mx-source .cm-content").click();
await page.keyboard.type(proof);
await page.waitForTimeout(1500);
const rendered = await page.locator(".pv-work .mx-preview .katex").count();
check("9. Write and save a mathematical proof", rendered >= 4, `${rendered} formulas rendered in the preview`);

await page.locator(".pv-meta .status-seg button", { hasText: "Needs Review" }).click();
await page.waitForTimeout(800);
await shot(page, "04-proof-needs-review");
check("10. Mark the problem as Needs Review", (await page.locator(".pv-meta .status-seg button.on").innerText()).includes("Needs Review"));

await page.locator(".sb-item", { hasText: "All Problems" }).click();
await page.locator('button[title="Filter"]').click();
await page.locator(".facet-toggle", { hasText: "Needs Review" }).click();
await page.locator(".facet-toggle", { hasText: "MCT" }).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const filtered = await page.locator(".lp-row").allInnerTexts();
check("11. Find it with combined topic + status filters", filtered.length === 1 && filtered[0].includes("Define"), `${filtered.length} match`);
await shot(page, "05-filtered");

// Quit through the window's own close button (flushes pending edits).
await page.locator(".wc-btn.close").click();
const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 15000))]);
check("12. Restart the application (clean exit)", code !== "timeout", `exit code ${code}`);
await browser.close().catch(() => undefined);

// ---------------------------------------------------------------- session 2
({ proc, browser, page, exited } = await launch());
await page.waitForTimeout(800);
const after = await page.evaluate(async () => {
  const s = window.__maree.state();
  const p5 = s.problems.find((p) => p.sourceNumber === "5");
  const full = await window.__maree.getProblem(p5.id);
  return {
    problems: s.problems.length,
    courses: s.courses.map((c) => c.code),
    lectures: s.lectures.length,
    topics: s.topics.length,
    sources: s.sources.map((x) => x.fileName),
    status: full.status,
    solution: full.solution,
    page: full.sourcePage,
    number: full.sourceNumber,
    history: full.history.map((h) => h.kind),
  };
});
if (after.solution !== proof) {
  console.log("expected:", JSON.stringify(proof), proof.length);
  console.log("stored:  ", JSON.stringify(after.solution), after.solution.length);
  for (let i = 0; i < proof.length; i++) {
    if (proof.charCodeAt(i) !== after.solution.charCodeAt(i)) {
      console.log(`first difference at ${i}: expected U+${proof.charCodeAt(i).toString(16)}, stored U+${after.solution.charCodeAt(i).toString(16)}`);
      break;
    }
  }
}
const intact =
  after.problems === 10 &&
  after.courses.includes("MATH 147") &&
  after.lectures === 6 &&
  after.topics === 3 &&
  after.status === "needs_review" &&
  after.solution === proof &&
  after.sources.includes("MATH147_Proof_Practice_Lectures_7-12.pdf");
check(
  "13. All data intact after restart",
  intact,
  `${after.problems} problems, ${after.lectures} lectures, ${after.topics} topics, status ${after.status}, proof ${after.solution === proof ? "identical" : `DIFFERENT: ${JSON.stringify(after.solution)}`}, sources ${JSON.stringify(after.sources)}`,
);
await shot(page, "06-after-restart");

const jsonPath = join(runDir, "export", "library.json");
const zipPath = join(runDir, "export", "backup.zip");
const mdPath = join(runDir, "export", "problem5.md");
mkdirSync(dirname(jsonPath), { recursive: true });
await page.evaluate((p) => window.__maree.exportLibraryTo(p), jsonPath);
await page.evaluate((p) => window.__maree.backupTo(p), zipPath);
const p5id = await page.evaluate(() => window.__maree.state().problems.find((p) => p.sourceNumber === "5").id);
await page.evaluate(([p, id]) => window.__maree.exportMarkdownTo(p, [id]), [mdPath, p5id]);
const lib = JSON.parse(readFileSync(jsonPath, "utf8"));
const zip = await JSZip.loadAsync(readFileSync(zipPath));
const zipFiles = Object.keys(zip.files);
const md = readFileSync(mdPath, "utf8");
check(
  "14. Export the library",
  lib.format === "maree-library" && lib.problems.length === 10 && zipFiles.includes("library.json") && zipFiles.includes("maree.sqlite") && zipFiles.some((f) => f.startsWith("files/sources/")) && md.includes(proof),
  `JSON ${statSync(jsonPath).size} B, backup ${statSync(zipPath).size} B (${zipFiles.join(", ")}), Markdown ${md.includes(proof) ? "keeps the proof verbatim" : "MISSING proof"}`,
);

await page.locator(".wc-btn.close").click();
await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
await browser.close().catch(() => undefined);
try {
  proc.kill();
} catch {
  /* already exited */
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${shots}`);
if (!failed && !process.env.KEEP_E2E_DATA) rmSync(dataDir, { recursive: true, force: true });
