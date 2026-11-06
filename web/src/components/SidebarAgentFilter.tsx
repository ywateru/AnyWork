import { Check, ChevronDown, Layers } from "lucide-react";
import type { Plugin, Session } from "../types";
import { agentName, sidebarAgentOptions } from "../sidebarAgents";
import AgentIcon from "./AgentIcon";

export default function SidebarAgentFilter({
  plugins,
  sessions,
  value,
  onChange,
}: {
  plugins: Plugin[];
  sessions: Session[];
  value: string;
  onChange: (value: string) => void;
}) {
  const options = sidebarAgentOptions(plugins, sessions, value);
  return (
    <details className="sidebar-agent-filter" data-floating-menu>
      <summary
        aria-label={`筛选 Agent：${value ? agentName(value, plugins) : "所有 Agent"}`}
      >
        {value ? (
          <AgentIcon agent={value} />
        ) : (
          <Layers size={16} aria-hidden="true" />
        )}
        <span>{value ? agentName(value, plugins) : "所有 Agent"}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="sidebar-agent-menu" role="group" aria-label="Agent 筛选">
        <button aria-pressed={!value} onClick={() => onChange("")}>
          <Layers size={17} aria-hidden="true" />
          <span>所有 Agent</span>
          {!value && <Check size={14} />}
        </button>
        {options.map((option) => (
          <button
            key={option.id}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            <AgentIcon agent={option.id} />
            <span>
              {option.name}
              {!option.present && <small>暂不可用</small>}
            </span>
            {value === option.id && <Check size={14} />}
          </button>
        ))}
      </div>
    </details>
  );
}
