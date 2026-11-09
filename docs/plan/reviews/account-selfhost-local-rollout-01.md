# 自部署 Logto 本机更新记录

日期：2026-11-10（Asia/Shanghai）。本记录只说明已授权的本机应用和既有服务更新；自部署 Logto、CyberGrid、正式网页的真实登录/设备/加密链路另见[总验收记录](account-device-acceptance.md)。本次没有公开 release、tag、updater 或新下载包。

## 已交付结果

`/Applications/AnyWork.app` 与原3210服务均从0.1.10更新到0.1.13。现服务 PID 为 `81502`，保留原工作目录、完整启动参数、workspace/data-dir、端口、访问令牌和日志路径。用户的 manager 配置保持原字节；其 workspace 与服务实际 workspace 不同，未为此次更新改写任一配置。

本机包对应精确产品源码 `75726758a4c9ffd7e7da4fb45e115bba92803650`，采用已经独立接受的 debug 二进制及重新构建的自部署 Web，应用为 ad-hoc 签名。它是本机交付，不是新版本公开分发或 notarization。真实 support 中没有 `account-cloud.json` 覆盖文件，因此客户端使用 `https://auth.x.aixgg.com` 的自部署默认配置。

| 产物 | SHA-256 / 来源 |
| --- | --- |
| 接受的 Native 签名前输入 | `6876924fc0bdc4529a381e477243688dd8ab95b3b18e0ab1033115154ccf428c` |
| 安装应用签名后的 Native 可执行文件 | `26ab908f519470083d516ffecdc22a05a94b4b943da3d0cc7a2e3c21b99caad8` |
| 安装/运行的服务端可执行文件 | `fac07443a3e7dffaf4530bdd41ea35d270af255f5ad45da6e1d703610c4add34` |
| 随包及实际 `/source` 归档 | `d4b89f3ccd13aadbc4e34cb85e6ba32748891511e4ea5c6f120aa6e8b74aa033` |
| Web 文件树摘要 | `d88438cbc020d812dc0f7ff59779a0430d6a510df97e0404e3aec5f15762f4e5` |

Native 输入来自已接受的自部署默认值实现；独立审查提交 `d0edb958e2174c9ce07d384fa8be704f591f3a21` 与上述产品源码在 crates、desktop、web、Cargo/npm 清单及 SDK 路径没有差异。677个公开源码归档成员逐一与精确提交的 Git blob 字节相同。签名前后 Native 摘要差异来自应用签名，不代表另一份产品源码。

## 保留与实际验证

切换前后精确比较原有107个 session ID；更新后仍为107条，未读取或发送用户会话正文。本次没有向既有 Agent 会话发送提示，没有在用户 workspace 登录账号或开启远程访问。

现有访问令牌、manager 配置、host descriptor 及四个 cloudflared 的 PID/启动身份均保持；没有新增账号 grant、私钥文件或 Keychain 保存。原生宿主只核对进程身份与既有描述文件，没有关闭或重启宿主。

作者切换后检查和不同 agent 的30项独立 postflight 均通过；最终独立记录见 [account-local-update-01](account-local-update-01.md)：

- 新 PID/完整 argv/3210唯一 listener、health0.1.13、busy0与107个原 ID。
- 上述令牌、配置、隧道和宿主保持条件；安装应用/服务/Web/source 摘要与候选一致。
- 安装 app 的 arm64 架构与严格 code signature；实际 HTTP index、入口资源和精确 source offer。
- 最终独立 SQLite 快照采用 DELETE journal 模式，普通只读连接可读且107个 ID 与基线一致。
- 下节各次失败/恢复证据的原字节与独立审查前保存的摘要相同。

本记录不把安装包检查当作 GUI 操作证据。安装后的注册/登录入口、未登录/远程关闭状态及退出后外部服务保持，由 root 另行只读 GUI 验收；不能据此声称在用户真实工作区开启过远程访问。

## 备份失败与恢复记录

第一次执行在停服务前的备份阶段停止。SQLite 一致 backup 已产生107条的副本，但副本继承 WAL header；随后作为无侧车的独立文件用普通只读连接打开时报 `OperationalError: unable to open database file`。未停止旧服务、未切换应用文件。修复仅在私有副本上转为 DELETE 模式，验证 header 与普通只读读取，并加入窄化的同操作恢复分支。原失败 journal 和 WAL 副本保留原字节。

经独立审查后，仅执行一次该恢复动作；它完成 staging 并精确停止原 PID `73154`。停机后的源 DB 仍为 WAL 模式，此时源只读连接不能初始化协调文件，最终备份再次停止。此时应用/服务/Web/source 尚未替换；已立即按原 argv/cwd/log 启动旧0.1.10服务（PID `79893`），没有恢复或替换数据库，107个 ID 和其他保持条件再次独立通过。修复审查期间旧服务继续运行。

后续最小修复采用 `mode=rw` 打开既有 SQLite 源文件并设置 `PRAGMA query_only=ON`，允许 SQLite 初始化 WAL/SHM 协调文件，禁止应用 SQL 写入。它不等于源文件物理只读；SQLite 内部协调和正常 checkpoint 仍可发生。快照始终由 SQLite backup API 取得，不顺序复制 live DB/WAL，不对 live DB 使用 immutable 绕过 WAL，也不执行源业务 SQL 写入。

15项纯临时回归通过，包括实际自有 loopback 服务启动、HTTP200、精确停止、自有 fixture WAL checkpoint/关闭后复现旧只读错误，再由修订路径完成 backup；fixture 源 main DB 字节和数据保持、业务 INSERT 被 query_only 拒绝、缺失 DB 不被创建。其他 guard 验证 PID 变化不 signal、未知 listener 不回滚、每次 rename 前的持久 intent、中途失败不重放、恢复拒绝不覆写失败 journal。

独立接受脚本后，同一操作仅执行一次 `continue-restored-service`，绑定 PID `79893`、既有 staged 树与107个 ID等全部保持条件。当前恢复 journal、原 stop 失败 journal、第一次失败 journal/WAL 副本以及零字节最终备份失败文件均保留；随后只停止该精确旧服务，完成最终一致备份、原子替换和新 PID `81502` 启动。没有再次调用 `apply`、盲目重放、数据库回退或丢弃失败证据。

## 证据边界

本机包和备份保存在仓库外私有目录，外层0700、有效数据库快照与状态文件0600；公开记录只含提交、产物摘要和保留数量，不公开访问令牌、账号授权、会话行或数据库内容。备份与操作记录保留供恢复/审计，未自动清理。

本记录不能替代物理手机/蜂窝网络、注册邮件投递或所有用户业务路径的实际验收。正式网页及独立空工作区加密连接的证据与本机保留107会话的更新检查分别记录。
