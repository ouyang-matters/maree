# Status of Marée 1.0.0

This page separates what is implemented, what has been verified (and how), and what is
not done yet. It is meant to be honest rather than flattering.

## Implemented

**Foundation**
* Tauri 2 desktop shell (Rust) with a custom title bar, wordmark, window controls, native
  shadow/resizing; startup splash; four themes (Marée, Dark Academic, Waterloo Math Pink,
  Black & Gold) plus *follow system*.
* Menu bar (File · Edit · View · Library · Tools · Help) with keyboard navigation (Alt),
  a single command registry shared by menus, the command palette and shortcuts.
* SQLite storage (rusqlite, WAL, foreign keys), versioned append-only migrations with a
  pre-migration snapshot and refusal of newer schemas, daily rolling snapshots (10 kept),
  content-addressed file storage for originals and attachments, portable mode.
* Localisation layer (English complete; French and Chinese dictionaries partial).

**Library**
* Courses (create, edit, archive, delete with keep/trash choice), lectures (bulk add by
  range or list, titles, dates, descriptions, reordering), hierarchical topics with
  aliases, sources with full provenance (file, type, author, section, pages, hash, import
  date, original path, stored copy).
* Problems: title, statement, course, many lectures, many topics, source, original number,
  page, section, raw extracted excerpt, difficulty 1–4, priority, type, five statuses,
  solution, hidden reference solution, notes, last attempt, review date, attachments,
  history, timestamps, pinning; multi-part problems with independent status/solutions
  (parent status derived from the parts); Trash with restore and permanent deletion.
* Attempts: immutable snapshots with outcome and note; restore into the editor.
* Autosave (debounced, max-wait, retry, flushed on tab close/export/window close).

**Workspace**
* Sidebar (All Problems, Review Queue, Recently Edited, Needs Import Review, Trash,
  Courses, Lectures with course switcher, Topics tree, Sources, Saved Views), collapsible,
  with context menus and drag-and-drop targets (drop problems on a lecture/topic/course).
* Problem list: virtualised; adaptive compact two-line rows or a configurable, sortable
  table; card view; multi-selection with bulk actions; keyboard navigation.
* Problem view: breadcrumbs, typeset title, one-click status (Alt+1…5), metadata chips,
  import-review banner with the original extracted text, statement editor, parts, work
  tabs (My Solution · Reference · Notes · Attempts · History), attachments, provenance.
* Editor: CodeMirror 6 with LaTeX/Markdown highlighting, LaTeX command completion and
  snippets, formatting shortcuts, undo/redo, search; live KaTeX preview; source/split/
  preview modes; formula error reporting.
* Tabs with preview semantics, two editor groups (side by side or stacked), drag tabs
  between groups; PDF source viewer (pdf.js, selectable text, zoom, page jump) that can be
  opened beside a problem at its page.
* Command palette (Ctrl+K: problems, lectures, topics, courses, views and commands;
  Ctrl+Shift+P: commands only), global search (FTS4 over statements, solutions, notes,
  attempts, topics and source metadata), combinable filters, saved views.
* Review queue (due, needs review, incorrect/incomplete attempts, in progress, scheduled,
  recently attempted) and progress overview by course/lecture/topic.
* Onboarding (five inline steps) and a removable, clearly marked sample library.

**Import**
* PDF (pdf.js; reading-order line reconstruction, headers/footers/page numbers removed,
  hyphenation, sub/superscript and fraction detection, scanned-page detection),
  Markdown, LaTeX (problem/exercise environments, numbering within sections, enumerate
  items, sub-parts, solution environments), plain text, DOCX (paragraphs, headings,
  automatic list numbering, Word equations converted from OMML to LaTeX), JSON problem
  sets, images (as attachments of new problems).
* Segmentation (structured markers, "Problem/Exercise/Question N", numbered items,
  headings, single-problem fallback), sub-parts (a)(b)/(i)(ii) and 4(a)/4(b) merging,
  lecture headings.
