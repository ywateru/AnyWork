# Android 工作区间距与发送按钮

2026-11-16。基线 main `ac7c422` / Android v0.1.44 code46。用户确认已能正常显示，但列表上下间距过大，圆形发送按钮被压缩，要求修复后更新到 ADB 设备供手测。

契约见[手机布局](../../mobile-client-layout.md)。列表按内容排布、保留48px触控，单行会话采用48–56px行高（替代此前64px最低值）；发送/停止宽高相等，不被收缩。检查共享 rem 单位、Mobile 根字号、通用 button 样式与具体控件的级联，用实际 production MOBILE 入口证明根因及修正。保留短横屏、IME、安全区、主题与登录恢复。

```text
工作区标题
新会话                 ≥48px
搜索                   ≥48px
Agent 筛选             ≥48px
会话标题/操作          ≥48px
会话                   48–56px
会话                   48–56px
（余下空白留在末尾）

消息输入 / 模型与附件       ◯ 48×48
```

实现代理与独立审查代理分离；通过后合并、递增候选版本，使用官方同签名 ARM64 workflow 构建，校验并 `adb install -r` 保留数据安装及正常启动。用户负责正常账号、会话发送和实机体验手测，不代为发送 Agent 消息、不清数据、不退出其账号。无需重建桌面或公开 Release。

上一候选完整 Checks 中 Windows、macOS、Android、container 通过，server/web E2E 为671通过、1跳过、10失败；失败全部为两个 Desktop spec 仍检查旧“凭据只在内存”说明。本轮同时按已接受保存登录契约修订这两处过时断言，保持原行为检查，交独立审查与定向执行，不修改 Native 产品实现。

## 调查与候选

Production MOBILE 基线在320/360/412宽度测得会话行64px、相邻起点差66px，navigation-view工具行72px；导航padding和Agent filter margin另有叠加。发送及停止为32×48px：共享32px宽高与Mobile通用48px min-height冲突。原flex-shrink已经为0，根字号改14px也不改变上述值，不将flex挤压或rem认定为已证实根因。

作者候选 `587fcb7` 仅修改Mobile CSS及相应E2E：单行52px、导航去除多余padding/margin，发送/停止固定48×48且不收缩，左侧模型工具可换行。作者生产入口7项通过，含320/360/412、长模型/附件、IME、send/stop合成点击及原短横屏真实触摸；独立复核已接受并合入main，准备同签名候选安装。上一轮过时文案断言候选 `8fd1dbb` 已独立接受，完整56/56与独立失败场景10/10通过，已合入main。


## 合并与冻结

`587fcb7` 已由[独立报告](../reviews/mobile-spacing-send-independent.md)接受，合并 `1d6b018`；独立11项布局/长模型探针、3项真实触摸、7项收集回归均通过。版本统一为 **0.1.45 / Android code47**；版本一致性、发布器33/33及版本工具4/4通过。沿用正式候选工作流，仅ARM64供当前设备保留数据安装，不创建tag或公开Release。安装和真实OS键盘/正常账号体验仍交用户手测。
