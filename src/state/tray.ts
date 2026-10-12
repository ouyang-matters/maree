// "To ChatGPT": problems gathered (e.g. everything cropped from one photo) to be copied
// to ChatGPT together, each problem followed by my answer.

import { get } from "./store";
import * as A from "./actions";
import { t } from "../i18n";
import { toast } from "./store";

function save(ids: string[]): Promise<void> {
  return A.updateSettings({ chatTray: ids });
}

/** The tray without problems that were deleted meanwhile. */
export function trayIds(): string[] {
  const live = new Set(get().problems.filter((p) => !p.deletedAt).map((p) => p.id));
  return get().settings.chatTray.filter((id) => live.has(id));
}

export function openTray(): void {
  A.openTab({ id: "tray", kind: "tray" });
}

export async function addToTray(ids: string[], opts: { quiet?: boolean } = {}): Promise<void> {
  const cur = trayIds();
  const add = ids.filter((id) => !cur.includes(id));
  await save([...cur, ...add]);
  if (!opts.quiet) {
    toast(add.length ? t("{n} added to To ChatGPT", { n: add.length }) : t("Already in To ChatGPT"), "success", { label: t("Open"), run: openTray });
  }
}

export async function removeFromTray(ids: string[]): Promise<void> {
  await save(trayIds().filter((id) => !ids.includes(id)));
}

export async function moveInTray(id: string, delta: -1 | 1): Promise<void> {
  const ids = trayIds();
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await save(ids);
}

export async function clearTray(): Promise<void> {
  const before = get().settings.chatTray;
  await save([]);
  toast(t("To ChatGPT cleared"), "info", { label: t("Undo"), run: () => void save(before) });
}
