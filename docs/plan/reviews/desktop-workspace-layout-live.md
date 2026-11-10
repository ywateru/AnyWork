# 桌面布局产物与本机采用独立验收

日期：2026-11-10。产品源码 `fa40ba19b5a3e7936d36e224f7cc2b62d47c363c`。源码、生产 UI 与 62 项独立回归的结论见 `desktop-workspace-layout-independent.md`。

结论：接受候选产物和文件更新脚本；实际安装后的客户端与服务保留检查通过。主执行者确认实际 Mac WebView 复制成功；审查者没有登录、开启远程、打开真实工作区或读取业务正文。

## 精确产物和脚本

私有操作 `desktop-layout-bfc873f5-a918-471e-8918-b7428cb6ed09`。

| 项目 | SHA-256 |
| --- | --- |
| candidate.json | `33dcc1e5a698032bc90fdd2a688486d0a00753448acd04a318bdb49d08f3a7b6` |
| baseline.json | `9d3d9b782d69639658ab40e995072ae42dd9bc291dffd5482d8c40b672c81e62` |
| 新 Native | `4b042c31c5d04435839c0b4b6d1195877122123d26c296f2ebc5f98838aae063` |
| 保留 server | `8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34` |
| adopt.py | `a8eb4986c10c2d0a0d6c28b1dafbdfe781f1ca20016a9b8a869b7109fb963b14` |
| common.py | `1b726c9f1764213f3440e5e9ea597e20a2aa89d96bac18ae34efbae7808dff09` |

独立核对候选包全部 441 个文件的 hash/mode/symlink 与清单一致；与已安装基线相比，只有 Native 程序、对应源码包和 CodeResources 三个文件改变。server、provider、整个业务 Web 及其他资源字节均未变化。严格 deep codesign 验证通过，签名为 ad-hoc；构建只对包根签名，没有使用 deep 强制签名改写嵌套程序。

私有 source.tar 与上述提交的 Git archive 完全相同；随包源码 offer 的所有文件也与同一 archive 逐字节相同。Native 由这一不可变源码和生产 desktop UI 构建；独立构建得到相同 UI assets `index-Fw6iJxXD.js`、`index-Cz8FTTSK.css`。

脚本独立源码审查及 10 项隔离契约测试通过，覆盖精确三文件范围、保留服务 inode、批准/Native 状态拒绝、不重放、原子替换失败的文件回滚、未知改动拒绝、符号链接父目录、已有 pending 文件保留和未知打开结果不触发回滚。操作只对这三个文件逐个原子替换，CodeResources 最后替换；每步前有 durable journal。失败仅恢复这三份备份，不操作应用目录本身，不恢复数据库、配置或 token，不向服务发信号、不调用服务停止 API、不重启服务。

## 实际采用后的独立检查

主执行者在实际 Native 中重新确认客户端未登录、远程关闭后正常退出旧客户端，再给出绑定精确脚本与产物的批准。执行者只执行一次，退出码 0，journal 为 complete；记录精确三文件替换、安装验证及打开客户端，未记录服务停止/重启。

独立实际核验通过：

- `/Applications/AnyWork.app` 的全部 441 文件与候选清单完全一致，严格 deep 签名验证通过。
- 新 Native PID19611 的实际可执行文件来自安装包，摘要与上表一致；旧 Native PID28129 不再是当前客户端。
- 外部服务仍为 PID28102，完整身份包括启动时间、可执行路径/摘要、argv 和 cwd 均与操作前相同；监听端口仍唯一属于它。
- server 文件设备号 16777233、inode41323315、大小、mode 与 mtime 全部未改变，不仅是内容摘要相同。
- 服务整个内核环境的聚合指纹/键集合与事前完全一致，检查仅在 RAM 中处理环境值；没有输出或保存值。
- manager 与 access-token 的摘要和权限未变。
- 数据库仅用只读/query-only 查询编号和结构。事前 108 个会话 ID 的 SHA-256 全部仍存在；当前数量为 109，不把它误报为固定 108。user_version 仍为 2，完整 schema 摘要不变。未读取业务正文，未断言做过内容逐字节比较。
- 四个无关 cloudflared PID5113/25972/93051/98902 仍存活且为 cloudflared，没有操作它们。

主执行者实际 CUA 检查显示新客户端两栏、本地3210地址及工作原理内容。通过真实点击“复制本地地址”，Mac WebView 显示“本地地址已复制”。随后再次真实点击复制，并立即仅在 RAM 中读回本次写入的剪贴板、与预期无凭据根地址 `http://127.0.0.1:3210/` 比较，于 `2026-11-10T17:09:01.997380+08:00` 返回 true。只输出时间与布尔结果，没有输出或持久保存剪贴板内容，也没有读取复制前的用户剪贴板。源码审查及独立 62 项回归中的边界测试另外验证了端口变化、无 fragment/凭据和复制反馈行为。

本轮只采用本机 Native 布局，不发布公开安装包、不重新部署官网，不新增 OAuth 或远程链路验证。先前账号续期、安全交接和 Android 验证的范围保持原有报告限定。
