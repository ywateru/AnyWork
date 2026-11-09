# 自部署 Logto 切换：当前集成状态

日期：2026-11-10，Asia/Shanghai。本文记录当前自部署切换，优先于早期 Cloud Development / Keychain 验收描述；它不是整套交付完成声明。

## 已完成

- 自部署 default 业务租户的 SPA、Native、独立远控 resource / connect、默认 User 角色与 Account API 已配置，并经独立只读复验。公开配置以 [云配置](../../cloud-configuration.md) 为准。用户提供的 M2M 保留用于配置，不作为用户授权，也不进入客户端或协调运行环境。
- Native / Web 默认配置已改为 `https://auth.x.aixgg.com`，实际 discovery issuer 为 `https://auth.x.aixgg.com/oidc`。完整配置覆盖、旧 issuer 隔离、Native 账号仅内存及显式远程启用保持不变。[默认配置审查](account-selfhost-defaults-01.md)已接受。
- [独立 CyberGrid 协调服务](account-selfhost-grid-live.md)已 READY：`https://anywork-cybergrid-selfhost.vercel.app`，独立 Upstash namespace `anywork:selfhost:v1`。固定公开应用目录，无运行期 Management M2M。root 另外实际 GET `/healthz`、`/api/v1/console/auth/config` 和 Native `/api/v1/auth/config?appId=…`，均200且新 issuer / resource / client 相符。API 必须带 `/api/v1` 前缀；不带前缀的静态404不代表服务故障。
- 实际隔离 Native 应用已通过新 issuer 托管用户名登录，显示“已登录”和“远程访问未开启”。测试使用空 workspace / data / history、断开的宿主夹具、关闭 Codex discovery 与 Native IPC；API 和 SQLite 均确认业务会话0。此时仅公开配置、manager 配置和锁文件出现在 manager 目录，没有账号 secret 文件。尚未点击启用。
- 本机 Vite Web 使用完整新配置，连接已上线的新协调服务；实际登录回跳、健康空设备页、退出、再次登录及再次健康空态均已观察通过。注册按钮实际进入 `auth.x.aixgg.com` 的托管用户名注册表单；没有提交注册，也没有证明邮件投递。该租户未增加邮件连接器。

## 精确产物与检查

AnyWork 产品来源为 `75726758a4c9ffd7e7da4fb45e115bba92803650`。后续部署诊断与函数文件物化修订不改变 Native / Web 产品代码；协调来源及变换身份见专门上线报告。

| 范围 | 当前证据 |
| --- | --- |
| 产品检查 | 合并后的327 Vitest +8 Node通过；既有全系统检查与611浏览器通过/1既有跳过，以及最终桌面影响范围作者/独立各46通过，详见[总验收](account-device-acceptance.md)；自部署默认值另有48桌面/4既有忽略、6远控与UI/clippy独立检查 |
| 云及发布恢复检查 | 原82项合并检查通过；随后诊断、文件物化与残留映射拒绝增量合并，root重跑5 materialize +9 prebuilt +20 deployment通过；独立真实CLI旧缺文件/新792项hash、零网络调用通过 |
| 官网候选 | 已构建，437静态文件、440上传文件、0 functions；完整公开配置、自部署CSP、精确Git源与manifest、已知秘密扫描通过；[独立审查](account-homepage-selfhost-artifact-01.md)另完成真实CLI离线439项hash/零网络调用及18已知秘密×1120文件/成员零命中；尚未部署 |
| 本机候选 | 0.1.13 debug / ad-hoc本机包，复用接受的 Native / server二进制；签名、arm64、逐Git源、Web manifest、已知秘密扫描及回滚计划经独立复验；尚未切换 |
| 实际Web截图 | 本地忽略文件 `artifacts/anywork-selfhost-devices-1392.png`、`artifacts/anywork-selfhost-signup-entry.png`；实际视口宽1392，无alerts、无水平溢出 |

本轮尝试通过浏览器viewport capability设置1440 /390，但两次实际 DOM `innerWidth`仍为1392；已恢复override，截图按实际宽度命名，不能将这次运行计为新的1440/390验收。之前响应式源码/浏览器检查仍作为各自历史证据保留。

审查过程另有一项已处理的本地草稿错误：一个密码类占位符被展开写入未发布的报告草稿。独立审查者移除该行后，只清除了该草稿两条reflog及6个唯一不可达loose对象，没有进行全库gc或改动其他历史；草稿对象已不可读，未推送或归档。最终报告完整Git tree对14个已知秘密扫描零命中。此事件不作为云端泄漏或其他账号凭据已被证实暴露的声明。

## 当前阻断与待续

原生 CUA 再次返回系统锁屏：`The Mac is locked and automatic unlock could not unlock it.` 没有绕过锁屏或通过内部 IPC 代替本机显式启用。浏览器 DOM 控制仍可验证上述 Web 空态，但不能替代 Native GUI 链路。

解锁后依次完成：

1. 新 issuer Native 显式启用 → Web 自动发现 → 核对本机公钥 → 真实公网加密空工作区；关闭应退出工作区。
2. 同 home / config 重启应未登录；重新登录和启用应复用公开安装ID、换公钥、递增版本，并要求旧 pin 明确确认；退出应关闭连接。
3. 发布受检官网候选，验证正式 origin / 源码 / CSP / 登录注册入口，再以 Native 默认正式配置复验。官网操作记录保持prepared，未提交。
4. 按独立接受的回滚方案更新安装 app / 原用户服务，复核全部107个既有会话ID、原访问令牌、manager配置及宿主/隧道进程。当前旧服务仍为0.1.10，本机用户数据未切换。

私有运行器为 `/tmp/anywork-selfhost-runtime.py`，唯一任务 base 为 `/private/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-selfhost-acceptance-6ql3v2a6`；`runtime.json`绑定自有 PID / 启动身份，停止只针对这些进程。测试账号凭据、管理凭据与状态均在仓库外，不写入本记录。

未发布新 GitHub release / updater 或修改既有不可变资产。官网候选下载仍指向现有v0.1.13。物理手机/蜂窝、邮件投递、用户真实业务写入不在当前实测证据中；DEV旧真实链、22项加密业务互操作夹具与这次自部署实际链分别记账。
