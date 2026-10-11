// Builds the Android app (android/) into src-tauri/phone/maree-phone.apk with the plain
// Android SDK tools — no Gradle. The desktop app embeds the APK and offers it for download
// on the phone page, so run this before `tauri build` when android/ or the phone page change.
//
//   npm run build:apk
//
// Needs ANDROID_HOME (build-tools + a platform) and a JDK. The signing key is kept outside
// the repository in ~/.maree-android (created on first use); keep it, or later builds can
// no longer be installed over earlier ones.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
// --debug: a debuggable build (WebView inspectable over adb) for automated tests only.
const debug = process.argv.includes("--debug");
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), "AppData", "Local", "Android", "Sdk");
const newest = (dir) => fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const buildTools = path.join(sdk, "build-tools", newest(path.join(sdk, "build-tools")));
const platform = newest(path.join(sdk, "platforms"));
const androidJar = path.join(sdk, "platforms", platform, "android.jar");
const exe = (name) => {
  for (const ext of [".exe", ".bat", ""]) {
    const p = path.join(buildTools, name + ext);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`${name} not found in ${buildTools}`);
};
const run = (cmd, args) =>
  cmd.endsWith(".bat")
    ? execFileSync("cmd.exe", ["/d", "/c", cmd, ...args], { stdio: ["ignore", "inherit", "inherit"] })
    : execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const versionName = pkg.version;
const versionCode = String(Math.floor(Date.now() / 60000) - 29_000_000); // increases with every build

const out = path.join(root, "android", "build");
fs.rmSync(out, { recursive: true, force: true });
for (const d of ["res", "gen", "classes", "dex", "assets"]) fs.mkdirSync(path.join(out, d), { recursive: true });

// 1. Assets: the same phone page the desktop serves, and the icon.
fs.copyFileSync(path.join(root, "src-tauri", "phone", "index.html"), path.join(out, "assets", "index.html"));
fs.copyFileSync(path.join(root, "src-tauri", "icons", "128x128@2x.png"), path.join(out, "assets", "icon.png"));

// 2. Resources and manifest.
const resZip = path.join(out, "res.zip");
run(exe("aapt2"), ["compile", "--dir", path.join(root, "android", "res"), "-o", resZip]);
const unsigned = path.join(out, "unsigned.apk");
run(exe("aapt2"), [
  "link", "-o", unsigned, "-I", androidJar,
  "--manifest", path.join(root, "android", "AndroidManifest.xml"),
  "--java", path.join(out, "gen"),
  "-A", path.join(out, "assets"),
  "--min-sdk-version", "24", "--target-sdk-version", "34",
  "--version-code", versionCode, "--version-name", versionName,
  ...(debug ? ["--debug-mode"] : []),
  resZip,
]);

// 3. Java → classes → dex.
const sources = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".java")) sources.push(p);
  }
};
walk(path.join(root, "android", "src"));
walk(path.join(out, "gen"));
run("javac", ["-encoding", "UTF-8", "--release", "8", "-nowarn", "-Xlint:-options", "-classpath", androidJar, "-d", path.join(out, "classes"), ...sources]);
const classes = [];
const walkClasses = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkClasses(p);
    else if (p.endsWith(".class")) classes.push(p);
  }
};
walkClasses(path.join(out, "classes"));
run(exe("d8"), ["--release", "--min-api", "24", "--lib", androidJar, "--output", path.join(out, "dex"), ...classes]);

// 4. Add classes.dex, align, sign.
run("jar", ["uf", unsigned, "-C", path.join(out, "dex"), "classes.dex"]);
const aligned = path.join(out, "aligned.apk");
run(exe("zipalign"), ["-p", "-f", "4", unsigned, aligned]);

const keyDir = path.join(os.homedir(), ".maree-android");
const keystore = path.join(keyDir, "maree.keystore");
const passFile = path.join(keyDir, "password.txt");
if (!fs.existsSync(keystore)) {
  fs.mkdirSync(keyDir, { recursive: true });
  const pass = crypto.randomBytes(18).toString("hex");
  fs.writeFileSync(passFile, pass);
  run("keytool", ["-genkeypair", "-keystore", keystore, "-alias", "maree", "-keyalg", "RSA", "-keysize", "3072", "-validity", "20000",
    "-dname", "CN=Maree, O=Maree", "-storepass", pass, "-keypass", pass]);
  console.log(`Created signing key ${keystore}`);
}
const pass = fs.readFileSync(passFile, "utf8").trim();
const apk = debug ? path.join(root, "e2e-data", "maree-phone-debug.apk") : path.join(root, "src-tauri", "phone", "maree-phone.apk");
run(exe("apksigner"), ["sign", "--ks", keystore, "--ks-key-alias", "maree", "--ks-pass", `pass:${pass}`, "--key-pass", `pass:${pass}`, "--out", apk, aligned]);
run(exe("apksigner"), ["verify", apk]);
fs.rmSync(apk + ".idsig", { force: true });
console.log(`\n${apk} (${(fs.statSync(apk).size / 1024).toFixed(0)} KB, version ${versionName} / ${versionCode}, ${platform})`);
