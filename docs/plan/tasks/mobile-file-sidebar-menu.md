# 手机文件侧栏与菜单关闭修正

2026-11-16，基线 main `38f4e48` / 手机0.1.45 code47。用户要求ADB查看侧栏混乱与菜单外点不隐藏。ADB截图 `artifacts/mobile-sidebar-followup/phone-before.png` 与 `phone-outside-tap.png` 证实文件预览在上、目录筛选在底部、目录项居中，“更多会话工具”外点不关闭。

契约见[手机布局](../../mobile-client-layout.md)。统一文件页顶部工具栏、筛选和目录、底部预览；目录项左对齐、层级缩进、48px触控。检查Mobile通用button与文件树样式级联及DOM顺序；更多与设备浮动菜单接入现有useFloatingMenus，避免另写全局遮罩或折叠普通details。保留短横屏、IME、发送按钮48方形、桌面布局及账号数据。

实现与独立审查分离；审查必须以production MOBILE入口和实际触摸验证外点关闭、内部交互、重开/切页、树项对齐、长路径/窄屏、相关短横屏与IME回归。通过后合并、递增手测候选，官方签名ARM64构建，校验并保留数据覆盖安装ADB手机供用户手测。不发送真实Agent消息、不退出登录、不清数据、不发布正式Release。

## 独立基线复现

`af03453` 的production MOBILE入口在320/412px均测得导航底部y136、工作区顶部y137、文件面板顶部y180：共享高特异性规则使inspector仍为absolute/inset43px，额外空白43px。关闭面板与launcher实际28×48px，320px首标签被挤出视口。目录位于预览下方且项目居中；trusted touch外点更多菜单仍展开。同一修正断言在基线上预期失败。此处为合成Native夹具与生产入口的运行证据，与真实ADB截图分开记录；不是正常账号功能验收。

## 合并与候选

作者候选 `bc649b3` 已由[独立审查](../reviews/mobile-file-sidebar-menu-independent.md)接受并合入main。独立production MOBILE文件/菜单/顶部探针10项、顶部实际触摸1项、原短横屏IME trusted-touch3项通过；43px空白消除、关键关闭/launcher为48×48、目录在预览上方且左对齐。新菜单测试程序互斥的原生toggle等待竞态交作者test-only收口，不改产品行为。

下一手测候选版本 **0.1.46 / Android code48**，保留官方单签名、ARM64与原账号数据。最终冻结后记录完整Mobile回归、APK实际JS/CSS与源码匹配、同签名覆盖安装和ADB效果截图；公开Release与正常账号功能验收分开。
