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

## 固定构建的完整浏览器回归

作者将`fb0d10e`的Web构建与`4699e3d`的新服务复制后固定，以两个独立临时服务和数据目录同时运行桌面、移动项目，合计572项。结果为570通过、1个既有跳过、1个测试提示条遮挡失败；`1d341ed`只增加等待实际轮询完成提示条后再关闭的步骤，经独立审查接受，并在同一份未重建产物上对两个项目定向复验2项通过。其中一个复验与已通过的移动用例重叠，闭合后为571个唯一场景通过、1个既有跳过，不能描述为一次572项全绿。未因这个测试专用修订重复整个套件。

固定验收目录：`/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-unified-fb0d10e-84495_c5`。此前探索运行发现的旧事件接口、离线入口和手动令牌假设均已迁移；探索期间曾重建过资源，因此不用于证明最终固定产物。Native独立36项另行统计。

## 后续验收与上线

上述检查当时没有执行发布或本机更新。随后完成的真实自部署授权续期、精确源码产物审查见[运行与产物独立验收](account-unified-runtime-artifacts.md)，实际发布见[正式 Web 上线记录](account-unified-web-live.md)与[Mac 本机上线记录](account-unified-native-live.md)。现代 Android 浏览器内完整登录回程、实体手机网络切换，以及公共隧道下完整 Native→正式 Web 组合的验证限制仍保留，不据此宣称全部实机场景通过。
