# Agent 插件

内置 `codex` 无需配置。新增插件时，在此目录放置 `.json` 清单后重启服务端。
清单必须由管理员安装；浏览器不能上传或执行插件。

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "protocol_version": 1,
  "command": "/opt/my-agent/remote-agent-adapter",
  "args": ["--stdio"],
  "env": {},
  "capabilities": ["chat", "resume", "interrupt", "approvals", "questions", "models"]
}
```

清单中的 command 是实现 Remote Agent 协议的**适配器**。不能直接填任意厂商 CLI，除非该 CLI 本身实现了该协议。详见 [插件协议](../docs/plugin-protocol.md)。DeepSeek Harness、Claude Code、Cursor 预留此接口，v0.1 未内置这些厂商的适配实现。
