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

待使用者决策的具体恢复选项：保留原数据库与namespace，先核对/设置月预算5美元，再调用官方 [change-plan](https://upstash.com/docs/devops/developer-api/redis/change_plan) 切换 `payg`（`auto_upgrade=false`、`prod_pack_enabled=false`），并复核原namespace epoch和公开配置恢复。预算接口见 [update-budget](https://upstash.com/docs/devops/developer-api/redis/update_budget)。该预算是供应商的月度节流机制，不能描述为无延迟硬性支出上限；若服务商要求绑定付款方式，由使用者在官方控制台完成。此选项尚未执行，不含付费授权。

恢复方案重要补充（官方当前说明）：[Upgrade Your Database](https://upstash.com/docs/redis/howto/upgrade-database)明确新增付款方式会将账号内所有免费资源转为按量，不能保证仅升级这一数据库。因此未获账号层面付费授权前不执行上述 change-plan；若需要绑定付款方式，必须由使用者操作。已通过检索核对官方 change-plan/update-budget 请求字段与[预算FAQ](https://upstash.com/docs/common/account/faq)，但仍须变更前读取当前套餐和预算，不能仅据历史文档假定允许单库升级。
