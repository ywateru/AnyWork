# Desktop 首次登录后远程开启：作者验证

状态：三个候选修复已提交，用户截图故障尚未完成真实环境闭环。工作树 `codex/desktop-login-remote`，基线 `1646430`。没有修改外部服务、DNS、Android 或发布配置。

## 候选与证据

按顺序应用：

| 提交 | 变更 | 证据与适用边界 |
| --- | --- | --- |
| `e711a7c` | Desktop GridAuthorization 接受 SDK 合法的强制刷新请求 | 固定 SDK 会在自然过期/协调恢复时以非 AuthorizationRejected 原因请求 force_refresh；旧 guard 错误拒绝。六组 reason×force 请求实际轮换隔离 grant，旧代码失败，新代码通过。不能解释新登录第一次 Connect/force=false 的失败。Hilbert 已独立接受此提交。 |
| `9704b1d` | 远程开启前置错误以固定阶段码穿过真实 Tauri IPC，UI 保留具体指引 | 旧 Rust 本地化错误经过 TS 白名单后落回通用提示。实际 handler 测试覆盖缺登录、需重登、本地服务未就绪、待清理、取消、已开启及配置阶段失败，返回精确 JSON String，且前置失败不新增注册/目录写入。这是诊断修正，本身不算截图故障修复。 |
| `1f4db0f` | 成功准备 workspace 后使更早的探针失效 | 已复现真实 HTTP 旧失败探针排队，prepare 经认证成功后旧事件覆盖 authorized/Running，造成远程开启前置 LOCAL_SERVICE_NOT_READY。旧代码定向测试失败；修复后迟到事件被 generation 拒绝，并能实际完成隔离 Native SDK 注册及 Account API 目录写入。也验证后续新失败仍降为不可用、换 host 后旧成功不能授权新 host。 |

Manager 产品修改只在成功通过 `/api/info` 身份与 capability 校验之后调用既有 `reset_probe()`，并重新计探测间隔；不跳过服务校验、不重试授权、不更改未知结果处理。该竞态适用于重用已有本地服务/再次准备等路径；自行启动新服务的路径已有探针重置，不能泛称所有首次启动都受影响。

## 已检查与未证明的假设

- Desktop 已能初始化缺失/null 的账号目录；Web 普通登录读取目录，不自动执行初始化 PATCH。固定 CyberGrid Native exchange 从已验证 JWT 构造用户，没有必须先 console 登录的源码前提。没有证据要求服务侧先创建用户。
- Native 与 Web 初始 scope 存在 email 差异，但没有证据将其与远程开启失败关联，未扩大权限。
- 只读确认安装与运行路径为 `/Applications/AnyWork.app`、版本 0.1.34。既有进程输出指向 `/dev/null`，可查统一日志中没有当次固定阶段码，无法认定当次错误发生在前置检查、配置请求或网络阶段。安装二进制含 Rust 阶段标记，也不能据此证明其嵌入 UI 与当前源码完全一致。
- 显式无认证公网探针输出 `PUBLIC_CONFIG_PROBE sdk=ok binding=true native=http_200`，说明当时开发机上的固定 SDK 与 Desktop HTTP 客户端都能请求生产公开配置。不证明用户报错时或中国手机直连网络可达；官网 custom domain、Grid vercel.app、浏览器/Native 代理差异仍未排除。未更改域名或代理策略。
- 没有读取真实 token/账号存储正文、操作业务会话、退出登录、开启用户远程或重启原有应用/服务。所有注册、刷新和目录写入测试均为隔离夹具。

## 作者验证

工作目录为本 author worktree。Rust 命令统一使用主 `CARGO_TARGET_DIR`，并设置 `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2`；与其他构建方协调串行使用。

```sh
cargo test --offline --locked -p anywork-desktop --lib workspace_preparation_fences_older_probe_results_before_remote_enable -- --nocapture
cargo test --offline --locked -p anywork-desktop --lib
cargo clippy --offline --locked -p anywork-desktop --all-targets -- -D warnings
cargo fmt -p anywork-desktop -- --check
npm run build:desktop-ui
node desktop/ui/scripts/account-entry-check.mjs
```

- 最终 manager 定向：1 passed。
- 最终 Desktop lib：86 passed、0 failed、3 ignored，36.26 秒。
- UI TypeScript/Vite 构建及账号入口 browser check 通过；检查包含新增前置码和敏感错误抑制。
- 三项默认 ignored：显式公网配置诊断、官方 cloudflared 下载验证、发布更新安装验证；本轮仅另行运行了无账号的公网配置诊断，结果见上。
- 最终严格 clippy（Desktop all-targets、`-D warnings`）通过，27.21 秒；cargo fmt 和 git diff --check 通过。

## 剩余验收边界

Hilbert 复核完整三个提交的精确候选；作者夹具从合成的已授予 owner 开始，不等于真实首次 OAuth→commit→enable 的用户验收。当前修复解决了已复现的 SDK refresh 契约错误、manager readiness 竞态，并改善后续失败定位；不能宣称“先 Web 登录才可开启”的用户截图已经由其中一项解释。仍需获得报错时的固定阶段码/脱敏网络分类，才能区分 coordfetch/代理可达性、授权 owner 前置状态与本地 readiness，避免把等待时序与 Web 登录误判成因果。
