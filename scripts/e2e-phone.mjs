// End-to-end check of the phone link, the photo inbox and "Copy for ChatGPT" against the
// built maree.exe. A phone is emulated with headless Edge; the phone server listens on
// 127.0.0.1 only because MAREE_E2E=1. Note: the last steps overwrite the system clipboard.
//
//   npm run e2e:phone
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = path.join(root, "e2e-data", `phone-${Date.now()}`);
const dataDir = path.join(run, "library");
const out = path.join(run, "screenshots");
const photo = path.join(root, "tests", "fixtures", "phone-page.jpg");
const exe = path.join(root, "src-tauri", "target", "release", "maree.exe");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(out, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

const port = 9336;
const proc = spawn(exe, [], {
  env: {
    ...process.env,
    MAREE_DATA_DIR: dataDir,
    MAREE_E2E: "1",
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: path.join(run, "webview"),
  },
  stdio: "ignore",
});
let browser;
for (let i = 0; i < 80 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch {}
}
if (!browser) throw new Error("Could not connect to the WebView2 debugging port");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.on("pageerror", (e) => check("no page errors", false, String(e)));
await page.waitForSelector(".app");
await page.waitForTimeout(800);
const S = () =>
  page.evaluate(() => {
    const s = window.__maree.state();
    return { inbox: s.inbox.length, problems: s.problems.map((p) => ({ id: p.id, title: p.title })), phone: s.phone, toasts: s.toasts.map((t) => t.message) };
  });
const clipboardFiles = () =>
  execFileSync("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::GetFileDropList() -join '|'"], { encoding: "utf8" })
    .trim()
    .split("|")
    .filter(Boolean);

// 1. Turn the phone link on.
await page.getByText("Tools", { exact: true }).click();
await page.getByText("Connect Phone…").click();
await page.getByRole("button", { name: "Turn On Phone Link" }).click();
await page.waitForSelector(".qr");
await shot(page, "1-phone-dialog");
const url = (await S()).phone.status?.urls[0];
check("1. Phone link starts and shows a QR code", !!url, url?.replace(/k=.*/, "k=…"));
await page.getByRole("button", { name: "Done" }).click();

// 2. The phone page (Traditional Chinese phone) connects and sends a photo.
const edge = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await edge.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-TW" });
const phone = await ctx.newPage();
await phone.goto(url);
await phone.waitForFunction(() => document.getElementById("conn").classList.contains("on"));
check("2. Phone page connects", true, (await phone.textContent("#conn")).trim());
await phone.setInputFiles("#library", photo);
await phone.waitForSelector("li .state.ok", { timeout: 20000 });
await shot(phone, "2-phone-sent");
const bad = await (await fetch(url.replace(/\/\?k=.*/, "/api/info"))).status;
check("3. API refuses requests without the pairing key", bad === 401, `HTTP ${bad}`);

// 3. The desktop inbox receives it; crop two problems and one answer.
await page.waitForFunction(() => window.__maree.state().inbox.length === 1, null, { timeout: 10000 });
check("4. Photo arrives in the inbox", true);
await page.getByText("Photo Inbox", { exact: true }).first().click();
await page.waitForSelector(".inbox-stage img");
await page.waitForTimeout(500);
const drag = async (x1, y1, x2, y2) => {
  await page.evaluate(() => document.querySelector(".inbox-scroll").scrollTo(0, 0));
  const box = await (await page.$(".inbox-stage")).boundingBox();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((x1 + x2) / 2), box.y + box.height * ((y1 + y2) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 4 });
  await page.mouse.up();
};
await drag(0.04, 0.05, 0.72, 0.16);
await drag(0.04, 0.245, 0.78, 0.335);
await drag(0.04, 0.47, 0.8, 0.66);
const pieces = page.locator(".inbox-piece");
check("5. Three regions drawn", (await pieces.count()) === 3);
await pieces.nth(0).locator("input").fill("Limit with a 1/n bound");
await pieces.nth(2).getByRole("radio", { name: "Answer" }).click();
await pieces.nth(2).locator("select").selectOption({ label: "Problem 1 (new, from this photo)" });
await shot(page, "3-inbox-regions");
await page.locator(".inbox-commit").click();
await page.waitForFunction(() => window.__maree.state().problems.length === 2, null, { timeout: 15000 });
const st = await S();
check("6. Two problems created, inbox emptied", st.problems.length === 2 && st.inbox === 0, st.problems.map((p) => p.title).join(" / "));
const target = st.problems.find((p) => p.title === "Limit with a 1/n bound");
const p = await page.evaluate((id) => window.__maree.getProblem(id), target.id);
check("7. Answer crop is referenced in My Solution", /^!\[My answer\]\(attachment:photo-.*-3\.jpg\)$/.test(p.solution) && p.attachments.length === 2, p.solution);

