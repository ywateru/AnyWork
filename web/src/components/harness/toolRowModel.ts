import { toolInvocation, toolPresentation } from "../../toolPresentation";
import { TOOL_TITLES, argumentSummary } from "./tool-metadata";
import type { ToolRowState } from "./ToolRow";

/** Narrow presentation adapter. Never derive a tool action by executing/parsing shell. */
export function toolRowModel(item: Record<string, any> = {}) {
  const view = toolPresentation(item);
  const state: ToolRowState = [
    "interrupted",
    "cancelled",
    "canceled",
    "stopped",
  ].includes(item.status)
    ? "stopped"
    : item.status === "preparing"
      ? "preparing"
      : view.running
        ? "running"
        : ["failed", "error", "declined"].includes(item.status) ||
            item.success === false ||
            item.error != null ||
            (typeof item.exitCode === "number" && item.exitCode !== 0) ||
            item.result?.type === "error" ||
            item.result?.isError === true ||
            item.result?.raw?.isError === true
          ? "error"
          : "ok";
  const titles = {
    command: "运行命令",
    read: "读取",
    list: "列出文件",
    search: item.type === "webSearch" ? "搜索网页" : "搜索",
    files: "修改文件",
    image: "查看图片",
    tool: "调用工具",
  };
  const invocation = toolInvocation(item);
  const title =
    item.type === "dynamicToolCall"
      ? (item.title && item.title !== invocation.tool
          ? item.title
          : TOOL_TITLES[invocation.tool] || invocation.tool) || titles.tool
      : titles[view.kind];
  const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
  const actionSummary = actions
    .map((a: Record<string, any>) => a.path || a.name || a.query)
    .filter(Boolean)
    .join("、");
  const summary = String(
    item.description ||
      item.summary ||
      argumentSummary(invocation.tool, invocation.arguments) ||
      actionSummary ||
      item.command ||
      item.query ||
      item.path ||
      (view.kind === "tool"
        ? invocation.provider
          ? `${invocation.provider} · ${invocation.tool}`
          : invocation.tool
        : "") ||
      (Array.isArray(item.changes)
        ? item.changes
            .map((c: any) => c.path)
            .filter(Boolean)
            .join("、")
        : ""),
  );
  return { title: String(title), summary, state };
}

// Declared wire-name classification adapted from upstream models/tool-call-model.ts.
// A shell's source text is never inspected to choose a glyph.
export function toolGlyph(item: Record<string, any> = {}) {
  const name = toolInvocation(item).tool;
  const known: Record<
    string,
    "command" | "read" | "search" | "files" | "output" | "code" | "web"
  > = {
    bash: "command",
    pwsh: "command",
    terminal_open: "command",
    terminal_signal: "command",
    read: "read",
    read_image: "read",
    cordis_package_inspect: "read",
    cordis_runtime_inspect: "read",
    web_fetch: "web",
    web_search: "web",
    grep: "search",
    glob: "search",
    write: "files",
    edit: "files",
    apply_patch: "files",
    run_code: "code",
    job_output: "output",
    terminal_read: "output",
    read_task_output: "output",
    job_list: "output",
    terminal_list: "output",
  };
  if (known[name]) return known[name];
  const presentation = toolPresentation(item);
  return presentation.kind === "tool" && item.type === "mcpToolCall"
    ? "integration"
    : presentation.kind;
}
