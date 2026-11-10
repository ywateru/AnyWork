# 统一账号入口合并检查

日期：2026-11-10。受检合并源码：`abf59ad2f56b3c929ff915f4e9b5b748254d54f4`。Native/server与Web/Android分别独立接受后，以保留分支历史的方式合入main，没有合并冲突。独立源码结论见[审查记录](account-unified-independent.md)。

## 合并后检查

| 检查 | 实际结果 |
| --- | --- |
| `cargo test --locked --offline -p anywork -p anywork-desktop -p anywork-remote` | server192通过、5个既有忽略；Native37通过、2个既有忽略；remote3项协议和7项网关通过，零失败 |
| `npm test` | 37个文件、346项Web测试及8项私有浏览器状态测试全部通过 |
| `npm run build` | TypeScript、生产构建及PWA生成通过；API不缓存 |
| `npm run build:desktop-ui` | TypeScript与Native UI生产构建通过 |
| `npm run format:check` | 通过 |
| `node scripts/local-browser-session-check.mjs <4699e3d的新服务>` | 真实HTTP、Chrome Cookie、单用/容量/来源校验、刷新、PTY ACK/输出与退出取消通过；没有使用真实用户服务 |

后续测试专用提交`a8bad5b`经独立审查接受并合入，替换已退役的桌面线路界面测试。新测试为18个统一工作区/账号场景×两个浏览器项目，作者实际运行36项全部通过、没有跳过；独立审查确认构建后的真实UI通过严格合成IPC执行，覆盖外部服务所有权、手动重试、显式远程启用、取消/重新认证和四种视口。此证据不等于真实Native OAuth。

`fb0d10e`的历史重置修订及下载说明经独立源码审查后合入`7f48ee2`。合并后再次执行完整Web测试、生产构建和格式检查：350项Web、8项Node全部通过；TypeScript、PWA和格式通过。四项新增回归覆盖已反映的迟到重置、未反映的更新重置、来源变化与首次读取期间出现的实时事件。Rust及Native代码没有在此后续中变化。最终浏览器运行使用只读复制的固定构建，桌面/移动各自独立服务和数据目录，不复用早先曾混入重建资源的探索运行作为最终产物证据。

检查使用独立测试资源与已有构建缓存，没有替换运行服务、安装客户端或提交部署。Rust日志为`/tmp/anywork-unified-merged-rust.log`。忽略项不计为通过；构建器保留现有大chunk提示，不影响成功退出。

## 尚待闭合

完整浏览器回归及旧Native界面测试迁移、正式来源与现代Android浏览器登录往返、真实自部署授权跨300秒续期、精确源码发布产物审查，以及运行环境的可回退切换，分别继续执行。本记录不将源码/构建成功描述为已上线或已完成本机更新。
