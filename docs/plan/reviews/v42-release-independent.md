# v0.1.42 独立发行验收

状态：精确源版本审核 PASS；发行验收 BLOCK。Checks 已失败，publisher 已停止，候选未创建正式 tag / Release。本文件为中间记录，不是正式发行通过声明。

## 精确源与版本差异

- 固定源：`0a38dbb2230373884cc9872849c9bfffc9aaabc1`（Release v0.1.42），Android `dev.remoteagent.app` / code44 / min26。
- 对照文档基线：`7029f1f3d47e77b0edff49da8116c995aa472d7e`。10个差异文件逐字节归一版本替换后与基线一致：Cargo manifest/lock、3个package manifest与npm lock、两份Tauri配置、Info.plist和release-notes。Android及旧mac bundle code均43→44，其他版本0.1.41→0.1.42；release-notes标题为New in 0.1.42，Previous release 0.1.41正文保留。
- Cargo.lock只改变8个workspace package版本，npm lock也只有本项目workspace版本替换；无第三方依赖、解析结果或运行逻辑改变。`git diff --check`通过，无产品测试重跑。
- 与实体手机已通过的签名候选 `e4f3650890eb1e9e8010be29fca607a12302435a` 比较，全部差异限于上述版本文件与文档；产品运行时代码和workflow相同。候选的实际手机只读认证/目录/工作区/既有历史结果见[恢复独立报告](mobile-coordination-independent.md)，不将v41/code43候选冒充已验证正式v42 APK。

## 首次远端快照

2026-11-15T11:03:19Z，经Python子进程使用既有项目认证进行只读GitHub API请求，确认远端main精确匹配上述SHA；未改全局gh认证、main、tag或CI。

| 项目 | 精确run / attempt | 观察状态 |
| --- | --- | --- |
| Checks | [43706633883](https://github.com/ywateru/AnyWork/actions/runs/43706633883) / 1 | in_progress；Android、container success；macOS、Windows、server-web进行中 |
| 网站自动部署 | [43706633867](https://github.com/ywateru/AnyWork/actions/runs/43706633867) / 1 | completed/failure；本次仅记录状态，未重新分析失败日志或声称人工部署完成 |

网站owner另行负责精确源人工部署；既有自动部署认证失败的历史不改写为成功，后续仍须独立读回网站source与正式installer绑定。此时不轮询Release或下载旧候选。

## Checks 终态与发布阻断

2026-11-15T11:14:23Z独立读取保留的job JSON及server-web日志：Checks `43706633883` / attempt 1全部终态，Android、container、Windows、macOS均success，server-web（job `132789044862`）failure。

失败位于 `transport::tests::renewal_preserves_existing_pty_and_later_http`，精确源 `crates/mobile/src/transport/tests.rs:464`。日志保留：

```text
2026-11-15T11:04:27.6481509Z thread 'transport::tests::renewal_preserves_existing_pty_and_later_http' (7408) panicked at crates/mobile/src/transport/tests.rs:464:5:
2026-11-15T11:04:27.6482228Z assertion failed: f.auth.tokens.load(Ordering::SeqCst) >= 2
2026-11-15T11:04:27.6484625Z test result: FAILED. 41 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 27.19s
```

该断言紧接固定4秒sleep；本次执行尚未到达后续HTTP 200及原PTY输入/输出断言。因此已证实测试门禁失败，尚不能仅据此断定为网络瞬时或生产renewal故障，也不能声称后续HTTP与PTY在此次CI中通过。按协调者通知及保留的publication证据，无正式tag/Release；本lane不重试CI、不触发新发布。

Native作者在隔离 `codex/mobile-renewal-check` WT调查。待精确提交后独立审查是否真正等待并证明renewal完成、保留同一PTY并验证后续HTTP；固定sleep改法、计数条件及失败诊断均需有语义依据，不以移除或弱化断言代替修复。当前不运行Cargo，避免争用作者shared target；不新增ADB操作。

后续补证：作者测试修复 `b60b42a9757ab54cc9d394d364f92a1f09d89b5a` 已完成[独立审查](mobile-renewal-check-independent.md)，结论PASS；在协调者释放target窗口后独立正向通过，旧到期不延长的负对照按预期失败。仅测试及作者报告修改，无运行时或版本变化。该结果不改变 `0a38dbb` 的失败Checks和未发布状态；新精确源仍须完整发行门禁。

## 后续门槛

精确Checks全部成功、正式tag/source和全部Release平台成功、23附件/22校验项、5个updater签名及version/source绑定、四份实际APK的摘要/单ABI/包版本与code44/官方单signer/ELF及ZIP16KiB、精确source归档、网站部署与四ABI下载绑定均尚待验收。正式签名基线SHA256为 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`；旧v41不可变发行不被覆盖。

小证据位于本WT ignored `artifacts/v42-release-independent/` 的 `source-bump-safe.json`、`github-initial-snapshot-safe.json`、`checks-failure-safe.json`与verification-plan；后续修复的两项独立定向执行证据见上链报告。此前自建只读模拟器已正常退出，ADB server及桌面AnyWork保持；手机现有候选与只读历史现场不再操作。除获授权的续期定向验证外，没有额外产品测试、Android构建、部署或CI触发；本lane只提交自己的报告。
