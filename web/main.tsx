import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const DARK_CLASS = "dark";

const darkMode = window.matchMedia(DARK_QUERY);
const applyTheme = () =>
  document.documentElement.classList.toggle(DARK_CLASS, darkMode.matches);
applyTheme();
darkMode.addEventListener("change", applyTheme);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
