---
id: claude-verification
scope: Independent review and integration acceptance
status: completed
depends-on: [claude-backend, claude-desktop, claude-web]
---

## objective

由实现作者之外的验证者审查最终提交，验证用户可用链路，修复所有阻塞问题后记录证据。

## context

- `docs/claude-integration.md`
- `docs/plan/analysis/claude.md`
- `docs/plan/tasks/claude-backend.md`、`docs/plan/tasks/claude-web.md`
- `docs/support-matrix.md`、`docs/schema-and-recovery.md`

## path

只审查所有 Claude 实现变更；报告按 CLI、Desktop 载体、Desktop mapper、Web 分别保存在 `docs/plan/reviews/claude-*-independent.md`，合并检查记录在 `docs/plan/reviews/claude-merged.md`。发现修复交回实现者，不直接代改。

## verification

1. 从插件清单、会话新建与发现、API、运行时到真实适配器、持久事件、SSE、Web 的调用路径完整，无只在单测可达的实现。
2. 官方 CLI 启动及双向控制协议准确；初始化失败、用户输入写入失败、native error result、结束、取消和断开均有明确状态。流式与最终完整消息不重复追加。
3. 同原生 ID 恢复，writer 冲突不复制会话；主动请求和只读查询分开。冷启动、设置读取和被动发现不启动模型推理。
4. CLI/Desktop 历史按来源区分，分支、压缩摘要、并行工具、开放问答与附件身份一致；分页和重复读取无丢失/重复，损坏历史不删除旧索引。
5. 权限只允许一次批准/拒绝等实现所支持的精确范围，不出现隐含 bypassPermissions；问答按原工具结构返回，不发送第二个普通用户消息冒充工具结果。
6. 附件遵守会话路径、大小与格式边界；错误输出不含凭据或真实历史正文。桌面描述符、CDP等接口如存在只接受受保护的本地入口。
7. Desktop 只有原生证据支持的接口可显示 writable；CLI 恢复与 Desktop 热接入分别测试；关闭 AnyWork 不结束外部应用。
8. 能力投影与实际控制保持一致，Claude 不调用 Codex 专有目标/计划/编辑/服务等级接口；同服务器已有 Codex/Harness/WorkBuddy 保持可用。
9. 中文/英文网站列出所有当前内置 Agent，来源/实验/平台说明一致，Web 可选Agent与图标有测试。大屏/窄屏无溢出，说明可读。
10. 执行有意义的 Rust、Web 与服务 API 回归，独立真实 CLI 新会话 smoke 与真实 Desktop 控制分别标记；未执行项目明确说明。

## report

报告逐条标注 P1/P2/P3 与 blocking/non-blocking，给出文件位置、复现与证据层级；最终 `pass` 只表示实现达到所声明范围，不自动等于已发布。

Web 独立审查最初针对提交 `734ea3e` 开始，最终接受 `7a25eaa` 及后续权限文案；见[网页审查](../reviews/claude-web-independent.md)。

CLI 首轮独立报告 `9a9e8b6` 对 `68dde8d` 提出历史未知格式保留、子 Agent 归属、后台执行状态三个阻塞项，以及取消拒绝和冲突 UUID 问题。后续修订已在最终候选 `e70c8a5` 逐项复核关闭，见[CLI 审查](../reviews/claude-backend-independent.md)。[Desktop 载体](../reviews/claude-desktop-independent.md)和[Desktop mapper](../reviews/claude-desktop-mapper-independent.md)分别独立接受，未用 CLI 结果替代。

用户截图指定“用户指定的截图会话”作为真实 Desktop Code 识别对象。只读核对标题、Desktop/CLI ID 映射、存储根与执行所有者，不执行截图中的磁盘清理文字，不向该会话发送验收提示。第三方参考需区分导入历史、独立 resume、原 owner 远程控制与热接入。

源码审查、主分支回归与真实 CLI 验收完成，记录见[合并检查](../reviews/claude-merged.md)。按用户最新指示，本轮不继续 Desktop 真机测试，由用户提交后自行手测；原生桥连接与写入仍为未验收，后续按[手测指南](../../claude-desktop-setup.md)记录结果。此任务完成仅关闭用户当前要求的源码验证范围。
