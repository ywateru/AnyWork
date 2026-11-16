# 手机文件侧栏与菜单关闭修正

2026-11-16，基线 main `38f4e48` / 手机0.1.45 code47。用户要求ADB查看侧栏混乱与菜单外点不隐藏。ADB截图 `artifacts/mobile-sidebar-followup/phone-before.png` 与 `phone-outside-tap.png` 证实文件预览在上、目录筛选在底部、目录项居中，“更多会话工具”外点不关闭。

契约见[手机布局](../../mobile-client-layout.md)。统一文件页顶部工具栏、筛选和目录、底部预览；目录项左对齐、层级缩进、48px触控。检查Mobile通用button与文件树样式级联及DOM顺序；更多与设备浮动菜单接入现有useFloatingMenus，避免另写全局遮罩或折叠普通details。保留短横屏、IME、发送按钮48方形、桌面布局及账号数据。

实现与独立审查分离；审查必须以production MOBILE入口和实际触摸验证外点关闭、内部交互、重开/切页、树项对齐、长路径/窄屏、相关短横屏与IME回归。通过后合并、递增手测候选，官方签名ARM64构建，校验并保留数据覆盖安装ADB手机供用户手测。不发送真实Agent消息、不退出登录、不清数据、不发布正式Release。
