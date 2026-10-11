// Print / Save as PDF: the selected problems are typeset with KaTeX into a
// print-only container and handed to the system print dialog ("Save as PDF").

import { fullProblems } from "../state/actions";
import { get, toast } from "../state/store";
import { renderInline, renderMarkdown, escapeHtml } from "../math/render";
import { groupForExport, metadataLine, problemHeading } from "../export/documents";
import { fmtDate, t } from "../i18n";

export interface PrintOptions {
  includeSolution: boolean;
  includeReference: boolean;
  includeNotes: boolean;
  includeMetadata: boolean;
}

export async function printProblems(
  ids: string[],
  title: string,
  opts: PrintOptions = { includeSolution: true, includeReference: false, includeNotes: false, includeMetadata: true },
): Promise<void> {
  if (!ids.length) return toast(t("Nothing to print."));
  const problems = await fullProblems(ids);
  const index = get().index;
  const groups = groupForExport(problems, index);
  const html: string[] = [`<header class="print-head"><h1>${escapeHtml(title)}</h1><div>${escapeHtml(fmtDate(new Date()))} · Marée</div></header>`];
  for (const g of groups) {
    if (groups.length > 1) html.push(`<h2 class="print-group">${escapeHtml(g.heading)}</h2>`);
    for (const p of g.problems) {
      html.push(`<section class="print-problem"><h3>${renderInline(problemHeading(p))}</h3>`);
      if (opts.includeMetadata) html.push(`<div class="print-meta">${escapeHtml(metadataLine(p, index))}</div>`);
      html.push(`<div class="prose">${renderMarkdown(p.statement)}</div>`);
      for (const part of p.parts) html.push(`<div class="prose print-part"><b>(${escapeHtml(part.label)})</b> ${renderMarkdown(part.statement)}</div>`);
      const block = (label: string, body: string) => {
        if (body.trim()) html.push(`<div class="print-block"><h4>${escapeHtml(label)}</h4><div class="prose">${renderMarkdown(body)}</div></div>`);
      };
      if (opts.includeSolution) {
        block(t("My Solution"), p.solution);
        for (const part of p.parts) block(`${t("My Solution")} (${part.label})`, part.solution);
      }
      if (opts.includeReference) {
        block(t("Reference Solution"), p.referenceSolution);
        for (const part of p.parts) block(`${t("Reference Solution")} (${part.label})`, part.referenceSolution);
      }
      if (opts.includeNotes) block(t("Notes"), p.notes);
      html.push("</section>");
    }
  }
  let root = document.getElementById("print-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "print-root";
    document.body.appendChild(root);
  }
  root.innerHTML = html.join("\n");
  document.body.classList.add("printing");
  // Give KaTeX fonts a moment to be ready before the dialog snapshots the page.
  await document.fonts?.ready;
  await new Promise((r) => setTimeout(r, 60));
  const done = () => {
    document.body.classList.remove("printing");
    root!.innerHTML = "";
    window.removeEventListener("afterprint", done);
  };
  // The print container is invisible on screen, so it is only cleared after printing finishes.
  window.addEventListener("afterprint", done);
  window.print();
}
