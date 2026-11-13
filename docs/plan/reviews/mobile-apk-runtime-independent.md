# Android 最终 main APK：隔离运行独立验收

本轮已实际运行最终 main debug 候选，完成无账号条件下的 APK / WebView / 系统桥验收，未发现新增阻断。没有重新构建产品、重复已收口的源码审计、操作真实账号或物理手机。真实登录、授权回调换 token、Native 注册/目录、远程电脑的文件与终端业务链路不在本次无账号运行结论内。

## 固定候选与安装证明

- 作者交付源码 `1ebe60ae63bd7be8c88e250f53a771332cf134bf`，基于 main `ea7b3c1a590a079834341b99a2eec2ccf01ea899`；协调确认相对 main 仅有必要 manifest lint 修复 `6554d0c`。包含 `df6ec90` 等既有 UI / core / receipt / shell 修复；本轮不重新审计这些已闭环改动。
- 作者输出为 shell worktree 的 `artifacts/anywork-android-debug.apk`，实际安装读取同一构建的 `crates/mobile/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。117054564 bytes，SHA-256：

  ```text
  0c24ca3d01738e85ab3397555fc65fbd401b577f0f5891612948b34f77b75f51
  ```

- 在 fresh guest 安装前查询应用包为空；`adb -s <OWN_SERIAL> install --no-streaming <APK>` 成功。安装后通过 `pm path dev.remoteagent.app` 定位自己的安装 APK，在 guest 内计算 SHA-256，逐字匹配上述值。因此本报告绑定实际安装字节；源码归属采用作者交付和协调确认，不冒充可复现构建证明。
- 独立执行 `python3 scripts/check-android-apk.py <APK> --profile debug` 通过：package/version/minSdk、随包 UI 与 NOTICE、native libs、debug 签名及 ELF/ZIP 16 KiB 对齐。单 ARM64 ABI，应用 `dev.remoteagent.app`，versionName 0.1.30 / code32 / minSdk26。文件名中的 universal 不代表四 ABI 发布包。
- 旧候选 `cb20de4` / SHA `f257fa5d…e58f599` 仅做过静态检查，没有用它代替本次最终运行验收。原 base `260c14a` 也未安装到本次 fresh guest。

## API30 失败定位与隔离恢复

已有 API30 Google APIs stock 镜像与 host emulator 37.1.11.0 两轮 fresh-data 启动均在 early mount 阶段失败。第二轮排除了镜像自动选择歧义，显式指定 kernel、ramdisk、system、vendor；相关命令如下。变量代表本任务路径，不是原 userdata：

```sh
sandbox-exec -f "$TASK_ROOT/emulator.sb" "$HOST_SDK/emulator/emulator" \
  -avd '<TASK_API30_METADATA_NAME>' -port '<OWN_PORT>' \
  -data "$TASK_ROOT/data/userdata.img" -initdata "$API30_IMAGE/userdata.img" \
  -cache "$TASK_ROOT/data/cache.img" -sdcard "$TASK_ROOT/data/unused-sdcard.img" \
  -sysdir "$API30_IMAGE" -system "$API30_IMAGE/system.img" \
  -vendor "$API30_IMAGE/vendor.img" -kernel "$API30_IMAGE/kernel-ranchu" \
  -ramdisk "$API30_IMAGE/ramdisk.img" \
  -read-only -no-snapshot -no-snapstorage -no-window -no-audio -no-boot-anim \
  -gpu swiftshader -feature -Vulkan -camera-back none -camera-front none \
  -no-metrics -crash-report-mode disabled -show-kernel -verbose
