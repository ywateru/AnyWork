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

检查使用独立测试资源与已有构建缓存，没有替换运行服务、安装客户端或提交部署。Rust日志为`/tmp/anywork-unified-merged-rust.log`。忽略项不计为通过；构建器保留现有大chunk提示，不影响成功退出。

## 尚待闭合

完整浏览器回归及旧Native界面测试迁移、正式来源与现代Android浏览器登录往返、真实自部署授权跨300秒续期、精确源码发布产物审查，以及运行环境的可回退切换，分别继续执行。本记录不将源码/构建成功描述为已上线或已完成本机更新。
