---
id: claude-web
scope: Agent identity, website and public documentation
status: completed
depends-on: []
---

## objective

在 Web 展示 Claude Code 与 Claude Desktop Code 的独立身份、能力/设置入口，并在双语官网、README、入门文档与支持矩阵说明当前后端 Agent。

## context

- `docs/claude-integration.md`（协调工作区中的当前契约）
- `docs/sidebar-agent-filter.md`、`docs/support-matrix.md`

## path

`web/`、`site/`、双语 README、入门文档、支持矩阵、架构概述、站点测试。不得改 Rust、Cargo 或协调者的 Claude 契约与计划记录。

## verification

Web 单测、类型检查、生产构建，双语站点构建与站点检查；桌面/窄屏浏览器核验，能力文案与最终后端实现一致。

已独立接受作者 `7a25eaa`，合入 main 至 `17167df`；[独立审查](../reviews/claude-web-independent.md)关闭设置固定 Codex 文案与 Desktop 控制声明问题。主分支补验通过 401 项 Web 单测、8 项私有状态检查、类型与生产构建，以及英中各 320–1440px 站点检查。原生 Desktop 写入验收另记，不由网页通过推断。
