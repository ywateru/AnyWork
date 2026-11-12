# 开源入口与正式域名：独立审查

日期：2026-11-12，Asia/Shanghai。UI 候选 `874b4a7` **PASS**，无阻塞发现。正式域名源码与发布验收仍待后续候选，本节不表示新版已发布。

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

## 尚待接受

域名候选 `f7d68b7` 的默认 frontend origin 会改变现有配置 namespace 和公开 installation UUID，root 已要求作者增加严格限定的官方域名 UUID 连续性修正；该首个域名候选不作为最终接受。SDK namespace/gateway Origin 继续隔离，旧版运行宿主访问新域名需升级，完整覆盖与迁移说明将在最终候选复核后记录。
