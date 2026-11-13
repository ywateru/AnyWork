---
id: claude-desktop
scope: Claude Desktop native carrier and launcher
status: completed
depends-on: []
---

## objective

基于已定位的原生 LocalSessions 接口，交付桌面连接引导、固定调用与 Rust 载体模块，支持原桌面会话创建、发现、历史、发送、状态、权限/问答、模型和中断。当前原包拒绝普通 CDP 启动参数，主要实现正常 DevTools 主动连接的私有 loopback 桥，不以需要厂商签名的 CDP 作为普通用户设置步骤。

## context

- `docs/claude-integration.md`
- `docs/plan/analysis/claude.md`
- 原安装包只读 REA 结果与 `scripts/workbuddy-launch.py` 的连接边界

## path

新增 `scripts/claude-desktop-launch.py`、`scripts/claude-desktop-launch-test.py`、`crates/server/src/claude/desktop.rs`，可选固定 JavaScript 载体，调查记录 `docs/plan/analysis/claude-desktop.md`。

## verification

隔离连接工具生命周期检查、固定方法/参数与错误包检查、后端集成编译及端到端测试。真实原生与协议夹具分别记录，不关闭或写入用户既有会话，不复制凭据。

2026-11-13 已通过完整复制原包、临时 profile 的正常启动及 DevTools 打开核验。控制台随后出现人工“允许粘贴”确认；不得自动输入 `allow pasting`、修改首选项或改用其他输入手段越过该检查。随后用户明确要求暂缓 Desktop 真机测试，留待提交完成后自行手测；本轮不继续原生 preload/CSP 探针。

固定载体作者提交 `ba0cdd0` 已由非作者[独立审查](../reviews/claude-desktop-independent.md)接受其源码/夹具范围，并合入 main `cee01fc`；主分支 6 项 Python/Node/真实本地 HTTP/WS 夹具通过。原生调查与截图 Claude-3p 身份记录见[Desktop 分析](../analysis/claude-desktop.md)。正常菜单启用开发者模式会重启应用；保留原进程的配置热读路径只有静态依据，必须由用户正常操作并遵守组织限制，不能宣称原生已连接。

本源码任务完成，真机原生桥和写入验收按用户要求后置，不扩大本次接受范围。后续操作保存在[连接与手测指南](../../claude-desktop-setup.md)，不依赖临时 token 或等待中的 broker。
