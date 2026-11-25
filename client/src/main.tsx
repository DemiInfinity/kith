import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/nunito";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import "./theme.css";
import { App } from "./App";
import { followKeyboard } from "./lib/viewport";

followKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
