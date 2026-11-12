---
id: open-source-ui
scope: website and client open-source links and copy
status: done
depends-on: []
---

## objective

按用户要求进行简单界面调整并发布：官网、Web 和桌面产品明确说明服务端与客户端均开源，提供 `https://github.com/ywateru/AnyWork`。说明源码可审查、有助于了解数据安全与隐私边界；不将开源表述为绝对安全保证。

## context

- ../../releasing.md
- ../../account-web-layout.md
- ../../desktop-workspace-layout.md

## path

作者维护 `site/`、`web/src/`、`desktop/ui/src/` 的必要文案、链接与最小样式；桌面通过固定目标的原生命令打开 GitHub。根代理维护任务、索引及双语发行说明；独立审查者记录验收。登录、连接、会话、授权和数据处理逻辑保持原有契约。

```text
官网现有说明 / GitHub 入口 → 服务端与客户端开源说明
Web 现有源码区域          → 简短开源说明 + GitHub
桌面设置                  → 开源说明 + GitHub
```

## verification

作者提交后独立复核文案准确性、双语、链接、原生外部链接入口和窄屏布局。复用既有构建、页面检查，不为静态文案新增测试。通过后合并，按标准 publisher 递增版本、等待精确源码 Checks、全平台发布与网站更新并核验。开源说明本身无需新功能或服务端配置变更；追加域名需求的必要配置另见下节。

## official domain follow-up

同轮用户指定 `https://anywork.aixgg.com` 为后续正式网站。独立作者更新官网 canonical、发布校验、Web/桌面/Android 默认入口及当前指南，历史验收记录保留原地址。现有 Vercel 项目绑定经公开 DNS 核对并重新验证后为 verified；同步配置只添加新域名所需的 Logto callback/logout/CORS 和协调浏览器 origin，保留旧入口兼容项及原有身份、存储、部署源码。发布前必须确认实际 HTTPS、新入口登录重定向与白名单，不把仅改源码作为域名迁移完成。

域名变更会改变 Native 配置 namespace。为避免同一安装重复登记，仅对官方旧→新域名且其余六项公开信任字段完全匹配的路径，在新安装标识文件不存在时延续同 support、同 subject 的旧公开 UUID。新路径优先，旧路径保留回退；旧文件沿用普通文件、大小、JSON、UUID、禁止 symlink 校验，损坏时失败。其他配置变化仍隔离，不迁移密钥、token 或 grant，不放宽 gateway Origin。此兼容例外须有针对性测试并独立复核。

## progress

UI `874b4a7`、域名及兼容修正 `e0c093c` 已通过[独立审查](../reviews/open-source-ui.md)并合并。新增迁移与既有隔离边界共 8 项 Native 检查通过，Web/官网/Android 相关既有检查通过。新域名已验证且 HTTPS 可用；Logto、GitHub portal 与同代码协调 origin 配置已更新并独立核验。旧入口兼容项和 TLS Redis 配置保留。

2026-11-12：正式 [v0.1.29](https://github.com/ywateru/AnyWork/releases/tag/v0.1.29) 已发布，精确源码为 `17679e4f01e0ced8946b5dfa8456bbe56bd84c45`，网站统一为 `https://anywork.aixgg.com`。Checks `43193643523`、Release `43197004589` attempt2、最终 Vercel `43201878549` 均成功；publisher exit0 / complete。[两阶段独立发行验收](../reviews/open-source-release.md) PASS：20 资产、19 校验项、5 更新目标、双语下载及完整 `/source` 的 815 个公开文件均匹配发布源码。首次 macOS Intel DMG 创建遇 `Resource busy`，同版本显式重试成功，保留原失败记录。未替换用户安装版或操作业务数据；旧宿主需要更新并重启后接受新域名。
