# 自部署账号客户端：本机更新独立验收

日期：2026-11-10，Asia/Shanghai。独立验证者：`verify_entry`；切换执行者：`selfhost_local_update`；安装后 GUI 由 root 单独操作。本报告只覆盖本机候选、操作恢复边界及更新后的保留检查；正式域名登录和加密访问见[自部署切换记录](account-selfhost-cutover-01.md)。

## 受检身份

- 产品源码：`75726758a4c9ffd7e7da4fb45e115bba92803650`，本机版本 `0.1.13`，debug / ad-hoc 签名包。
- 安装后 Native SHA-256：`26ab908f519470083d516ffecdc22a05a94b4b943da3d0cc7a2e3c21b99caad8`。
- Server SHA-256：`fac07443a3e7dffaf4530bdd41ea35d270af255f5ad45da6e1d703610c4add34`。
- 本机源码归档 SHA-256：`d4b89f3ccd13aadbc4e34cb85e6ba32748891511e4ea5c6f120aa6e8b74aa033`。
- Web tree digest：`d88438cbc020d812dc0f7ff59779a0430d6a510df97e0404e3aec5f15762f4e5`。

候选阶段已独立核对 arm64、严格深层签名、423 文件 Web manifest、677 个 Git 文件及生成 manifest 的源码归档、公开自部署配置和已知秘密扫描。接受的产品源码与最终候选产品输入等价；本次没有发布新 release、tag 或 updater 资产。

## 备份失败与精确恢复

第一次操作在旧服务仍运行时的备份验证处停止，未替换任何 live 文件。SQLite 一致备份仍带 WAL header，普通只读打开失败。独立确认旧服务 `0.1.10`、全部107个会话、令牌、manager、安装包、Web、源码及四条原隧道均保持不变。

第一次恢复保留了原失败 journal 与 WAL snapshot 的精确字节，并把新的私有一致快照转为 DELETE 模式。随后在停止旧服务后的最终快照处再次失败：停后 WAL 源没有协调 sidecar，原 `mode=ro` 不能打开。此时安装文件仍未替换。独立再次核对停止边界及完整备份；执行者按 root 指令用原 argv、cwd 和日志路径恢复旧服务，未恢复数据库，独立确认 `0.1.10` 和全部保留项正常。

最终最小修正使用 `mode=rw` 打开既有 SQLite 源并立即设置 `query_only=ON`，允许 SQLite 初始化协调文件，禁止业务 SQL 写入；备份继续使用 SQLite backup API。它不是源文件物理只读的承诺，也没有使用 live DB 的 immutable 读取或顺序复制 DB/WAL。目标快照在私有位置规范为 DELETE 模式并用普通只读连接验证。

精确续接只接受已记录的 restored-service 状态、同一操作与旧进程身份；重新核对原数据、配置、宿主、隧道和所有 staged 产物。原 journal 在任何切换状态写入之前逐字节另存并 fsync，空失败快照也另存。未知或已推进状态拒绝重放，没有再次执行 apply。

最终私有运行器 SHA-256 为 `a1cbd72b00fa4f99f81c8af55973c1e8f28d854418cd1ae720600d2d6f90e3d0`。独立复跑15项临时保护测试全部通过，包括自有 loopback 子进程 HTTP 正常、精确停止、WAL 无 sidecar、旧 RO 真实失败、新备份成功的回归；测试确认源主文件字节与 SELECT 内容保持、业务 INSERT 被拒绝、缺失数据库不会被创建。另覆盖 journal 保护、进程身份改变、未知结果不重放和 rollback 边界。临时测试没有访问真实账号 grant 或业务正文。

## 实际更新检查

独立 postflight 的30项检查全部通过：

| 范围 | 结果 |
| --- | --- |
| 服务 | journal 为 complete；新进程身份、原 argv 与唯一监听相符；HTTP health 为0.1.13，busy 为0 |
| 会话和配置 | 全部107个会话ID与独立更新前基线完全相等；原访问令牌与manager配置摘要相等；无新增公开配置覆盖 |
| 宿主与隧道 | 四条原隧道的 PID/启动身份完全相等；宿主进程与descriptor摘要保持 |
| 安装产物 | app 完整文件树与候选相等，严格深层签名有效；server、权限、Web及源码归档与受检身份一致 |
| 实际 HTTP | source、入口 HTML 及3个入口资源逐字节匹配受检产物 |
| 恢复证据 | 第一次失败 journal、失败 WAL snapshot、停机失败 journal、续接前 journal 均与独立预存摘要相等；空失败快照仍在；最终 DELETE 备份普通只读可读，107个ID精确相等 |

原访问令牌仅在内存中用于本机只读健康/就绪验证，没有输出或写入报告。会话验证只读取ID和数据库schema元数据，没有读取业务正文。本次没有登录或开启用户真实工作区的账号远程访问。

## 安装后启动尝试与最终复核

root 通过系统正常启动了已安装 app，并绑定其精确 PID、启动时间和 executable。随后 CUA 因 Mac 锁屏无法观察界面；没有点击任何按钮，也没有登录或启用真实用户工作区的远程访问。root 只停止了该次启动的自有 GUI 进程。因此安装位置的 GUI 冒烟检查仍未验证，不把启动进程成功记为界面通过；此前相同受检候选在隔离环境及正式默认域名上的实际 GUI 链路见[切换记录](account-selfhost-cutover-01.md)。

此后独立最终14项检查全部通过：更新后的服务 PID 和启动身份保持、仍是唯一监听、版本0.1.13且 busy 为0；107个会话ID、原访问令牌、manager、四条隧道、宿主身份及descriptor均与更新前一致；自有 GUI 已退出、无剩余 desktop 进程、journal 仍 complete，且无新增公开配置覆盖。

结论：本机更新与数据/配置保留验收接受。安装位置的额外 GUI 冒烟检查因锁屏保留为未验证项，不影响已经完成的包身份、实际 HTTP 服务及保留检查。本报告没有扩展为物理手机、邮件投递或真实业务写入验收。
