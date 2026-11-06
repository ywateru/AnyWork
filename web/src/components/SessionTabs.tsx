import { useEffect, useRef } from "react";
import {
  FileText,
  FolderOpen,
  GitBranch,
  Flag,
  MessageSquare,
  TerminalSquare,
  X,
  Users,
} from "lucide-react";
import type { ConversationPanel } from "../hooks/useConversationPanels";

const tools = [
  { id: "subagents", title: "Subagents", icon: Users },
  { id: "files", title: "文件", icon: FolderOpen },
  { id: "git", title: "变更", icon: GitBranch },
  { id: "goal", title: "目标", icon: Flag },
  { id: "terminal", title: "终端", icon: TerminalSquare },
] as const;

export default function SessionTabs({
  title,
  tabs,
  selected,
  onSelect,
  onClose,
  inPanel = false,
}: {
  title: string;
  tabs: ConversationPanel[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  inPanel?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const items = [
    { id: "chat", title, description: title, icon: MessageSquare },
    ...tabs.map((tab) => {
      const tool = tools.find((item) => item.id === tab.kind)!;
      return {
        id: tab.id,
        title: tab.target?.path.split("/").pop() || tool.title,
        description: tab.target?.path || tool.title,
        icon: tab.target ? FileText : tool.icon,
      };
    }),
  ];
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, tabs]);
  return (
    <div className={`session-tabs-bar${inPanel ? " inspector-tab-bar" : ""}`}>
      <div
        className="session-tabs"
        role="tablist"
        aria-label="当前会话的子窗口"
        ref={list}
      >
        {items.map((item, index) => (
          <div
            className={`session-tab${item.id === selected ? " active" : ""}`}
            key={item.id}
          >
            <button
              role="tab"
              aria-label={item.id === "chat" ? "对话" : item.title}
              aria-selected={item.id === selected}
              aria-controls={
                item.id === "chat" ? "session-content" : "conversation-panel"
              }
              tabIndex={item.id === selected ? 0 : -1}
              title={item.description}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                let target: number;
                if (event.key === "ArrowRight")
                  target = (index + 1) % items.length;
                else if (event.key === "ArrowLeft")
                  target = (index + items.length - 1) % items.length;
                else if (event.key === "Home") target = 0;
                else if (event.key === "End") target = items.length - 1;
                else if (event.key === "Delete" && item.id !== "chat") {
                  event.preventDefault();
                  onClose(item.id);
                  requestAnimationFrame(() =>
                    list.current
                      ?.querySelector<HTMLButtonElement>(
                        '[aria-selected="true"]',
                      )
                      ?.focus(),
                  );
                  return;
                } else return;
                event.preventDefault();
                onSelect(items[target].id);
                list.current
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [target]?.focus();
              }}
            >
              <item.icon size={13} />
              <span>{item.title}</span>
            </button>
            {item.id !== "chat" && (
              <button
                className="close-session-tab"
                aria-label={`关闭标签：${item.title}`}
                title="关闭子窗口"
                onClick={() => onClose(item.id)}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
