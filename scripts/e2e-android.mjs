// End-to-end check of the Android app against the built maree.exe, on a running emulator
// (started e.g. with `emulator -avd <name> -read-only -no-window`). The emulator reaches the
// computer's loopback interface as 10.0.2.2, where the test instance of Marée listens.
//
//   node scripts/build-apk.mjs --debug && node scripts/e2e-android.mjs
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), "AppData", "Local", "Android", "Sdk");
const adbExe = path.join(sdk, "platform-tools", "adb.exe");
const adb = (...args) => execFileSync(adbExe, args, { encoding: "utf8" });
const apk = path.join(root, "e2e-data", "maree-phone-debug.apk");
const run = path.join(root, "e2e-data", `android-${Date.now()}`);
const out = path.join(run, "screenshots");
fs.mkdirSync(path.join(run, "library"), { recursive: true });
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let total = 0;
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const screencap = (name) => fs.writeFileSync(path.join(out, `${name}.png`), execFileSync(adbExe, ["exec-out", "screencap", "-p"]));

// Desktop under test.
const proc = spawn(path.join(root, "src-tauri", "target", "release", "maree.exe"), [], {
  env: {
    ...process.env,
    MAREE_DATA_DIR: path.join(run, "library"),
    MAREE_E2E: "1",
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9337",
    WEBVIEW2_USER_DATA_FOLDER: path.join(run, "webview"),
  },
  stdio: "ignore",
});
let browser;
for (let i = 0; i < 80 && !browser; i++) {
  await sleep(250);
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9337");
  } catch {}
}
const desk = browser.contexts().flatMap((c) => c.pages())[0];
await desk.waitForSelector(".app");
await desk.waitForTimeout(800);
await desk.getByText("Tools", { exact: true }).click();
await desk.getByText("Connect Phone…").click();
await desk.getByRole("button", { name: "Turn On Phone Link" }).click();
await desk.waitForSelector(".qr");
await desk.getByRole("button", { name: "Done" }).click();
const { key, port } = await desk.evaluate(() => {
  const s = window.__maree.state();
  return { key: s.settings.phoneKey, port: s.phone.status.port };
});

// 1. Install and open, not yet paired.
try {
  adb("uninstall", "com.maree.phone");
} catch {
  /* not installed yet */
}
check("1. APK installs", /Success/.test(adb("install", "-r", apk)));
adb("shell", "am", "start", "-W", "-n", "com.maree.phone/.MainActivity");
await sleep(2500);
screencap("1-unpaired");

// 2. Pair through the link the phone page offers — with a wrong port, so the app has to
//    find the computer again by UDP discovery.
adb("shell", `am start -W -a android.intent.action.VIEW -d 'maree://pair?h=10.0.2.2:${port + 7}&k=${key}' com.maree.phone`);
await sleep(1500);

// Drive the bundled page over the WebView DevTools socket.
const sockets = adb("shell", "cat", "/proc/net/unix").match(/webview_devtools_remote_\d+/g) ?? [];
adb("forward", "tcp:9341", `localabstract:${sockets[sockets.length - 1]}`);
const targets = await (await fetch("http://127.0.0.1:9341/json")).json();
const target = targets.find((t) => t.url.startsWith("http://app.maree/"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0;
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++msgId;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      resolve(m.result?.result?.value);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
  });
const waitFor = async (expression, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
  return false;
};

const connected = await waitFor(`document.getElementById("conn").classList.contains("on")`);
const host = await evaluate(`MareeAndroid.host()`);
check("2. Paired, and the computer found again by discovery", connected && host === `10.0.2.2:${port}`, `host ${host}`);
screencap("2-paired");

// 3. Send a photo through the app's own networking.
const b64 = fs.readFileSync(path.join(root, "tests", "fixtures", "phone-page.jpg")).toString("base64");
await evaluate(`(async () => {
  const bin = atob("${b64}");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  setMode("answer");
  await addFiles([new File([bytes], "IMG_2041.jpg", { type: "image/jpeg" })]);
  return true;
})()`);
const sent = await waitFor(`entries.length > 0 && entries.every((e) => e.state === "done")`, 30000);
check("3. Photo uploaded from the app", sent, await evaluate(`entries.map((e) => e.state).join(",")`));
await sleep(500);
screencap("3-sent");
await desk.waitForFunction(() => window.__maree.state().inbox.length === 1, null, { timeout: 10000 }).catch(() => {});
const inbox = await desk.evaluate(() => window.__maree.state().inbox.map((i) => `${i.origin}/${i.kind}`));
check("4. It arrives in the desktop inbox as an answer", inbox.join() === "phone/answer", inbox.join());

// 4. The camera button opens the camera app; coming back leaves the app intact.
await evaluate(`document.getElementById("shoot").click(), true`);
await sleep(3000);
const top = adb("shell", "dumpsys", "activity", "activities").match(/topResumedActivity[^\n]*/)?.[0] ?? "";
screencap("4-camera");
check("5. Take photo opens the camera", /camera/i.test(top) && !/com\.maree\.phone/.test(top), top.trim());
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(1500);
const back = adb("shell", "dumpsys", "activity", "activities").match(/topResumedActivity[^\n]*/)?.[0] ?? "";
check("6. Back from the camera returns to Marée", /com\.maree\.phone/.test(back), back.trim());

ws.close();
proc.kill();
console.log(`\n${total - failed}/${total} checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
