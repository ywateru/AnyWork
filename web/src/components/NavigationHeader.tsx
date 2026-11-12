import {
  Archive,
  Check,
  ChevronDown,
  Folder,
  ListFilter,
  PanelLeft,
  Plus,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import type { Session } from "../types";
import type { ReactNode } from "react";
export type GroupMode = "status" | "directory";
export default function NavigationHeader({
  sessions,
  filter,
  project,
  group,
  archived,
  onFilter,
  onProject,
  onGroup,
  onArchive,
  onCreate,
  onClose,
  onCollapse,
  agentFilter,
  deviceNavigation,
}: {
  sessions: Session[];
  filter: string;
  project: string;
  group: GroupMode;
  archived: boolean;
  onFilter: (value: string) => void;
  onProject: (value: string) => void;
  onGroup: (value: GroupMode) => void;
  onArchive: () => void;
  onCreate: () => void;
  onClose: () => void;
  onCollapse: () => void;
  agentFilter?: ReactNode;
  deviceNavigation?: ReactNode;
}) {
  const paths = [
    ...new Set(
      sessions.filter((s) => s.archived === archived).map((s) => s.cwd),
    ),
  ].sort();
  return (
    <>
      <div className="navigation-heading">
        <div className="workspace-switcher">
          <img
            src={import.meta.env.BASE_URL + "icon.svg"}
            width="22"
            height="22"
            alt=""
          />
          <strong>AnyWork</strong>
        </div>
        <button
          className="icon-button sidebar-collapse"
          aria-label="收起侧栏"
          title="收起侧栏"
          onClick={onCollapse}
        >
          <PanelLeft size={16} />
        </button>
        <button
          className="sidebar-dismiss icon-button"
          aria-label="关闭会话列表"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="navigation-actions">
        {deviceNavigation}
        <button
          className="navigation-new"
          aria-label="新建会话"
          onClick={onCreate}
        >
          <SquarePen size={16} />
          <span>新会话</span>
          <kbd>＋</kbd>
        </button>
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
          />
          {filter && (
            <button aria-label="清除搜索" onClick={() => onFilter("")}>
              <X size={12} />
            </button>
          )}
        </label>
      </div>
      {agentFilter}
      <div className="navigation-view">
        <span>{archived ? "已归档" : "会话"}</span>
        <details className="navigation-options" data-floating-menu>
          <summary aria-label="会话显示选项" title="分组与筛选">
            <ListFilter size={15} />
          </summary>
          <div className="navigation-options-menu">
            <div className="group-switch" aria-label="会话分组">
              <button
                aria-pressed={group === "directory"}
                onClick={() => onGroup("directory")}
              >
                <Folder size={14} />
                按目录{group === "directory" && <Check size={12} />}
              </button>
              <button
                aria-pressed={group === "status"}
                onClick={() => onGroup("status")}
              >
                <ListFilter size={14} />
                按状态{group === "status" && <Check size={12} />}
              </button>
            </div>
            <label className="project-filter">
              <Folder size={14} />
              <select
                aria-label="筛选工作目录"
                value={project}
                onChange={(e) => onProject(e.target.value)}
              >
                <option value="">所有目录</option>
                {paths.map((path) => (
                  <option key={path} value={path}>
                    {path.split("/").filter(Boolean).pop() || path}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            <button
              className={archived ? "archive-switch active" : "archive-switch"}
              title="切换归档"
              aria-pressed={archived}
              onClick={onArchive}
            >
              <Archive size={14} />
              {archived ? "查看未归档" : "查看已归档"}
            </button>
          </div>
        </details>
        <button
          className="icon-button"
          aria-label="添加会话"
          onClick={onCreate}
        >
          <Plus size={15} />
        </button>
      </div>
    </>
  );
}
