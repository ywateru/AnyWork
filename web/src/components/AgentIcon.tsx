import { Bot, Monitor, Terminal } from "lucide-react";
import { agentIdentity } from "../agentIdentity";

export default function AgentIcon({ agent }: { agent: string }) {
  const identity = agentIdentity(agent);
  const Badge =
    agent === "claude-code"
      ? Terminal
      : agent === "claude-desktop"
        ? Monitor
        : null;
  return (
    <span className="agent-mark" aria-hidden="true" data-agent-icon={agent}>
      {identity ? (
        identity.images.map((image, index) => (
          <img
            key={image}
            className={
              identity.images.length === 2
                ? index === 0
                  ? "agent-mark-light"
                  : "agent-mark-dark"
                : undefined
            }
            src={`${import.meta.env.BASE_URL}agents/${image}`}
            alt=""
          />
        ))
      ) : (
        <Bot size={17} />
      )}
      {Badge && <Badge className="agent-mark-badge" size={10} />}
    </span>
  );
}
