---
id: open-source-ui
scope: website and client open-source links and copy
status: in-progress
depends-on: []
---

## objective

按用户要求进行简单界面调整并发布：官网、Web 和桌面产品明确说明服务端与客户端均开源，提供 `https://github.com/ywateru/AnyWork`。说明源码可审查、有助于了解数据安全与隐私边界；不将开源表述为绝对安全保证。

## context

- ../../releasing.md
- ../../account-web-layout.md
- ../../desktop-workspace-layout.md

## path

作者维护 `site/`、`web/src/`、`desktop/ui/src/` 的必要文案、链接与最小样式。根代理维护任务、索引及双语发行说明；独立审查者记录验收。登录、连接、会话、授权和数据处理逻辑保持原有契约。

```text
官网现有说明 / GitHub 入口 → 服务端与客户端开源说明
Web 现有源码区域          → 简短开源说明 + GitHub
桌面设置                  → 开源说明 + GitHub
```

## verification

作者提交后独立复核文案准确性、双语、链接、原生外部链接入口和窄屏布局。复用既有构建、页面检查，不为静态文案新增测试。通过后合并，按标准 publisher 递增版本、等待精确源码 Checks、全平台发布与网站更新并核验。无需新功能或服务端配置变更。
