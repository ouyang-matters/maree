import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "katex/dist/katex.min.css";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/views.css";
import "./styles/prose.css";
import { App, BootError } from "./App";
import { boot } from "./state/actions";
import { useStore } from "./state/store";

const root = createRoot(document.getElementById("root")!);

function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("hide");
  setTimeout(() => splash.remove(), 400);
}

void boot().then(() => {
  const { ready, bootError } = useStore.getState();
  root.render(ready ? <App /> : <BootError message={bootError ?? "Unknown error"} />);
  requestAnimationFrame(() => setTimeout(hideSplash, 120));
});
