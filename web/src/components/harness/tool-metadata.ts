// Extracted name/variant/title and summary preferences from upstream tool-call-model.ts
// and ui-conversation/locales.ts (zh), fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159, MIT.
export const TOOL_TITLES: Record<string, string> = {
  bash: "运行命令",
  pwsh: "运行命令",
  read: "读取",
  read_image: "读取图片",
  web_fetch: "读取",
  web_search: "搜索",
  grep: "搜索",
  glob: "搜索",
  write: "写入",
  edit: "编辑",
  apply_patch: "编辑",
  run_code: "代码",
  cordis_package_inspect: "查询 Cordis 环境",
  cordis_runtime_inspect: "查询 Cordis 环境",
  cordis_run: "运行 Cordis 插件",
  cordis_stop: "停止 Cordis 插件",
  cordis_undefine: "移除 Cordis 插件",
  todo_write: "更新任务清单",
  ask_user_question: "提问",
  create_goal: "创建目标",
  get_goal: "查看目标",
  update_goal: "更新目标",
  schedule_create: "创建自动化任务",
  schedule_list: "查看自动化任务",
  schedule_view: "查看自动化任务详情",
  schedule_edit: "编辑自动化任务",
  schedule_delete: "删除自动化任务",
  schedule_update: "修改自动化任务",
  cordis_inspect_list: "检查提供方",
  cordis_inspect_query: "查询运行时",
  cordis_inspect_self: "检查动态插件",
  workflow: "运行工作流",
  ralph: "运行循环工作流",
  session_event_read: "读取事件",
  session_event_search: "搜索事件",
  session_event_trace: "追踪事件",
  session_search: "搜索会话",
  session_trace: "追踪会话",
  list_subagent_models: "查看可用模型",
  subagent: "创建子智能体",
  subagent_fork: "派生子智能体",
  list_agents: "查看子智能体",
  send_message: "发送消息",
  interrupt_agent: "中断智能体",
  job_list: "查看后台任务",
  job_output: "读取任务输出",
  job_kill: "取消后台任务",
  terminal_open: "创建终端",
  terminal_read: "读取终端",
  terminal_list: "查看终端",
  terminal_signal: "发送终端信号",
  terminal_close: "关闭终端",
  lsp: "查询代码符号",
  spawn_teammate: "创建队友",
  team_task_create: "创建团队任务",
  team_task_get: "读取团队任务",
  team_task_update: "更新团队任务",
  team_task_list: "查看团队任务",
  wait_agent: "等待消息…",
};
export const TOOL_VARIANTS: Record<string, string> = {
  bash: "bash",
  pwsh: "bash",
  read: "read",
  read_image: "read",
  web_fetch: "read",
  web_search: "search",
  grep: "search",
  glob: "search",
  write: "write",
  edit: "edit",
  apply_patch: "edit",
  run_code: "code",
  cordis_package_inspect: "read",
  cordis_runtime_inspect: "read",
  cordis_run: "others",
  cordis_stop: "others",
  cordis_undefine: "others",
};
const SUMMARY_KEYS: Record<string, string[]> = {
  bash: ["description", "command"],
  read: ["path", "file_path", "url"],
  search: ["query", "pattern", "url"],
  write: ["path", "file_path"],
  edit: ["path", "file_path"],
  code: ["description"],
  others: [],
};
export function argumentSummary(name: string, raw: unknown): string {
  let args = raw;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return args.split("\n", 1)[0];
    }
  }
  if (args === null || typeof args !== "object") return "";
  const values = args as Record<string, unknown>;
  const variant = TOOL_VARIANTS[name] ?? "others";
  if (variant === "search" && Array.isArray(values.queries)) {
    const queries = values.queries.filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    if (queries.length)
      return queries.map((v) => v.split("\n", 1)[0]).join(", ");
  }
  for (const key of SUMMARY_KEYS[variant]) {
    const value = values[key];
    if (typeof value === "string" && value !== "")
      return value.split("\n", 1)[0];
  }
  const first = Object.values(values).find(
    (v) => typeof v === "string" && v !== "",
  );
  return typeof first === "string" ? first.split("\n", 1)[0] : "";
}
