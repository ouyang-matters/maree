// Menu bar structure. Items reference commands by id; "-" is a separator.

import { t } from "../i18n";

export interface MenuDef {
  label: string;
  items: (string | "-" | { submenu: string; items: string[] })[];
}

export function menuBar(): MenuDef[] {
  return [
    {
      label: t("File"),
      items: [
        "problem.new",
        "course.new",
        "-",
        "import.files",
        "inbox.add",
        "import.library",
        "backup.restore",
        "-",
        "export.selection",
        "export.library",
        "backup.create",
        "print",
        "-",
        "settings",
        "tab.close",
        "-",
        "app.exit",
      ],
    },
    {
      label: t("Edit"),
      items: [
        "edit.undo",
        "edit.redo",
        "-",
        "edit.cut",
        "edit.copy",
        "edit.paste",
        "edit.selectAll",
        "-",
        "search.focus",
        "problem.handwrite",
        "problem.copyChatGpt",
        "tray.add",
        "problem.copyMarkdown",
        "problem.copyLatex",
        "-",
        "problem.duplicate",
        "problem.trash",
      ],
    },
    {
      label: t("View"),
      items: [
        "palette",
        "commands",
        "-",
        "view.sidebar",
        "view.list",
        "view.table",
        "view.cards",
        "-",
        "view.splitRight",
        "view.splitDown",
        "view.unsplit",
        "-",
        "view.zoomIn",
        "view.zoomOut",
        "view.zoomReset",
        { submenu: t("Theme"), items: ["theme.maree", "theme.maree-dark", "theme.waterloo", "theme.black-gold", "-", "theme.system"] },
      ],
    },
    {
      label: t("Library"),
      items: [
        "nav.all",
        "nav.review",
        "nav.recent",
        "inbox.open",
        "tray.open",
        "nav.importReview",
        "nav.trash",
        "-",
        { submenu: t("Set Status"), items: ["status.not_started", "status.in_progress", "status.completed", "status.needs_review", "status.mastered"] },
        "problem.review",
        "-",
        "course.new",
        "lecture.new",
        "topic.new",
        "view.save",
        "-",
        "sample.load",
        "sample.remove",
        "trash.empty",
      ],
    },
    {
      label: t("Tools"),
      items: ["progress", "phone.connect", "-", "tools.reindex", "tools.snapshot", "tools.dataFolder", "-", "settings"],
    },
    {
      label: t("Help"),
      items: ["help.welcome", "help.shortcuts", "-", "help.updates", "help.about"],
    },
  ];
}
