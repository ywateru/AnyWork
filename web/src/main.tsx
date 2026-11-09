import React from "react";
import ReactDOM from "react-dom/client";
import AccountApp from "./AccountApp";
import "./style.css";
import "./codex.css";
import "./agent-os.css";
import "./desktop.css";
import "./documents.css";
import "./components/conversation/conversation.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AccountApp />
  </React.StrictMode>,
);
import { registerPwa } from "./pwa";
void registerPwa();
