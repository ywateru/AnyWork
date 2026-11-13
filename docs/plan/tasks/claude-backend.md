---
id: claude-backend
scope: Claude CLI/Desktop backend integration
status: completed
depends-on: []
---

## objective

落实 Claude Code 与 Claude Desktop Code 原生适配器、历史与就绪能力，完成 API/运行时创建、恢复、输入、流式、工具、审批、问答、取消及模型调用；遵守真实拓扑，不提供假控制。

## context

- `docs/claude-integration.md`（协调工作区中的当前契约）
- `docs/architecture.md`、`docs/support-matrix.md`、`docs/plugin-protocol.md`
- 官方 `anthropics/claude-agent-sdk-python`，本机 `claude --help`，桌面调研证据

## path

`Cargo.toml`、`Cargo.lock`、`crates/`（不改与 Claude 无关功能）、新增 CLI 集成测试脚本。

## verification

Rust 编译与相关边界测试；隔离端到端服务 API 验证；官方 SDK 流协议核对；必要时真实 CLI 新会话验证。独立 verifier 在提交后复核。

CLI 与被动历史候选 `e70c8a5` 已独立通过并合入 main（`533b903`）；[独立审查](../reviews/claude-backend-independent.md)记录 F1–F6 的修复复核、真实新会话与审批/问答/取消。Desktop mapper/默认发现 `129f3d0` + `fd71325` + `c4aff63` 及工具身份测试 `2f69beb` 也已[独立通过](../reviews/claude-desktop-mapper-independent.md)并合入 main 至 `ded4fd4`。截图目标的默认发现、5 页历史和来源身份通过只读核验，文件 hash 不变。源码任务完成；按用户最新安排，合法桥连接及真实 Desktop 控制由用户提交后手动测试，不标记为已通过。后续步骤见[连接与手测指南](../../claude-desktop-setup.md)。