```

关键日志：

```text
androidboot.boot_devices=a003800.virtio_mmio
init: realpath failed: /dev/block/by-name/super: No such file or directory
init: Failed to mount required partitions early ...
```

stock system GPT 本身包含 super；这不是“镜像没有 super”的证明。第二轮仍失败后，没有继续猜参数、读取原 guest 或修改锁。两轮任务进程和 fresh 数据均已清理。

按用户新增授权，仅下载一个官方正常 Google APIs ARM64 API35 rev9 镜像到任务临时 SDK。压缩 1778933980 bytes，解压总量约 3.779 GiB，完整校验官方 SHA-1 `16f5bceca236b2737008977c4aaf826e46a8de7d`。有界分段下载后做整体 hash，解压按 ZIP 路径边界检查。下载/解压逐块检查至少 8 GiB 加 128 MiB 余量；该阶段实际最低可用 11.72 GiB，解压后删除 ZIP。

新 AVD 使用任务内新 config/registry，显式指向新 sysdir 和任务 userdata，不引用旧 AVD 内容。仍使用原已装 host emulator，不改已装 SDK。新镜像通过现代 `data/` 初始化 fresh userdata，不强行指定不存在的 `userdata.img`。启动命令：

```sh
sandbox-exec -f "$TASK_ROOT/emulator.sb" "$HOST_SDK/emulator/emulator" \
  -avd anywork_api35_verify -port '<OWN_PORT>' -sysdir "$TASK_IMAGE" \
  -data "$TASK_ROOT/avd/anywork_api35_verify.avd/userdata-qemu.img" -no-cache \
  -read-only -no-snapshot -no-snapstorage -no-window -no-audio -no-boot-anim \
  -gpu swiftshader -feature -Vulkan -camera-back none -camera-front none \
  -no-metrics -crash-report-mode disabled -show-kernel -verbose
```

子进程环境的 `ANDROID_AVD_HOME`、`ANDROID_EMULATOR_HOME`、`ANDROID_USER_HOME`、`TMPDIR` 均指任务目录；移除子进程代理变量，允许授权的公开登录页联网。sandbox 拒绝读原 AVD 目录、拒绝写原 Android 配置及已装 SDK；实际进程 FD 未发现原 AVD 路径。emulator 在系统临时目录另外创建的五个自有 overlay / cache 文件，记录精确路径与 inode 后单独清理，未删除共享临时目录。

实际 guest 为 Android 15/API35、ARM64、1080×2280 / 440dpi，`sys.boot_completed=1`。WebView provider 为 `com.google.android.webview` 124.0.6367.219，DocumentsUI 为 `com.google.android.documentsui`。这不是无 WebView 的 ATD 镜像。

## 实际运行结果

只对固定自有 serial 调用 ADB。业务 UI 由实际安装 APK 提供。系统桥合成检查在自己的 debug WebView 内经公开 `window.__TAURI__.core.invoke` 发起；不是桌面浏览器 mock。WebView 不支持 Playwright 的 Browser context management，改用其公开 page CDP endpoint；仅关闭调试连接，不关闭业务页，没有绕过授权站点 DevTools 提示或供应商认证。

| 检查 | 实际结果与边界 |
| --- | --- |
| 离线冷启动 | guest 开飞行模式后启动成功。实际 Origin `https://tauri.localhost`、path `/mobile.html`，Tauri API 可用，欢迎页和登录/注册/引导控件可见。 |
| 初始账号 / IPC | `mobile_account_snapshot` 返回 protocolVersion1、signedOut、account=null、devices=[]；不是仅依据配置推断 IPC 可用。 |
| 窄屏 / insets | viewport 393×830 CSS px、DPR2.75，document scrollWidth=393；native systemBars top/bottom 各24 CSS px，CSS 自定义属性一致，未见横向溢出。 |
| auth ACL | 业务 JS 对 mobile-auth 的 configure/signIn/snapshot/profile/token/logout/get/credentials 8 项直调全部以 `not allowed. Command not found` 拒绝。未授予 token 读取能力。 |
| 系统保存 | 公开 Rust→Kotlin export begin/write/finish，经真实 DocumentsUI 保存合成38字节文本，返回 `saved`。只读回自己的 Download 文件，逐字匹配；不是仅看到选择器就算成功。 |
| 保存取消 | 独立新 handle 打开 DocumentsUI，待选择器就绪后按系统 Back，返回 `cancelled`。 |
| 分享 | 合成文件 finish 返回 `chooserOpened`；实际 Android intent resolver 显示该文件和分享目标。按 Back 关闭，没有选择接收方，未声称发送完成。 |
| 图片文件选择 | 在业务 WebView 添加临时合成 file input（accept=image/png），实际 Android Photo Picker→Browse→DocumentsUI，选择本任务推送的1×1 PNG。JS 收到 `File{name: anywork-pixel.png, size:68, type:image/png}`，随后移除临时控件。这证明 WebView 文件桥，不等于远程上传业务已端到端运行。 |
| IME / Back | 临时合成输入框实际获得焦点并弹出键盘；native imeVisible=true、ime.bottom≈298.91，CSS `--mobile-ime` 相同。系统 Back 后 native false / 0、CSS0，主 Activity 仍在。随后删除输入框。 |
| 引导 / 根页 Back | 实际点击“如何添加工作电脑”，系统 Back 返回欢迎页；根页 Back 回到 Launcher。没有以 URL history 回退代替应用页面返回。 |
| 系统栏外观 | 通过真实 appearance bridge 与本地页面主题作合成深色检查；等待系统栏更新后，全屏截图确认深色背景上的白色状态栏图标及白色手势条。未把 UI 主题变化当作 native 图标更新证据。 |
| HTTPS 外部链接 | 实际点击引导页“查看安装指南”，top resumed 切为 Chrome IntentDispatcher，返回后业务页仍为本地 Origin。只证明安全链接交给外部 Activity，未操作 Chrome 账号/完成首启设置。http/javascript/file 三种 bridge 请求均实际返回 INVALID_REQUEST。 |
| 公开登录页 | 原生预告弹窗实际显示固定 auth 来源、系统 Back 取消、SSO Cookie 与 RAM 授权说明。继续后进入官方 LogtoWebViewAuthActivity；公开页实际来源 `https://auth.x.aixgg.com/sign-in`，登录表单可见、宽度393无横溢、`window.__TAURI__` 不存在。未填写或提交账号。 |
| 取消 / 再打开 | 第一轮 SDK 页面系统 Back 后回主 Activity，登录控件恢复。另验预告取消；随后第二轮 SDK Activity 能再次打开并系统 Back 取消。最终 snapshot 为 signedOut、account=null、errorCode=null，登录按钮可用。仅证明本次正常取消交接，不扩张为所有旋转/迟到销毁竞态均已设备验证。 |
| 进程重启 | 取消后 epoch=3；根页退出，再 force-stop 自己应用并离线冷启，epoch=0、signedOut、无账号。Origin/ACL/insets 复验通过。没有创建过 signed-in grant，因此此项不冒充“真实 grant 经进程死亡已实测销毁”。 |

