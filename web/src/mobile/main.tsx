import ReactDOM from "react-dom/client";
import MobileApp from "./MobileApp";
import "../style.css";
import "../codex.css";
import "../agent-os.css";
import "../documents.css";
import "../components/conversation/conversation.css";
import "./mobile.css";
// No hosted account entry, browser handoff, PWA registration or remote app shell.
ReactDOM.createRoot(document.getElementById("root")!).render(<MobileApp />);
