// Small bridges between commands and mounted components.

let visibleIds: string[] = [];

/** Called by the problem list whenever its visible rows change. */
export function setVisibleIds(ids: string[]): void {
  visibleIds = ids;
}

export function getVisibleIds(): string[] {
  return visibleIds;
}

export function focusSearch(): void {
  const el = document.querySelector<HTMLInputElement>("#library-search");
  if (el) {
    el.focus();
    el.select();
  }
}

export function focusList(): void {
  document.querySelector<HTMLElement>(".lp-body")?.focus();
}