* Classification: course codes from file names/titles, lecture ranges in file names,
  topic vocabulary mapped onto your own topics and aliases, problem type from verbs,
  explicit difficulty markers; bulk adjustment.
* Duplicate detection (same file hash; near-duplicate statements); review wizard with the
  source page beside each problem, assisted LaTeX toggle, per-problem "checked" state.

**Export**
* Markdown, LaTeX (complete document with your macros), JSON (problem subset or full
  library), PDF through the print dialog; copy problem/proof as Markdown or LaTeX;
  full backups (library JSON + database copy + original files) and restore (merge or
  restore, never deleting).

## Verified (Windows 11 Pro, 2026-10-11)

| What | How | Result |
|---|---|---|
| Repository, migrations, search, trash, attempts, part-status derivation, persistence across reopen, batch rollback, sample removal | `npm test` (node:sqlite) | pass |
| Import: Markdown, LaTeX, JSON, DOCX (incl. Word equations → LaTeX checked by KaTeX), real LaTeX-typeset PDF (10 problems, Lectures 7–12, parts, pages, flags, assisted reconstruction of scripts and fractions), classification, duplicates, commit with provenance and re-import detection | `npm test` | pass |
| Export: library JSON round-trip into an empty library, merge vs. restore, Markdown verbatim formulas, **LaTeX export compiled with pdflatex** | `npm test` | pass |
| Math rendering: inline/display delimiters, quantifiers, sets, sums, products, matrices, Greek, align*, theorem/proof environments, lists, macros, error reporting, no raw HTML | `npm test` | pass |
| SQL bridge, transaction rollback, FTS4 in bundled SQLite, snapshots, content-addressed store, path-traversal rejection, backup zip round-trip | `npm run test:rust` | pass |
| The 14-step acceptance workflow (launch → MATH 147 → Lectures 7–12 → topics → PDF import → review/correct → assign → rendered LaTeX → write proof → Needs Review → combined filter → restart → data intact → export JSON / backup zip / Markdown) | `npm run e2e` against `target\release\maree.exe` | **16/16 checks pass** |
| NSIS installer | silent per-user install to a scratch folder, `npm run e2e` against the **installed** copy, silent uninstall | install OK, **16/16 checks pass**, uninstall removes files, registry entry and shortcut |
| UI in all four themes; import wizard; palette; progress; cards; help | headless Edge screenshots (`scripts/ui-shots.mjs`) of the browser build and CDP screenshots of the desktop build | reviewed by eye |

Bugs found and fixed by this verification include: KaTeX layout and editor styles blocked
by Tauri's style-src CSP nonce in the desktop build, WebView2 inserting non-breaking
spaces into typed LaTeX, PDF glyphs placed off the baseline (radicals, fractions, big
delimiters) being torn out of their lines, and nondeterministic ordering of attempts
recorded within the same millisecond.

**Not verified:** the MSI package was built but not installed (it targets per-machine
installation); printing / *Save as PDF* (modal system dialog); Windows 10; high-contrast
mode; very large libraries (performance was designed for, not measured, beyond ~100 problems).

## Not done / limitations

* **No OCR.** Scanned PDFs are detected and can be transcribed page by page beside the
  image, but no text is recognised automatically.
* **PDF mathematics is approximate.** Radicals' extent, matrices, large operators with
  limits and multi-line displays cannot be recovered reliably from PDF text; the assisted
  conversion helps but must always be checked (problems stay flagged until marked
  checked).
* **No AI-assisted extraction** (left as an optional future module, as specified).
* **MathLive visual formula input** is not included; formulas are typed as LaTeX with
  completion and snippets.
* **Printing to PDF** uses the WebView2 print dialog; it was not exercised by the
  automated tests (it opens a modal system dialog).
* **French and Chinese** translations cover menus and the main navigation only.
* **Installers are unsigned**; Windows SmartScreen may warn on first run.
* Clipboard images cannot yet be pasted directly as attachments (use *Add file* or drag
  and drop).
* Windows 10 is expected to work (WebView2) but was not tested; testing was done on
  Windows 11.
