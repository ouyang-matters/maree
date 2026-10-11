// Publishes a GitHub release that both apps update from:
//   Maree_<v>_x64-setup.exe (+ .sig) and latest.json — read by the desktop updater
//   maree-phone.apk and android.json                   — read by the Android app
//   Maree_<v>_x64_en-US.msi                             — for manual installs
//
//   1. bump "version" in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml
//   2. commit, then:  npm run release -- --notes "What changed"
//
// Signing keys never enter the repository: the update key is read from ~/.maree-updater,
// the Android key from ~/.maree-android (see scripts/build-apk.mjs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
// npm and npx are .cmd scripts on Windows and need a shell; nothing passed to them contains spaces.
const step = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" && (cmd === "npm" || cmd === "npx"), env: { ...process.env, ...env } });
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const cargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8").match(/^version = "([^"]+)"/m)?.[1];
if (conf.version !== version || cargo !== version) throw new Error(`Version mismatch: package.json ${version}, tauri.conf.json ${conf.version}, Cargo.toml ${cargo}`);
const tag = `v${version}`;
const notes = arg("--notes") ?? `Marée ${version}`;
if (sh("git", ["status", "--porcelain"]).trim()) throw new Error("Commit or stash your changes first.");
const repo = JSON.parse(sh("gh", ["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
if (sh("git", ["tag", "--list", tag]).trim()) throw new Error(`${tag} already exists; bump the version first.`);

const keyDir = path.join(os.homedir(), ".maree-updater");
const signing = {
  TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(path.join(keyDir, "maree.key"), "utf8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: fs.readFileSync(path.join(keyDir, "password.txt"), "utf8").trim(),
};

console.log(`Releasing ${tag} to ${repo}\n`);
step("npm", ["test"]);
step("npm", ["run", "typecheck"]);
step("npm", ["run", "build:apk"]);
step("npx", ["tauri", "build"], signing);

// Collect assets under ASCII names (GitHub mangles "é" in file names).
const bundle = path.join(root, "src-tauri", "target", "release", "bundle");
const out = path.join(root, "src-tauri", "target", "release", "github");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const setup = path.join(bundle, "nsis", `Marée_${version}_x64-setup.exe`);
const msi = path.join(bundle, "msi", `Marée_${version}_x64_en-US.msi`);
const setupName = `Maree_${version}_x64-setup.exe`;
fs.copyFileSync(setup, path.join(out, setupName));
fs.copyFileSync(`${setup}.sig`, path.join(out, `${setupName}.sig`));
fs.copyFileSync(msi, path.join(out, `Maree_${version}_x64_en-US.msi`));
fs.copyFileSync(path.join(root, "src-tauri", "phone", "maree-phone.apk"), path.join(out, "maree-phone.apk"));
const download = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
fs.writeFileSync(
  path.join(out, "latest.json"),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: { "windows-x86_64": { signature: fs.readFileSync(`${setup}.sig`, "utf8").trim(), url: download(setupName) } },
    },
    null,
    2,
  ),
);
const apkMeta = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "phone", "maree-phone.json"), "utf8"));
fs.writeFileSync(path.join(out, "android.json"), JSON.stringify({ ...apkMeta, url: download("maree-phone.apk") }, null, 2));

// The rebuilt APK is part of the source (the desktop app embeds it): commit it with the tag.
if (sh("git", ["status", "--porcelain"]).trim()) {
  step("git", ["add", "src-tauri/phone/maree-phone.apk", "src-tauri/phone/maree-phone.json"]);
  step("git", ["commit", "-m", `Release ${tag}`]);
}
step("git", ["tag", "-a", tag, "-m", `Marée ${version}`]);
step("git", ["push", "origin", "HEAD", "--follow-tags"]);
const assets = fs.readdirSync(out).map((f) => path.join(out, f));
step("gh", ["release", "create", tag, "--repo", repo, "--title", `Marée ${version}`, "--notes", notes, ...assets]);
console.log(`\nPublished https://github.com/${repo}/releases/tag/${tag}`);
