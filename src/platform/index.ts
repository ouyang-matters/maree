import type { Platform } from "./types";

let current: Platform | null = null;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function initPlatform(): Promise<Platform> {
  if (current) return current;
  if (isTauri()) {
    const { createTauriPlatform } = await import("./tauri");
    current = createTauriPlatform();
  } else {
    const { createWebPlatform } = await import("./web");
    current = await createWebPlatform();
  }
  return current;
}

export function platform(): Platform {
  if (!current) throw new Error("Platform not initialised");
  return current;
}

export type { Platform } from "./types";