// 4. Everything from the photo is gathered in "To ChatGPT"; copying it keeps each
//    problem next to its answer.
const tray = await page.evaluate(() => window.__maree.state().settings.chatTray.length);
await page.getByText("To ChatGPT", { exact: true }).first().click();
await page.waitForSelector(".tray-item");
await page.waitForTimeout(800);
await shot(page, "4-tray");
await page.locator(".tray-head .btn-primary").click();
await page.waitForTimeout(2500);
const trayFiles = clipboardFiles().map((f) => path.basename(f));
check(
  "8. To ChatGPT gathers the photo's problems and copies them in order",
  tray === 2 && trayFiles.length === 3 && /^01 Q1 Limit with a 1n bound - problem\.jpg$/.test(trayFiles[0]) && /^02 Q1 .* - my answer\.jpg$/.test(trayFiles[1]) && /^03 Q2 .* - problem\.jpg$/.test(trayFiles[2]),
  trayFiles.join(", "),
);

// 5. Copy for ChatGPT from one problem: the problem photo and the answer photo as two files.
await page.evaluate((id) => window.__maree.openProblem(id), target.id);
await page.waitForSelector(".pv-statement img");
await page.waitForTimeout(600);
await shot(page, "5-problem");
await page.keyboard.press("Control+Shift+C");
await page.waitForTimeout(2500);
let files = clipboardFiles();
check("9. Copy for ChatGPT puts problem and answer photos on the clipboard", files.length === 2 && /1 problem\.jpg$/.test(files[0]) && /2 my answer\.jpg$/.test(files[1]), files.map((f) => path.basename(f)).join(", "));

// 6. A typed problem is typeset into images.
const typed = await page.evaluate(
  (input) => window.__maree.createProblem(input),
  { title: "Uniqueness of limits", statement: String.raw`Let \((a_n)\) converge to \(L\) and \(M\). Prove \(L = M\).`, solution: String.raw`Take \(\varepsilon = |L-M|/2\).` },
);
await page.evaluate((id) => window.__maree.openProblem(id), typed);
await page.waitForTimeout(600);
await page.keyboard.press("Control+Shift+C");
await page.waitForTimeout(3000);
files = clipboardFiles();
const sizes = files.map((f) => fs.statSync(f).size);
for (const f of files) fs.copyFileSync(f, path.join(out, `clip-${path.basename(f)}`));
check("10. Typed text is rendered to images", files.length === 2 && files.every((f) => f.endsWith(".png")) && sizes.every((s) => s > 5000), sizes.join(" B, ") + " B");

// 7. Handwriting: write an answer with the mouse, reopen it, erase a stroke, save again.
await page.keyboard.press("Control+Shift+H");
await page.waitForSelector(".ink-canvas");
await page.waitForTimeout(400);
const scribble = async (points) => {
  const b = await (await page.$(".ink-canvas")).boundingBox();
  const at = ([x, y]) => [b.x + (b.width * x) / 1000, b.y + (b.width * y) / 1000];
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps: 6 });
  await page.mouse.up();
};
// "ε > 0" in three strokes, roughly.
await scribble([[120, 140], [80, 120], [70, 150], [110, 160], [70, 175], [80, 205], [125, 190]]);
await scribble([[170, 140], [210, 165], [170, 190]]);
await scribble([[260, 140], [240, 170], [260, 200], [285, 170], [260, 140]]);
await shot(page, "6-handwriting");
await page.getByRole("button", { name: "Add to My Solution" }).click();
await page.waitForFunction((id) => window.__maree.state().problemCache[id]?.solution.includes("handwriting-"), typed, { timeout: 10000 });
let hp = await page.evaluate((id) => window.__maree.getProblem(id), typed);
const firstInk = hp.attachments.find((a) => a.fileName.startsWith("handwriting-"));
check("11. Handwriting is saved into My Solution", !!firstInk && hp.solution.endsWith(`![My answer](attachment:${firstInk.fileName})`), hp.solution.split("\n").pop());

