# 统一账号入口独立审查

## 源码结论

接受 Native/server `09c8cb9`、`13e6496`、`4699e3d` 及 Web/Android `a8e28f7`、`85fe5b0` 的实现源码；当前未发现阻断合并的问题。此结论与最终发布产物、部署、真实登录及跨令牌时限的验收分开记录。

独立审查树以 `94bc583` 设计为基础，依次载入上述提交。Native 的旧匿名/固定域名/WireGuard 操作从 IPC 可反序列化动作、Tauri 命令注册、manager/process 执行及更新恢复路径中移除；本机 bearer 不再序列化到快照，未保留钥匙串读取或旧路径自动恢复。旧配置字段保持惰性，保存时合并原始 JSON，并在首次保存前以私有权限保留原始文件；未知设置不会随 serde 解析丢失。

本机浏览器票据与 Cookie 状态仅保留在 RAM，受容量与单调时钟期限约束，票据在同一 mutex 内一次消费。Cookie 访问要求直接 loopback peer、精确 Host/实际端口、精确 Origin（无 Origin 的 HTTP GET 仅接受 same-origin Fetch Metadata），拒绝转发头；Authorization 存在时不能退回 Cookie，服务控制接口仍要求真正 bearer。PTY 必须先通过来源校验及固定首帧，接收 ACK 后才允许前端输入；退出、过期、服务停止及阻塞发送路径均检查取消/期限并终止子终端。Cookie 不具端口隔离，设计文档已明确本机进程信任边界。

Web 的本地入口使用票据兑换和 Cookie，忽略旧 `ra.connection` 与 Android bridge；本机账号文字只表示打开时的来源快照。远程入口保持同账号目录与设备公钥确认。Android 删除 WebView、VPN、旧连接配置和原生凭据导入路径，以固定 HTTPS 地址打开 Custom Tab/系统浏览器，任意传入 Intent 不控制目标。

`4699e3d` 的 `ANYWORK_CODEX_DATA_DIR` 是可选、显式的解析输入；未设时保持原 CODEX_HOME/HOME 优先次序，不修改进程全局环境。夹具可指定独立临时目录，无需改写 HOME/CODEX_HOME 或访问真实用户目录。

## 独立验证

- 合并 `13e6496` 产品源码后运行 `cargo test -p anywork-desktop -p anywork`：server 191 通过、5 个既有忽略项；Native 37 通过、2 个剩余忽略项，零失败。
- `4699e3d` 的 resolver 优先次序/回退测试独立通过。
- `npm run build:desktop-ui` 通过，包含 TypeScript 与实际生产构建。
- `a8e28f7` 的 Web 独立测试 346 项及私有浏览器状态 Node 测试 8 项通过，Web 生产构建通过；`85fe5b0` 主要补充真实 Cookie 夹具、来源测试和旧入口渲染检查，全面浏览器回归另行记录。
- 原基线的 340 Web + 8 Node、server 185、Native 51、remote 3+7 结果见 `account-unified-baseline.md`，忽略项未当作通过。

## 后续运行与产物验收

源代码验收不代表已替换已安装客户端或部署站点。真实 Cookie/PTY、现代 Android Custom Tab、正式来源下的移动/桌面布局、自托管 Logto 超过原 300 秒时限的续期，以及最终打包字节与回滚方案，继续在隔离资源中检查；尚未完成的项目不在本报告中宣称通过。
