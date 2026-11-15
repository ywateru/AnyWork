# v41 review fixture 数据库路径修复：作者验证

基线 `4ab61ff`（Release v0.1.40）。此提交仅修正 `scripts/review-test.py::Review.test_last_turn_is_not_a_git_comparison` 选择fixture数据库的路径，不修改生产行为、断言、lint、依赖、版本或发布配置。

## 原因与最小修复

原 `next((self.base/"data").glob("*.sqlite*"))` 同时可匹配主SQLite文件及WAL/SHM旁文件，且没有保证首个匹配项为主数据库；若选中旁文件，后续INSERT可报 `file is not a database`。生产 `crates/server/src/main.rs` 明确打开 `data_dir.join("remote-agent.sqlite")`，schema启用WAL，同一fixture其它直接数据库操作也使用该固定文件名。

将路径明确为 `self.base/"data"/"remote-agent.sqlite"`，保留两次INSERT及所有last-turn/session隔离断言。这消除测试对目录枚举顺序的依赖，无需重试、删除WAL或改变数据库模式。此源码分析与CI错误相符；本机没有记录失败CI实际选中的文件名，不将推断写成已采集到的CI现场证据。

## 验证与边界

先核对 `scripts/integration-test.py::Integration.start`：binary优先取ANYWORK_BINARY，其次REMOTE_AGENT_BINARY，默认当前仓库target/debug/anywork。fixture启动自己的临时loopback服务、数据目录、Git仓库与fake-agent插件，关闭codex discovery；不连接用户会话。测试类teardown结束自有进程并清理临时目录。

按授权复用root已构建的 `target/debug/anywork`，未复制binary/依赖、未运行Cargo或重编译。该binary自报 `anywork 0.1.37`，SHA256 `4a3f725939bae2bed338ade1e83e59306d3a2602232a157d49e05ef8a38dfe7a`；不能将本机结果说成基线0.1.40精确源binary验证，后者由精确源CI补全。

- 设置ANYWORK_BINARY指向上述现有binary，并运行 `PYTHONDONTWRITEBYTECODE=1 python3 scripts/review-test.py -v`：13 tests passed，9.342秒，包含原失败的 `test_last_turn_is_not_a_git_comparison`。原脚本的完整13项执行一次，未重复广泛套件。
- `git diff --check`：通过。

小证据仅存本作者WT ignored `artifacts/v41-review-fixture/binary.json` 与 `review-test.log`。测试命令已退出，未操作主分支、远端发布、设备、用户真实宿主服务或凭据。
