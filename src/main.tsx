import React from "react";
import ReactDOM from "react-dom/client";

// Bundled font (offline-safe; no Google Fonts CDN at runtime).
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";

// Design-system tokens (from Claude Design "graft-design-system").
import "./styles/tokens/colors.css";
import "./styles/tokens/typography.css";
import "./styles/tokens/spacing.css";
import "./styles/tokens/elevation.css";
import "./styles/tokens/blocks.css";
import "./styles/tokens/data.css";

// React Flow base styles, then our overrides.
import "@xyflow/react/dist/style.css";
import "./styles/app.css";

import App from "./App";

// Default to the dark theme + compact density (see token files).
document.documentElement.dataset.theme = "dark";
document.documentElement.dataset.density = "compact";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
