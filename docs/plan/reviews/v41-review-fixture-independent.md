# v41 review fixture 数据库路径独立审查

日期：2026-11-15。非作者 reviewer，精确审查 `9398398c269bd10f8207094ef3a3fcf0e4ad5124`，父提交为 v40 发布源码 `4ab61ff9721267e0a5bf5533b0feda8a2d9bb745`。

**结论：接受（PASS），无源码阻断项。** 精确数据库路径修复与生产 fixture 契约一致，未削弱原测试。作者现有 binary 的 targeted 验证可作为局部兼容证据；新版本精确源码构建、完整 CI 与发行验收仍待完成。

## 两次失败与证据边界

v40 [Checks 43691054293](https://github.com/ywateru/AnyWork/actions/runs/43691054293) 的 attempt 1 / job `132741601170`、attempt 2 / job `132744924657` 均在 `./scripts/check.sh` 的 `python3 scripts/review-test.py` 阶段失败。相同测试 `Review.test_last_turn_is_not_a_git_comparison` 在第 221 行插入 event 时抛出 `sqlite3.DatabaseError: file is not a database`，13 项中 1 error，exit 1。授权的单次失败任务重试未通过，没有继续重试。

旧表达式 `next((self.base/"data").glob("*.sqlite*"))` 会同时匹配主数据库和 WAL/SHM sidecar，没有保证主数据库排首。生产代码启用 WAL，故该选择方式存在明确隐患，与异常相符；**两次 CI 日志都没有记录实际选中的文件名，不能把误选 sidecar 写成直接采集到的现场事实**。本次接受的是消除选库歧义，不宣称已补获缺失的现场文件名证据。

两个 attempt 的完整失败日志、步骤 JSON、摘录与分析保留在 reviewer WT ignored `artifacts/v40-release-independent/`；attempt 1 为 `checks-server-web.log` / `checks-failure-analysis.json`，attempt 2 为 `checks-attempt-2-server-web.log` / `checks-attempt-2-failure-analysis.json`。

## 最小修改与断言

完整作者提交仅修改 `scripts/review-test.py` 的一行路径和新增作者报告；生产行为、依赖、版本、发布配置、lint 与断言均未改。

- 新路径 `self.base/"data"/"remote-agent.sqlite"` 与同提交 `crates/server/src/main.rs:395` 的 `Store::open(&data_dir.join("remote-agent.sqlite"))` 一致；`store/schema.rs:95` 继续启用 WAL。同套 `test_live_steer_keeps_the_current_aggregate_patch` 第 204 行也使用该精确路径。
- 原测试中的两个 session、无 last-turn 时 diff 为空、注入 first turn 与 aggregate patch、另一 session 保持隔离、注入 second turn 后 diff 重置，全部断言和 event 写入原样保留。只改变 fixture 数据源选择，未跳过失败路径或改为无条件成功。
- 不再依赖目录枚举顺序，不删除 WAL/SHM、不关闭 WAL、不增加重试或捕获异常。若固定路径没有正确的 fixture schema，原有 INSERT 仍会失败，不会因连接了新建空数据库而静默通过。

独立 `git show --check 9398398c269bd10f8207094ef3a3fcf0e4ad5124` 通过，路径表达式沿用同文件既有格式。未 cherry-pick 修复，也未修改产品源码。

## 作者真实 binary 验证与限制

只读核对作者 WT `.worktrees/v41-review-fixture/artifacts/v41-review-fixture/` 中的 `binary.json` 与 `review-test.log`：复用根目录现有 `target/debug/anywork`，53,205,144 bytes，SHA-256 `4a3f725939bae2bed338ade1e83e59306d3a2602232a157d49e05ef8a38dfe7a`，自报 **anywork 0.1.37**，未重建。完整原脚本 **13 项全部通过，9.342 秒**，包含原失败测试。上述为作者执行记录，reviewer 没有重复运行、重新计算 binary 摘要或启动服务。

独立读取 fixture 启动代码：`ANYWORK_BINARY` 优先于 `REMOTE_AGENT_BINARY` 和默认路径；测试使用独立临时目录、随机 loopback 端口、fake-agent 插件和 `--codex-discovery false`，teardown 结束自建进程并清理临时目录。Review.start 将 CODEX_HOME 指向该临时目录。验证对象是实际本地服务 binary，并非仅语法检查；但 **0.1.37 binary 的通过不能称为 0.1.40 或即将发布 0.1.41 精确源码 binary 已通过**，更不能替代新源码完整 CI。

## 隔离与后续门槛

本次只读源码、日志和元数据，未重跑 13 项测试、未运行 Cargo/构建、未启动监控、未接触设备、真实宿主或账号。main、tag、publisher 和远端任务未修改。报告提交仅含本文件，位于 `.worktrees/v39-release-verify` / `codex/v39-release-verify`。

parent 可合入最小修复后按既有 publisher 流程产生 v0.1.41 / code43 和新的精确 SHA；只有新源码 Checks 及全部发行门禁通过后，才能开始正式附件和官网验收。v40 两次失败仍为失败，不以本次局部成功改写历史。TLS 实体修复与剩余协调网络限制继续分别记录。