公开登录 Activity 没有业务 Tauri API，与 [账号契约](../../android-account-entry.md) 的信任边界一致；SDK 自带 Polyfill/social bridge 的既有信任边界仍按契约处理。没有把“无 Tauri API”等同于“没有任何 SDK bridge”。

## 清理与结论

先移除本任务专用 ADB forward，核对 own emulator PID/PGID/命令路径，再只向自己的进程组 SIGTERM；监督进程确认 exit0、进程组无残留。删除任务临时 SDK、AVD、fresh data；外部 overlay 只在 inode 仍匹配记录时删除。原 AVD、锁、旧 userdata、已装 SDK、物理手机与其他任务 target 均未修改。

运行阶段因并行任务磁盘使用变化，已观测可用约9.5–12.6 GiB；没有再下载镜像或构建，各次观测均高于8 GiB下限。清理后可用 **18.68 GiB**，本任务 overlay 残留0、guest 进程残留0。小型合成截图/JSON/脚本留在 reviewer 的 ignored artifacts 供本轮追溯，不进入公开源码或发行物。

**最终 `0c24ca3d…7b75f51` 通过本轮无账号 APK 运行验收，可进入主线集成及后续发布检查。** 真实账号登录/refresh、目录、远程电脑连接与实际工作区业务、release 签名/四 ABI及历史包升级不由本报告宣称通过；相关源码/core/夹具结论仍分别见既有独立报告。没有新增需要作者修改产品的发现。
