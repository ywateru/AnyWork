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
