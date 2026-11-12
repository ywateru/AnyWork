# 开源入口与正式域名：独立审查

日期：2026-11-12，Asia/Shanghai。UI 候选 `874b4a7` **PASS**，无阻塞发现。域名最终候选与协调配置结论见后文；本报告覆盖实现与配置，后续 v0.1.29 正式发布已通过[独立发行验收](open-source-release.md)。

## UI 候选

- 官网双语首屏明确服务端和客户端均开源，GitHub 文字入口在手机上保留；说明源码可审查，没有将开源等同于绝对安全。桌面设置、Web 登录/设备/本机入口及既有工作区设置使用同一公开仓库 `https://github.com/ywateru/AnyWork`。
- 既有 AGPL-3.0-only、对应源码 `/source` 与 tiann/hapi 来源说明保留。设备页移除侧栏重复入口，移动主内容中仍可访问源码。未调整登录、对话或传输逻辑。
- 桌面 `desktop_open_source` 仅打开固定 HTTPS 仓库，Native handler 已注册，无 URL 入参。UI 阻止 WebView 默认导航，调用系统浏览器并呈现失败错误。审查源码与作者构建证据，不声称本次实际点击了安装版的系统浏览器入口。
- 独立运行 Web typecheck、Desktop UI build、官网构建及既有官网检查通过。官网检查覆盖 EN/ZH × 1440/1024/768/390/320、语言协商、交互、静态资源与下载顺序。证据在忽略的 `artifacts/open-source-independent/`。本轮未运行 Cargo，避免与作者共享 target 的检查竞争。
- 独立查看作者 390px 官网首屏、390px 设备页、800px 桌面设置图；说明和链接整齐，无新增横向溢出。作者的账号和桌面合成矩阵记录作为补充证据，不能代替生产登录或真实 Native 业务验收。

## 正式域名：配置执行前复核

独立读取 root 准备的私有候选 `official-domain-20261112/coordinator-candidate.private.json`，重新只读核对供应商当前 alias、READY deployment、生产环境、已有 TLS Redis 候选、精确产物和 CLI：**PASS，可由 root 按既有预构建发布流程执行此精确候选**。

- 当前正式协调 alias 仍指向 `dpl_7Xvjo9kSsDNoWycj57W4zLyP4Xz4`，项目和 READY 状态正确。候选仅在 `CYBERGRID_BROWSER_ORIGINS` 尾部添加 `https://anywork.aixgg.com`；所有原有 origin、Redis URL/transport/prefix 和其余环境值逐项不变。
- 产物、adapted source `c923cc232e74e4aff78fa3c82916ce9fb9a283b5`、上游与补丁摘要与当前供应商部署 metadata 一致，预构建产物重新校验通过；所用 CLI 文件和整棵工具目录摘要与此前接受的 TLS 切换候选一致。没有部署新 CyberGrid 服务端源码。
- Vercel 域名接口读回 `anywork.aixgg.com` verified=true；实际受信任 HTTPS `/build.json` HTTP200，仍为上一版本 0.1.28 的精确 source。
- Logto SPA live GET 与 root 的变更前快照逐项比较：恰好新增新域名 callback、logout URI、CORS origin 三项，其余旧入口及应用字段完全相同。
- 全程只读供应商和公开 HTTPS；未调用部署、namespace 初始化或 Redis 读写。脱敏结果在 `artifacts/open-source-independent/cloud-preapply.json`。执行后仍需复核新协调部署身份、环境、正反向 CORS、登录重定向和正式网站精确源码。

## 最终域名源码候选：PASS

已将 `e0c093c`（包含 `f7d68b7`）合入隔离 review 树，UI 与域名组合审查无阻塞发现。官网 canonical、发布核验、Web/Native/Android 默认入口、部署脚本默认值及当前指南使用 `https://anywork.aixgg.com`；旧域名仅在严格升级兼容代码与历史证据中保留，不批量改写历史。

- Native 新文件存在时首先验证并返回，不读取旧文件。仅当新文件不存在且新配置的六项身份/协调信任字段及新域名全部精确匹配官方固定绑定，才按同 support、同 subject 计算旧官方配置路径，复制其中有效的公开 installation UUID。旧文件保留；普通文件、大小、deny-unknown JSON、UUID 与禁止 symlink 校验沿用，旧记录损坏即失败，不产生新记录。
- 只有公开 UUID 被延续；SDK 的全配置 namespace hash、gateway 单一配置 Origin 验证保持原实现。没有读取或迁移 key、token、grant。旧目录项对应 UUID 保留，因此 Web 修改的设备名称可继续保留；本地名称仍在独立文件中。其他配置/账户/support 目录不建立别名。
- 独立在共享 target 串行运行 5 项官方域名升级测试，以及已有的完整配置隔离、损坏/symlink 拒绝、旧 Cloud 账户隔离各 1 项：**8 passed / 0 failed**。没有执行作者代码以外的临时迁移，没有启动安装版或用户服务。日志为 `native-domain-migration.log`、`native-config-isolation.log`、`native-storage-boundary.log`、`native-owner-isolation.log`。
- 独立运行 4 项 Web accountConfig 测试、7 项前端部署配置测试和既有 publisher 离线回归通过。组合 Web build/PWA 及本机/Web入口 1440/390 render fixture 通过；后者最初缺本工作树 Web dist 前置产物，构建实际候选及完整公开配置后复跑成功，未改测试。再次构建官网并执行双语 5 宽度既有检查，包含 canonical 新域名断言，通过。
- P3 / non-blocking 兼容边界：旧版正在运行的宿主仍按旧 Origin 验证，新域名访问需更新并重启新版客户端；明确的自部署 `account-cloud.json` 继续优先，不被默认域名替换。应在本轮发布说明保留升级提示。源码与合成边界通过不等于真实安装升级、真实用户登录或完整加密业务链验收。

## 协调配置执行后：PASS

独立只读验证新 READY deployment `dpl_7TSSCHxqypSjpvNmawUyyUYdaw1J`：项目、正式 alias、operation metadata 与精确已审候选匹配，生产环境逐项完全等于候选 desiredEnvironment；旧 READY deployment 保留。仅追加新浏览器 origin，原服务端代码、产物及 TLS Redis 配置不变。

实际公开 `/healthz` 返回 200/`ok`。对 `/api/v1/console/auth/config` 的 OPTIONS：新域名和旧域名分别返回204及精确自身 ACAO，未授权 origin 返回403且无 ACAO。Logto 用新域名 `/app/callback` 发起匿名授权，返回正确身份服务 `/sign-in` 重定向；未输入凭据、建立用户授权或操作业务数据。GitHub `VITE_ACCOUNT_PORTAL_URL` 实际 repository var 读回新正式 `/app/` 地址。

脱敏证据 `artifacts/open-source-independent/cloud-postapply.json`。首次公开 CORS 请求遇传输连接重置，保留原失败后以最多三次只读请求预算复测，最终完成；没有因此重试部署或执行 Redis 命令。正式网站/安装包的精确新版本发布仍由 root 按既有流程完成并核验。
