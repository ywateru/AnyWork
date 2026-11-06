# Independent review: Harness discovery companion

Commit `ebfefef25eacb63226bb1c2430b1a31edceff4fa`: **PASS for the companion scope**.

Reviewed the official bundle declaration, injected `webServer`/`connection` services, effect-owned publication, atomic replacement, owner-only file/parent checks, transaction lock and successor-safe disposal. The plugin reads the existing Host's official authenticated URL and creates no listener, session, model runner or engine. The source/package install is local and has no dependency or build script.

Independently ran `node --test integrations/harness-discovery/descriptor.test.js`: all 8 tests passed, including concurrent activation, cross-process old-disposer protection, symlink rejection, private-directory enforcement and credential-safe errors.

Independently installed the committed package directory using the actual npm Harness `0.2.2-rc.1` launcher and official `dsh plugin --profile web add <absolute directory>`, exit 0. This profile supports HMR, so the companion became live immediately. The verifier initially omitted the dedicated descriptor override, briefly publishing the default descriptor; configuring the isolated profile's `descriptorPath` caused official HMR to remove that activation's old default file and publish only `/private/tmp/anywork-harness-verification/discovery/host.json`. The test must configure this override **before installation** in future automated runs. No installed app or production server was changed.

Verified the descriptor file is private and used its path to launch a separate AnyWork instance (port 9391) with no explicit Host URL/token. It discovered the native-precreated session and restored its history from the same actual Host. Native-history and tool-image browser checks in the UI review were performed through this descriptor-connected instance. The descriptor credential was never printed in test output or committed.

This verifies the exact official Web/desktop-shared carrier services on a real CLI Web Host. The production Electron application was deliberately not installed into or restarted. Desktop installation follows the same official services and bundle contract, with that device/manual step stated as a verification limit. Hosts without those services cannot be controlled by discovery alone. The Rust adapter's currently documented supported carrier is loopback HTTP; this review does not claim HTTPS-adapter support merely because the companion can publish a loopback HTTPS URL.
