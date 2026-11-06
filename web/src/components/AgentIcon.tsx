import { Bot } from "lucide-react";

export default function AgentIcon({ agent }: { agent: string }) {
  const basename =
    agent === "codex"
      ? "codex"
      : agent === "deepseek-harness"
        ? agent
        : undefined;
  if (!basename)
    return <Bot size={17} className="agent-mark" aria-hidden="true" />;
  const extension = agent === "codex" ? "png" : "svg";
  return (
    <span className="agent-mark" aria-hidden="true" data-agent-icon={agent}>
      <img
        className="agent-mark-light"
        src={`/agents/${basename}-light.${extension}`}
        alt=""
      />
      <img
        className="agent-mark-dark"
        src={`/agents/${basename}-dark.${extension}`}
        alt=""
      />
    </span>
  );
}
