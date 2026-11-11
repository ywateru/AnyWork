---
id: desktop-default-remote
scope: Native login grant, CyberGrid configuration transport and desktop console
status: in-progress
depends-on: []
---

## objective

登录且本地服务准备成功后默认尝试开启远程一次；手动关闭在当前 Native 登录会话内保持，允许显式重新开启。调查并修正 GitHub 客户端 REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE 的真实原因。首屏保留主要状态与动作，将连接列表、身份与说明改为渐进展开。

## context

- ../../desktop-onboarding-layout.md（本轮唯一行为和布局契约）
- ../../account-unified-experience.md
- ../../account-desktop.md

## path

- Native author: crates/desktop/**。负责 account_enable_default IPC、RAM 登录会话策略、关闭/退出竞态及协调配置传输调查/修正。独立证据写 reviews/desktop-default-remote-native.md。
- UI author: desktop/ui/**、e2e/desktop-*、site/locales/**、scripts/site-test.mjs。调用默认操作与精简布局、错误详情、设置说明；网站同步默认开启文案。证据写 reviews/desktop-default-remote-ui.md。
- Root: 本契约、索引、发布说明及合并发布。
- Independent reviewer: reviews/desktop-default-remote-independent.md；审查精确提交，必要时切换验证 Native/UI 提交，最后验证合并候选。不负责产品实现。

## verification

真实调用链须涵盖 UI preparation→Native default command→verified CyberGrid config→enable；保持严格配置绑定和内存凭据。Native 测试覆盖一次默认尝试、重复命令、失败、手动关闭、注销和迟到操作。公开接口探测必须区分 shell 代理与 Native 默认传输，报告证据边界。UI 测试覆盖登录/注册自动开启、手动关闭保持、失败后的本地访问、展开/收起与设置返回，四尺寸截图检查。独立审查通过后合并，执行合并检查及精确源码发布；不操作现有应用、服务或真实账户。

## investigation status

Native 作者已观察到正式 CyberGrid `/api/v1/auth/config` 在直连路径返回 HTTP503 / `COORDINATOR_UNAVAILABLE`，提示协调存储不可用。独立审查正在核实 Upstash 与部署配置原因。这是服务端当前失败证据，不是用户每次历史故障的完整归因；shell 代理另有 TLS reset，不能与真实服务503混为一谈。基础设施如需恢复，应保留现有 namespace/epoch、账号与设备数据，不通过清空 Redis 或变更信任绑定绕过故障，不静默升级付费套餐。

独立复核进一步确认：Upstash 管理信息为 active/free，`db_request_limit=500000`；协调 namespace 的只读操作得到供应商固定错误 `max requests limit exceeded`，计数 `500030/500000`。PING/TYPE 能成功不表示协调所需的 EVAL 可用。当前服务故障有直接额度证据，不需要修改客户端绑定或绕过校验。付费方案与费用另行确认；在未授权前不改套餐、不清空/迁移 namespace。

额度周期已核实为月度，供应商统计 `total_monthly_requests=521193`（read499266/write21927）。[已核验的官方价格页](https://upstash.com/pricing/redis)明确Free每月500K；PAYG每100K命令0.20美元；供应商请求错误与月度统计共同确认本次耗尽的是月度上限。统计口径/时点与单个拒绝错误中的500030分别记录，不假称实时计数相同。可选等待额度重置或经使用者明确授权改按量并设置预算；当前未变更套餐。

待使用者决策的具体恢复选项：保留原数据库与namespace，切换按量计费，并尝试设置月预算5美元。官方已核验价格为每100K命令0.20美元；套餐/预算API的当前请求schema、预算生效方式及账号其他免费资源是否受影响尚需在实际变更前核实。此次官方相关操作文档读取返回HTTP错误，不将暂存的change-plan/update-budget字段当作已核验事实，也不承诺仅此单库计费或硬性支出上限。若服务商要求绑定付款方式，由使用者在官方控制台完成；未获付费授权前不执行变更。
