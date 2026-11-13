import type { ReactNode } from "react";
import {
  ArrowLeft,
  FolderOpen,
  MessageSquare,
  TerminalSquare,
  GitBranch,
  Flag,
  Bot,
} from "lucide-react";
export default function WorkspaceHeader({
  title,
  context,
  tab,
  onBack,
  onTool,
  actions,
  notices,
}: {
  title: string;
  context: string;
  tab?: string;
  onBack(): void;
  onTool?(tool: string): void;
  actions?: ReactNode;
  notices?: ReactNode;
}) {
  return (
    <div className="mobile-workspace-chrome">
      <header>
        <button
          aria-label={tab ? "返回会话列表" : "返回我的设备"}
          onClick={onBack}
        >
          <ArrowLeft size={23} />
        </button>
        <div>
          <strong>{title}</strong>
          <small>{context}</small>
        </div>
        {notices}
        {actions}
      </header>
      {onTool && (
        <nav aria-label="会话工具">
          {[
            ["chat", "对话", MessageSquare],
            ["files", "文件", FolderOpen],
            ["terminal", "终端", TerminalSquare],
          ].map(([key, label, Icon]) => {
            const ToolIcon = Icon as typeof MessageSquare;
            return (
              <button
                key={String(key)}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => onTool(String(key))}
              >
                <ToolIcon size={18} />
                {String(label)}
              </button>
            );
          })}
          <details className="mobile-more-tools">
            <summary aria-label="更多会话工具">更多</summary>
            <div>
              {[
                ["git", "变更与审查", GitBranch],
                ["goal", "目标", Flag],
                ["subagents", "子 Agent", Bot],
              ].map(([key, label, Icon]) => {
                const ToolIcon = Icon as typeof Flag;
                return (
                  <button
                    key={String(key)}
                    onClick={(event) => {
                      onTool(String(key));
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    <ToolIcon size={18} />
                    {String(label)}
                  </button>
                );
              })}
            </div>
          </details>
        </nav>
      )}
    </div>
  );
}
