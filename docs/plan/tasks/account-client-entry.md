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

## 最新用户修订：立即切换自部署 Logto

用户已提供 default 业务租户M2M并授权创建应用/相关配置，本阶段改为自部署身份服务：公开endpoint `https://auth.x.aixgg.com`，issuer以实际discovery为准；console `https://logto.x.aixgg.com/`。管理resource属于Logto Management API，仅用于仓库外M2M配置，绝不作为AnyWork远控audience或给普通用户授权。秘密仅留仓库外0600状态，不进入源码、日志、静态产物或客户端。

- Cloud：先读库存/现有连接器与signinexperience，再幂等创建独立SPA、Native、远控resource/connect、默认用户角色及Account API策略；不覆已有应用/测试用户密码，不删除Cloud Development资源。协调服务需使用相应issuer/client/resource信任与独立namespace，禁止旧账号身份/seed混用或重置已有namespace。所有未知创建/部署结果先对账。
- Web与Desktop：同步完整公开配置，分别保持五项/七项完整覆盖和失败关闭；默认改为新自部署，SPA回跳绑定正式域名及隔离测试origin。旧issuer grant/草稿/安装身份不跨配置复用；新登录、新本机显式授权。
- 复验：新issuer真实JWT/connect与Account opaque token、设备发布发现/换钥/公网加密访问/退出、1440/390px与精确source/CSP静态部署。若新租户没有邮件连接器，不能声称邮箱注册/邮件已通过；不为测试覆盖现有身份服务的全局策略。账号内存存储、不使用Keychain和无云业务存储的约束继续有效。

此前Development真实链路作为历史已通过证据保留，不能替代新issuer验收；最终Vercel发布和本机更新等待自部署配置/链路及独立审查完成。

2026-11-10当前进度：[自部署切换记录](../reviews/account-selfhost-cutover-01.md)。新Logto配置与默认值已独立接受，CyberGrid与[正式主页](../reviews/account-homepage-selfhost-live.md)已READY。实际新issuer Native显式启用、Web发现/核对/公网加密空工作区、关闭/退出、同安装重启换钥确认通过，独立目录记录恰1条且keyVersion2；正式默认配置/域名与实际390/1440视口另行通过。托管注册表单入口通过，未验证邮件投递；本机候选及安全切换脚本已独立接受，现有107会话/token/manager/四条隧道最终基线通过，已授权单次切换，结果见当前记录。
