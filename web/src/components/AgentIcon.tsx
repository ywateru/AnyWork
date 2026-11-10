import { Bot } from "lucide-react";

export default function AgentIcon({ agent }: { agent: string }) {
  if (agent === "workbuddy")
    return (
      <span className="agent-mark" aria-hidden="true" data-agent-icon={agent}>
        <img src={`${import.meta.env.BASE_URL}agents/workbuddy.svg`} alt="" />
      </span>
    );
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
        src={`${import.meta.env.BASE_URL}agents/${basename}-light.${extension}`}
        alt=""
      />
      <img
        className="agent-mark-dark"
        src={`${import.meta.env.BASE_URL}agents/${basename}-dark.${extension}`}
        alt=""
      />
    </span>
  );
}
