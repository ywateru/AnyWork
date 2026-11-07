# Default Agents and bounded sidebar scrolling

User-authorized follow-up: enable dsh (DeepSeek Harness) and WorkBuddy by default, and fix sidebar scrolling past the viewport into blank space. No release/version bump or native-session writes are required.

## Contract

All three built-in integrations (Codex, DeepSeek Harness, WorkBuddy) are registered and exposed by default, independently of host discovery. `/plugins` separates integration registration from host availability with explicit metadata; it never exposes local descriptors or credentials. Existing host validation and command availability gates remain intact. Disconnected built-ins remain visible and selectable in the new-session selector, with actionable connection guidance and creation disabled until available. An explicit “重新检查连接” action reloads catalog availability after setup without polling or replacing the selected Agent; stale responses cannot change a different server connection. Legacy servers that omit availability metadata preserve their existing catalog semantics. Explicit Agent selection never silently changes. Sidebar filtering remains a presentation projection and retains native Agent identities.

WorkBuddy's normal supported desktop writes DevToolsActivePort under its session directory. The launcher must support that actual location while preserving endpoint identity, private-file validation and launched-host identity binding, compatibility with the existing profile-root location, and strict refusal of ambiguous/stale entries. Tests must use isolated fixtures only.

## Layout and scrolling

```text
viewport (no document vertical scrolling)
+ sidebar ----------------+ conversation ----------------+
| brand / actions         | header                        |
| search / Agent filter   |                               |
| chats heading           | conversation's own scroll area|
| + independently ------+ |                               |
| | scrolling chat list | |                               |
| | ... last chat       | |                               |
| +---------------------+ | composer                      |
| fixed sidebar footer   |                               |
+------------------------+-------------------------------+
```

The viewport owns the shell's height. Sidebar is a bounded flex column; only its list scrolls, and continued wheel/touch gestures at either list boundary cannot scroll the document or reveal blank space. Header/footer remain visible. Desktop, short-height windows and the mobile drawer preserve their controls, popup interaction, and access to the final chat. Do not globally suppress legitimate login/modal/document scrolling.

## Delivery

Two isolated developer tasks: (1) default catalog + connection UI/launcher contract, (2) sidebar scroll reproduction/fix. A separate verifier reviews committed changes and runs focused tests in isolated services. Root merges and runs merged checks. No production hosts, prompts, keys or tunnels are modified by developers/reviewer.
