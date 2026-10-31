import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/dashboard.css";

// Mark the overlay before first paint so OBS never sees a dark frame.
if (window.location.pathname.replace(/\/+$/, "") === "/overlay") {
  document.documentElement.classList.add("is-overlay");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
