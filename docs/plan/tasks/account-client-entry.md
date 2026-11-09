---
id: account-client-entry
scope: existing-client-account-entry-development-logto
status: in-progress
depends-on: [account-web, account-desktop]
---

# 当前客户端注册/登录与开发 Logto

## objective

用户于2026-11-09明确要求修改当前客户端 UI 增加注册或登录，Logto 本阶段使用 Development，之后迁移自部署。这是对当前交付范围和配置的授权：不再以购买 Cloud 生产套餐作为本阶段前置条件，不产生付费升级。

## context

- `docs/account-web-layout.md`：现有工作区入口、账号导航与隔离契约。
- `docs/account-desktop.md`、`docs/account-remote-protocol.md`：本机授权、唯一 refresh 所有者和设备安全。
- `docs/cloud-configuration.md`：开发资源和后续自部署配置。
- 已接受基线 main `d6e7e5f`；已有账号/协议不重新实现。

## path / lanes

1. Web：`web/`、`docs/account-web-layout.md`。在当前工作区增加常驻可发现的注册/登录或我的设备入口；支持桌面/移动；不能丢失手动连接状态或把旧业务请求送入账号模式。明确账号模式返回设备入口。完整公开构建配置覆盖用于迁移自部署。
2. Desktop：`crates/desktop/`、`desktop/ui/`、`docs/account-desktop.md`。默认切换现有 Development tenant/clients/resource/Grid；当前主界面展示直接注册/登录入口，保留“账号与远程访问”页和显式远程授权。修复失败登录状态阻止重新登录问题，注册和登录应均可达。已有 account-cloud.json 是完整覆盖；配置切换隔离旧授权/安装身份并要求新授权。
3. Cloud：`scripts/cloud/`、`.github/workflows/vercel.yml`、`vercel.json`、`scripts/assemble-vercel.py`、`scripts/source-archive.py`及其边界回归、`scripts/check.sh`、发布工具测试、`docs/cloud-configuration.md`、`docs/releasing.md`。部署文案与开关允许明确的 Development-backed 本阶段交付，不能把它称作 Logto production；保留真实链路和精确源码验收条件。提供公开配置与自部署迁移步骤，不读写业务或付费升级。

## verification

各 lane 提交后由不同 agent 对精确源码独立审查，阻断修复后合并。Web 检查现有工作区及账号页1440/390px入口、键盘/返回/失败恢复和配置隔离。Desktop 检查入口、登录失败后重试、默认配置及完整覆盖/非法配置拒绝；可运行的原生验收使用隔离 manager/server。Cloud 检查工作流发布恢复和公开配置完整性，不启用付费服务。本机完整检查已有基线，合并后按变更重跑必要检查；真实邮件、物理手机与端到端设备验证仍分开记账。

## integration

当前工作区 → 注册或登录 → 官方托管 Logto → 当前账号设备列表；本机客户端 → 登录/注册 → 显式允许远程访问 → Grid发现；自部署切换 → 配置新issuer/client/resource与Grid信任 → 新登录，旧授权不跨issuer复用。

## 后续用户修订：不使用本地钥匙串

用户随后明确“不需要使用本地钥匙串保存”。本轮新账号功能改为进程内存保存 grant、访问令牌和安装私钥，禁止 Account 路径调用 OS Keychain/Secret Service，也不改存普通文件。单一 refresh 所有者与失败关闭仍保留；未知刷新结果禁止回放旧令牌。进程退出后新登录并重新启用，不能自动恢复账号或监听器。已有手动连接凭据不在此修订范围。

设备私钥每进程重新生成。允许仅保存非敏感的随机安装ID（按完整公开配置/owner隔离），用于同台电脑的Logto公开目录更新，避免重启无限堆积离线设备。该文件不含令牌/密钥/用户业务内容；keyVersion由已有公开记录递增，新公钥与旧pin不匹配必须由浏览器明确确认。完整cloud配置可继续保存在原公开account-cloud.json。若实现采用全临时安装身份而无法保持有界目录，须修复后验收。

验收新增：运行路径无账号Keychain调用/普通secret文件；新进程无法恢复旧grant/key；同进程串行轮换与未知结果失败关闭；重启同owner保持公开安装ID但换私钥/公钥且触发旧pin确认；切owner/config隔离。旧持久化方案的检查只作历史证据，不能替代新方案验收。
