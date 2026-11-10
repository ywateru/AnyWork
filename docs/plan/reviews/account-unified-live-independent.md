# 统一账号上线独立核验

日期：2026-11-10。冻结产品源码：`113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f`。

结论：Vercel 正式发布和 Mac 实际安装/运行独立核验通过。执行者在明确批准下完成单次发布和受保护恢复；审查者仅查询结果，没有再次执行任何部署、停止、信号、安装或登录动作。

## Vercel 实际结果

独立通过只读 provider API 确认正式 alias 指向 `dpl_4oLgPXaayTg2SLBwPETAEqpKVxor`，状态 READY、production。metadata 中源码、操作 `31796362-a34d-477b-b371-dcbb052b559b` 和产物摘要 `6644fac07270833d21fb6e8aee1c23c9d01bfce23edfde24c922a31db99ecd80` 与事前审查一致。

独立访问正式域名的结果：

- `/build.json` 返回冻结源码与版本 0.1.13，字节与候选产物一致，Cache-Control 为 no-store。
- `/app/`、首页、中文/英文首页和 SW 与候选文件逐字节一致；正式 CSP 与已审查配置一致，回调 no-store，SW no-cache。
- 根路径及 `/app/` 的 codex-light 图片均为 HTTP 200、image/png、有效 PNG，摘要都为 `9bf3504d6de7da6982b27527a8e414f48b84969e4f62aa3ca44c750559751037`。
- `/source` 返回已审查源码包，摘要为 `b34588b2adde46285b73328569fb0980a869e58ac197fa557c08fe3529daeca8`；该包与冻结的公开源码导出策略一致，没有运行时数据或私有操作目录。
- 独立全新 Chrome 上下文在 1440 和 390 宽度访问实际线上 app/中文首页，登录入口可见、旧地址输入表单不存在、安装包更新提示可见，无横向溢出或 JavaScript 错误。

这些检查没有实际登录、访问用户设备目录或改变 SSO 状态。它们不替代真实移动设备登录回程或公共 Native 隧道组合测试。

## Mac 操作修正审查

第一次执行在任何停止、复制或 journal checkpoint 前发现 runtime workspace 与 manager workspace 不同而中止。原进程、listener 和安装包保持原状。独立检查确认改动应保留两个已有值：manager workspace 为 `/Users/water`，外部服务实际 argv/API workspace 为项目目录。

修正仅影响私有操作元数据与校验：原 manager 文件摘要和字段检查保留；独立固定 `runtimeWorkspace` 用于原服务 API、原 argv 和新服务健康检查。产品包全部字段/字节未改变。原清单、脚本与批准文件精确归档，旧批准移除，重新批准绑定以下摘要：

| 项目 | SHA-256 |
| --- | --- |
| candidate-v2.json | `8369300577e1ccea6d186acd3ba788fc14924cf0d4762f572f75801e7f7b8b33` |
| baseline-v2.json | `1f3a2d3559e03786fecf131bc8652d1c41d1deccfb082b26398d52fd38985215` |
| switch.py | `2cafab4808964edffd425f212c0205f53217ce9898978c66cb63d8e271d2eb43` |

独立运行 14 个操作契约测试通过。事前状态检查确认为 not-started、无 pending checkpoint、原 listener 仅属于 PID81502。

第二次执行获得停止 ACK 后端口释放，但原进程未退出，操作正确停止，未替换应用。独立检查发现原服务仍有一个连接经既有 ClashX 进程转发，catalog 子进程仍属原服务；源码在 HTTP graceful drain 后才关闭 catalog，不能仅因端口释放就认为原进程退出或已恢复。原进程身份、RAM 环境指纹、manager 与 token 在后续只读检查中仍匹配；没有重复 API stop，也没有由审查者发信号。

受保护恢复脚本最终摘要为 `b97813832fc97178dd69016563947a8c4ce3b92341d5cc641895c44fc09dbd17`，恢复基线摘要 `c4150af234370f05afbca1d524ba656b510d94d35107e207488a6d0e92a825bd`，独立 7 个契约测试通过。其执行前再次核验精确原服务身份、原环境指纹、无 listener、无未知后代/PTY、旧包/暂存新包、数据编号/结构及原停止记录。只有新的明确批准允许向 PID81502 发一次 SIGKILL；仅在精确的 catalog81545 成为孤儿、无后代/PTY 且仍存活时允许一次 SIGTERM。不会操作进程组、共享 ClashX 或其他隧道。启动和同次回滚使用原 RAM 环境，不恢复 DB/config/token；catalog 清理未确认、启动结果未知或新子进程归属不明时禁止自动恢复启动。

## Mac 最终实际结果

恢复执行者在绑定最终脚本的新批准下执行一次，退出码 0，durable journal 为 complete。记录显示精确旧进程一次 SIGKILL、确认退出、保留旧应用、安装候选、确认新进程身份/健康、打开新 Native。catalog 子进程随旧进程退出而自行结束，没有发出 catalog SIGTERM。

独立实际检查均通过：

- `/Applications/AnyWork.app` 全部 441 个文件与 candidate-v2 的 hash/mode/symlink 清单完全一致，严格 deep codesign 通过。
- 新服务 PID28102 的完整进程身份与 journal 一致，可执行文件就是包内 server，摘要为 `8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34`；3210 listener 唯一属于它。原 argv 仅程序位置和 Web 目录按计划改变，cwd、workspace、数据目录与 bind 保留。
- Native PID28129 来自实际安装包，可执行文件摘要为 `e93ef4c9d8bbe8c4b0da19c20a279a8e4040b830747e9f4ae11dff6420f8ad63`。
- manager 与 access-token 的文件摘要、token 的 0600 权限与事前一致。新服务整个内核环境在 RAM 中重新读取，聚合指纹与原进程环境基线完全相同；环境值没有输出或持久保存。
- 使用原 bearer 的直接 `/api/info` 检查通过，实际 runtime workspace 保留，`local_browser_session:true`。此查询不建立本机浏览器会话，不读取用户工作内容。
- 旧服务 PID81502 与 catalog81545 已退出，四个无关 cloudflared PID 均仍存活。

## 数据与既有进程的核验口径

数据库仅用 `mode=ro` 和 `query_only` 查询 session ID、schema 与 user_version，不读取业务内容。事前保存的 108 个 UTF-8 ID SHA-256 均在实际 DB 中，user_version 为 2。schema 摘要使用以下固定序列化匹配事前记录：`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`，结果用 JSON 紧凑分隔符后计算 SHA-256，等于 `12286a29305db648eeb178db2b8103c2933c3452df91a75e384273293f2ed656`。

既有四个无关 cloudflared PID5113/25972/93051/98902 在独立检查中均存活且 comm 为 cloudflared。没有其事前可执行文件摘要，不宣称逐字节身份未变，也没有操作共享代理或这些隧道。

恢复完成后独立重复同样的只读核验：仍为 108 个会话 ID，事前 108 个 ID hash 全部保留；user_version 为 2，完整 schema 摘要不变。该结论限定于编号和结构的保留，没有读取业务正文或声称做过内容逐字节比较。

现代 API36 emulator 继续保持关闭，没有为本次验收额外分配 userdata 或删除用户/共享缓存。真实自托管登录及 688 秒续期证据、公共隧道和 Android 完整登录回程的限制继续以 `account-unified-runtime-artifacts.md` 为准；本次上线检查没有扩大这些已验证范围。
