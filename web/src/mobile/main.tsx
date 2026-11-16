import ReactDOM from "react-dom/client";
import MobileApp from "./MobileApp";
import "../style.css";
import "../codex.css";
import "../agent-os.css";
// App's shared navigation, session rows and Agent identities live here.
// Load them before the bundled client's mobile overrides, as in the Web entry.
import "../desktop.css";
import "../documents.css";
import "../components/conversation/conversation.css";
import "./mobile.css";
// No hosted account entry, browser handoff, PWA registration or remote app shell.
ReactDOM.createRoot(document.getElementById("root")!).render(<MobileApp />);
