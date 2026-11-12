# 开源说明与正式域名：独立发行验收

日期：2026-11-12，Asia/Shanghai。发行源码固定为 `17679e4f01e0ced8946b5dfa8456bbe56bd84c45` / v0.1.29。**第一、第二阶段均 PASS；v0.1.29 正式发行与新域名线上交付已独立核验。** 源码与配置前后审查见[实现独立报告](open-source-ui.md)。

## 第一阶段：正式新域名与匿名页面

仅只读检查真实线上与新浏览器隔离上下文，不输入账号凭据、不写用户业务数据、不运行发布器 mutation、不操作已安装应用。

| 检查 | 独立结果 |
| --- | --- |
| 精确网站来源 | `https://anywork.aixgg.com/build.json` HTTP200，version 0.1.29、source 精确为 `17679e4f01e0ced8946b5dfa8456bbe56bd84c45`。 |
| 官网双语与响应布局 | 实际 EN/ZH × 1440/390 页面均显示服务端与客户端开源声明、可审查数据安全与隐私实现说明，以及可见的 `https://github.com/ywateru/AnyWork` 文字链接；canonical 分别为新域名 `/en/` 与 `/zh/`，无横向溢出或 page error。 |
| 实际 Web 入口 | 同样四种语言/宽度组合的 `/app/` 显示开源说明、GitHub 与 `/source`。实际六角 logo decode 成功；独立检查代表性首屏图，说明和链接布局整齐。 |
| 实际匿名登录跳转 | 四组均实际点击登录，捕获身份服务授权请求的 `redirect_uri=https://anywork.aixgg.com/app/callback`，到达正确 `https://auth.x.aixgg.com/sign-in` 密码页。未提交凭据，不等同于完整真实用户授权、Native 或远程工作区链路验收。 |
| 对应源码入口 | 实际 `/source` HEAD HTTP200、application/gzip、10,134,561 bytes，真实 Web 保留 `/source` 链接。完整最终归档内容将在第二阶段核对；HEAD 不作为内容验收。 |
| 发行中下载状态 | 此时 `/release.json` 仍为 v0.1.28，root publisher 尚在 checks，本阶段记录 pending；最终需变成 v0.1.29，不把发行中间状态说成已完成。 |

证据在忽略的 `artifacts/open-source-release-independent/`：`phase-one.mjs`、`phase-one.json`、`phase-one.log`、网站与入口截图、`stage-one-metadata.json`。实际初次网站部署为 [43193643390](https://github.com/ywateru/AnyWork/actions/runs/43193643390)，root 通知精确源码完成；独立来源判断以真实 `/build.json` 为准。

## 第二阶段

收到 root 正常发布器完成通知前，独立观察器已只读观察同一版本和源码进入 `complete`，随后自动执行下列验收，全部通过；未调用任何发布 mutation。

| 检查 | 独立结果 |
| --- | --- |
| 既有发行核验 | `python3 scripts/publish.py --verify-existing v0.1.29` exit0，发行、网站及 source 均 verified。 |
| 不可变来源 | 实际 GitHub tag 解引用精确到 `17679e4f01e0ced8946b5dfa8456bbe56bd84c45`；实际 `/build.json` 为相同 source /0.1.29；稳定 release 非 draft、非 prerelease。 |
| 全部发行资产 | 实际 release 恰好20 assets，与既有发布器资产集合一致；`SHA256SUMS` 19条无重复，各条与 GitHub资产 digest 一致；独立下载 `SHA256SUMS` 和 `latest.json` 并对其 digest 作比对。 |
| 桌面更新元数据 | `latest.json` 为0.1.29，5个平台目标齐全，URL均属于本次固定 tag；5个签名元数据都绑定0.1.29。未下载所有大型更新包，因此此项不表示完整 payload 密码学验签。 |
| 正式下载与双语说明 | 实际新域名 `/release.json` 已为v0.1.29，20资产的size与URL匹配真实 release；`/en/` 与 `/zh/` 的安装包和校验下载链接精确指向v0.1.29，canonical为新域名，GitHub及服务端/客户端开源声明均存在。第一阶段真实1440/390布局验收对应相同精确源码，本阶段只重复最终元数据与HTML内容检查。 |
| AGPL 对应源码 | 完整读取实际 `https://anywork.aixgg.com/source`，10,134,561 bytes；归档与 `SOURCE_MANIFEST.json` 文件集合一致，815个公开源码文件逐字节匹配该发布 commit，零缺失、额外、重复或非普通文件；包括Native固定GitHub命令、官方域名UUID延续代码和测试、Android新入口及双语开源说明。 |
| 源码归档摘要 | SHA256 `76a6f7b3b90b1dc5794e782b40b3ca7dc7c5e9e300e382497494a75eec0152ce`。 |
| 精确来源工作流 | [Checks 43193643523](https://github.com/ywateru/AnyWork/actions/runs/43193643523) attempt1、[Build releases 43197004589](https://github.com/ywateru/AnyWork/actions/runs/43197004589) attempt2、[最终 Vercel 43201878549](https://github.com/ywateru/AnyWork/actions/runs/43201878549) attempt1 全部 completed/success，head SHA均为相同发布源码。 |

最终发行：[v0.1.29](https://github.com/ywateru/AnyWork/releases/tag/v0.1.29)，GitHub published_at `2026-11-12T10:36:33Z`。对应最终证据：`watch-stage-two-retry.log`、`verify-existing.log`、`stage-two-metadata.json`、`final-workflows.json`、`final-source-head.json`、`final-source-compare.json`，均在前述忽略的验收 artifacts 目录。原始只读核验脚本也保留在该目录。

验收边界：没有操作或替换用户已安装应用，没有使用真实用户凭据或写业务数据，没有逐个平台安装、升级或硬件验收。客户端实现、Native边界和迁移检查见实现独立报告及精确源码CI；本报告的实际线上验证覆盖匿名网页、公开发行资产元数据和完整对应源码。旧版运行中的主机仍需升级并重启后才能接收新域名的工作区连接，未放宽gateway Origin或通用namespace隔离。

## 发行过程记录

首次 Build releases 工作流 `43197004589` 的 macOS Intel job 在 `hdiutil create` 生成 DMG 时出现 `Resource busy`，该次整体结论 failure；此前 Native 编译、测试及签名更新包步骤已通过，其他平台构建也通过。root 在确认原工作流终止后，对同一 tag、版本和精确源码显式使用正常发布器 `--retry-failed`，未改写源码或另启发行版本。独立观察器在第一次发布进程退出且未 complete 时中止，未执行最终验收，也未重试或更改任何发布状态；收到 root 恢复指令后，继续跟踪第二次正常发布。最终结果见第二阶段，不将第一次失败掩盖为一次成功。