await page.waitForSelector(`img.mx-attachment[data-attachment="${firstInk.fileName}"]`);
await page.locator(`img.mx-attachment[data-attachment="${firstInk.fileName}"]`).first().dblclick();
await page.waitForSelector(".ink-canvas");
await page.waitForTimeout(800);
const reopened = await page.locator(".ink-dialog .btn-primary").isEnabled();
await page.getByTitle("Eraser (E)").click();
await scribble([[255, 168], [262, 172]]);
await shot(page, "7-handwriting-edit");
await page.getByRole("button", { name: "Save Changes" }).click();
await page.waitForFunction(
  ([id, old]) => {
    const p = window.__maree.state().problemCache[id];
    return p && !p.solution.includes(old) && p.solution.includes("handwriting-");
  },
  [typed, firstInk.fileName],
  { timeout: 10000 },
);
hp = await page.evaluate((id) => window.__maree.getProblem(id), typed);
const inks = hp.attachments.filter((a) => a.fileName.startsWith("handwriting-"));
check("12. Double-click reopens the strokes; the edit replaces the old image", reopened && inks.length === 1 && inks[0].fileName !== firstInk.fileName, inks.map((a) => a.fileName).join(", "));

await page.keyboard.press("Control+Shift+C");
await page.waitForTimeout(3000);
files = clipboardFiles().map((f) => path.basename(f));
check("13. Copy for ChatGPT includes the handwritten answer", files.length === 3 && /^1 problem\.png$/.test(files[0]) && /^2 my answer\.png$/.test(files[1]) && /^3 my answer 2\.png$/.test(files[2]), files.join(", "));

// 8. One document at a time (the default): opening problems replaces the one shown, Back
//    returns, and ‹ › follow the list. Then, with tabs, at most five stay open.
const extra = [];
for (let i = 1; i <= 7; i++) extra.push(await page.evaluate((n) => window.__maree.createProblem({ title: `Tab test ${n}` }), i));
for (const id of extra) await page.evaluate((x) => window.__maree.openProblem(x), id);
await page.waitForTimeout(500);
const front = () =>
  page.evaluate(() => {
    const s = window.__maree.state();
    const g = s.groups[s.activeGroup];
    return { tabs: s.groups.map((x) => x.tabs.length), id: g.tabs.find((t) => t.id === g.activeId)?.problemId };
  });
const one = await front();
await shot(page, "8-single");
await page.locator(".docbar .icon-btn").first().click(); // Back
await page.waitForTimeout(300);
const back = await front();
await page.getByText("All Problems", { exact: true }).first().click();
await page.waitForTimeout(300);
const list = await page.evaluate(() => [...document.querySelectorAll(".listpane [data-id]")].map((e) => e.getAttribute("data-id")));
await page.evaluate((x) => window.__maree.openProblem(x), list[1]);
await page.keyboard.press("Control+PageDown");
await page.waitForTimeout(400);
const stepped = await front();
const pos = await page.textContent(".docbar-pos");
check(
  "14. One problem at a time: Back and next-in-list work",
  one.tabs.every((n) => n === 1) && one.id === extra[6] && back.id === extra[5] && stepped.id === list[2],
  `tabs ${one.tabs.join(",")} · back ok ${back.id === extra[5]} · next ${pos}`,
);

await page.evaluate(() => window.__maree.setSetting("documentMode", "tabs"));
for (const id of extra) await page.evaluate((x) => window.__maree.openProblem(x), id);
await page.waitForTimeout(500);
const tabbed = await front();
check("15. In tab mode at most five tabs stay open", tabbed.tabs.every((n) => n <= 5) && tabbed.id === extra[6], `tabs per area: ${tabbed.tabs.join(", ")}`);

await edge.close();
proc.kill();
console.log(`\n${15 - failed}/15 checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
