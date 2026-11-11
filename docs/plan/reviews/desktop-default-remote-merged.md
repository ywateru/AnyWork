# 默认远程与精简控制台：合并检查

日期：2026-11-11。合并候选 `159cf55`；产品源码为已独立接受的 Native `6d0d4c0`、UI `0d16eb1` 和修正 `db2625d2`。作者与[独立审查](desktop-default-remote-independent.md)分别保留精确验证边界。

## 合并结果

- `cargo test --locked -p anywork-desktop --lib`：54 PASS、3 ignored，0失败；包括默认策略、关闭/退出竞态及真实 IPC→SDK 链。
- `cargo build --locked -p anywork` 后执行 `python3 scripts/desktop-host-http-test.py`：20 PASS，关闭作者工作树缺少 server binary 的验证缺口。只启动隔离 fixture，不替换已安装服务。
- `npm run build:desktop-ui`：TypeScript与生产构建通过；最终 JS `index-BbANbFn-.js`、CSS `index-DfVnwZ1X.css` 与独立接受产物一致。
- 合并后的 desktop-access/overview/tunnel 完整回归：84 PASS，两种 Chrome 项目，四尺寸布局、默认开启、失败后的本地可用、手动关闭重载保持、账号入口不吞错误、迟到失败/注销隔离。
- `cargo fmt --all -- --check`、`npm run format:check`、`git diff --check`：通过。

本机当前应用和服务未安装/重启/替换；云端没有付费、配置、数据库或namespace变更。Upstash 月度额度耗尽仍影响真实协调服务，不能将源码验收/发布描述为云端恢复。接下来由精确源码 GitHub Checks 执行完整平台检查，通过后创建下一不可变发行；安装包与网站发布结果由发布器状态记录。
