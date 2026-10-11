// Visual QA helper: drives the browser build of Marée in headless Microsoft Edge
// (via playwright-core, no browser download needed) and saves screenshots.
//
//   node scripts/ui-shots.mjs <outDir> [scenario] [theme]
//
// Requires the dev server (npm run dev) on http://localhost:1420.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "screenshots";
const scenario = process.argv[3] ?? "tour";
const theme = process.argv[4] ?? "maree";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("shot", name);
};

await page.addInitScript((th) => localStorage.setItem("maree-theme", th), theme);
await page.goto("http://localhost:1420/");
await page.waitForSelector(".app", { timeout: 20000 });
await page.waitForTimeout(600);

if (theme !== "maree") {
  await page.locator(".menubar-item", { hasText: "View" }).click();
  await page.locator(".menu-item", { hasText: "Theme" }).hover();
  const names = { "maree-dark": "Dark Academic", waterloo: "Waterloo Math Pink", "black-gold": "Black & Gold" };
  await page.locator(".menu-item", { hasText: names[theme] }).click();
  await page.waitForTimeout(300);
}

if (scenario === "tour") {
  await shot("01-welcome");
  await page.getByRole("button", { name: "Load a small sample library" }).click();
  await page.waitForTimeout(800);
  await shot("02-sample-course");
  // Open the multi-part problem.
  await page.locator(".lp-row", { hasText: "Newton" }).first().dblclick();
  await page.waitForTimeout(600);
  await shot("03-problem-parts");
  await page.locator(".lp-row", { hasText: "A limit from the definition" }).first().dblclick();
  await page.waitForTimeout(600);
  await shot("04-problem-needs-review");
  await page.locator(".pv-work .worktabs button", { hasText: "Attempts" }).click();
  await shot("05-attempts");
  await page.locator(".sb-item", { hasText: "Review Queue" }).click();
  await shot("06-review-queue");
  await page.keyboard.press("Control+Shift+G");
  await page.waitForTimeout(400);
  await shot("07-progress");
  await page.keyboard.press("Control+K");
  await page.keyboard.type("cauchy");
  await shot("08-palette");
  await page.keyboard.press("Escape");
  await page.locator(".sb-item", { hasText: "All Problems" }).click();
  await page.locator('button[title="Card view"]').click();
  await page.waitForTimeout(500);
  await shot("09-cards");
  await page.locator('button[title="Table view"]').click();
  await page.keyboard.press("F1");
  await page.waitForTimeout(400);
  await shot("10-help");
}

if (scenario === "docs") {
  await page.getByRole("button", { name: "Load a small sample library" }).click();
  await page.waitForTimeout(800);
  await page.locator(".tab", { hasText: "Welcome" }).locator(".tab-close").click();
  await page.locator(".lp-row", { hasText: "Newton" }).first().dblclick();
  await page.waitForTimeout(5600);
  await shot("problem");
  await page.locator(".lp-row", { hasText: "A limit from the definition" }).first().dblclick();
  await page.waitForTimeout(800);
  await page.locator(".pv").evaluate((el) => (el.scrollTop = 420));
  await shot("editor");
  await page.locator(".sb-item", { hasText: "Review Queue" }).click();
  await page.keyboard.press("Control+Shift+G");
  await page.waitForTimeout(600);
  await shot("progress");
}

if (scenario === "acceptance") {
  const fixture = new URL("../tests/fixtures/MATH147_Proof_Practice_Lectures_7-12.pdf", import.meta.url);
  const pdfPath = decodeURIComponent(fixture.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  // 1–4: course, lectures, topics through the onboarding steps
  await page.getByLabel("Course code").fill("MATH 147");
  await page.getByLabel("Course title").fill("Advanced Calculus");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("First lecture").fill("7");
  await page.getByLabel("Last lecture").fill("12");
  await page.locator(".ob-step", { hasText: "Add lectures" }).getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("Topics, separated by commas").fill("MCT, Subsequences, Cauchy Sequences");
  await page.locator(".ob-step", { hasText: "Add topics" }).getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(500);
  await shot("a1-onboarding-done");
  // 5: import the PDF
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files…" }).click();
  await (await chooser).setFiles(pdfPath);
  await page.waitForSelector(".iw-head", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("a2-import-wizard");
  // 6: review and correct Problem 5 with the assisted conversion, then mark all as checked
  await page.locator(".iw-cand-label", { hasText: "Problem 5" }).click();
  await page.waitForTimeout(800);
  await shot("a3-import-candidate");
  await page.getByLabel(/Assisted LaTeX conversion/).check();
  await page.waitForTimeout(600);
  await shot("a4-import-assisted");
  await page.getByLabel("Text checked against the source").check();
  await page.getByRole("button", { name: /^Import \d+ problem/ }).click();
  await page.waitForSelector(".iw", { state: "detached", timeout: 30000 });
  await page.waitForTimeout(600);
  await shot("a5-import-done");
  // 7–8: open Problem 5, which the classifier assigned to Lecture 9 and MCT
  await page.locator(".lp-row", { hasText: "Define" }).first().dblclick();
  await page.waitForTimeout(800);
  await shot("a6-problem5");
  // 9: write a proof
  const editor = page.locator(".pv-work .mx-source .cm-content");
  await editor.click();
  await page.keyboard.type("By induction, \\(x_n \\le x_{n+1} < 2\\) for all \\(n\\). By the MCT the limit \\(L\\) exists and satisfies \\(L = \\sqrt{2+L}\\), so \\(L = 2\\).");
  await page.waitForTimeout(1200);
  // 10: Needs Review
  await page.locator(".pv-meta .status-seg button", { hasText: "Needs Review" }).click();
  await page.waitForTimeout(600);
  await shot("a7-proof-written");
  // 11: combined filter: topic MCT + status Needs Review
  await page.locator(".sb-item", { hasText: "All Problems" }).click();
  await page.locator('button[title="Filter"]').click();
  await page.locator(".facet-toggle", { hasText: "Needs Review" }).click();
  await page.locator(".facet-toggle", { hasText: "MCT" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await shot("a8-filtered");
  const rows = await page.locator(".lp-row").count();
  console.log("filtered rows:", rows);
  // 12–13: "restart" — reload the page and check the proof is still there
  await page.reload();
  await page.waitForSelector(".app");
  await page.waitForTimeout(1200);
  await page.locator(".sb-item", { hasText: "All Problems" }).click();
  await page.locator(".lp-row", { hasText: "Define" }).first().dblclick();
  await page.waitForTimeout(800);
  const text = await page.locator(".pv-work .mx-preview").innerText();
  console.log("persisted proof:", text.includes("By induction") ? "yes" : "NO");
  await shot("a9-after-reload");
  // 14: export the library
  const download = page.waitForEvent("download");
  await page.locator(".menubar-item", { hasText: "File" }).click();
  await page.locator(".menu-item", { hasText: "Export Library as JSON" }).click();
  const d = await download;
  await d.saveAs(join(out, "library-export.json"));
  console.log("exported:", d.suggestedFilename());
}

console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
