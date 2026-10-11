// Updates from GitHub Releases. The updater only installs packages signed with Marée's
// update key (the public half is in tauri.conf.json), so nobody else can push code.

import { get, set, toast } from "./store";
import * as A from "./actions";
import { flushAutosave } from "./autosave";
import { isTauri } from "../platform";
import { t } from "../i18n";
import type { Update } from "@tauri-apps/plugin-updater";

let pending: Update | null = null;
let checking = false;

/** Checks quietly a little after start-up, then every six hours while the app is open. */
export function initUpdates(): void {
  if (!isTauri() || get().info?.e2e) return;
  const tick = () => {
    if (get().settings.autoUpdate) void checkForUpdates(false);
  };
  window.setTimeout(tick, 15_000);
  window.setInterval(tick, 6 * 3600_000);
}

export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!isTauri()) {
    if (manual) toast(t("Updates are available in the desktop app."), "info");
    return;
  }
  if (checking) return;
  checking = true;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      pending = update;
      set({ update: { version: update.version, notes: update.body ?? "" } });
      toast(t("Marée {v} is available.", { v: update.version }), "info", { label: t("Restart to Update"), run: () => void installUpdate() });
    } else if (manual) {
      toast(t("Marée is up to date."), "success");
    }
  } catch (e) {
    if (manual) toast(t("Could not check for updates: {msg}", { msg: e instanceof Error ? e.message : String(e) }), "error");
  } finally {
    checking = false;
  }
}

/** Saves everything, downloads and verifies the update, and restarts into it. */
export async function installUpdate(): Promise<void> {
  if (!pending) return;
  await flushAutosave();
  await A.persistSession();
  set({ update: { ...get().update!, installing: true } });
  try {
    await pending.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    set({ update: { ...get().update!, installing: false } });
    toast(t("The update could not be installed: {msg}", { msg: e instanceof Error ? e.message : String(e) }), "error");
  }
}
