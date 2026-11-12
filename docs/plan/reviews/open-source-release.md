# 开源说明与正式域名：独立发行验收

日期：2026-11-12，Asia/Shanghai。发行源码固定为 `17679e4f01e0ced8946b5dfa8456bbe56bd84c45` / v0.1.29。**第一阶段 PASS；安装包和最终下载刷新仍待第二阶段，不表示正式发行已完成。** 源码与配置前后审查见[实现独立报告](open-source-ui.md)。

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

待 root 通知正常 publisher 完成后，只读执行既有 v0.1.29 发行核验，核对最终 tag/source、20 assets /19 checksum entries /5 updater targets、正式双语下载和最终对应源码。未下载全部大型更新包时，不宣称完整 payload 密码学验签、安装升级或全平台硬件验收。
