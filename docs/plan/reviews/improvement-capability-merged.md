# I07a merged regression

Source: `2942baa` (implementation `b374fe31`, independent review `1bfd268`, merge `89f5d30`, check registration `9afe500`). Date: 2026-11-07. Result: **PASS for the scoped additive read-only module**.

The orchestrator executed these sequential merged checks in `.worktrees/improve-g0-merged` using its private target/data and existing private assets. Log: `artifacts/g1-capability-merged-check.log` in that worktree. The invocation exited 0.

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --locked -p anywork
export ANYWORK_BINARY="$PWD/target/debug/anywork"
python3 scripts/plugin-catalog-test.py
python3 scripts/capability-projection-test.py
python3 scripts/integration-test.py
python3 scripts/event-scope-test.py
python3 scripts/schema-recovery-test.py
python3 scripts/file-consistency-test.py
python3 scripts/desktop-host-http-test.py
python3 scripts/source-archive-test.py
npm run format:check
```

Rust: server 151 passed / 4 explicitly ignored; desktop 34 / 4; SDK 5; Codex 3. HTTP/script cases: plugin catalog 2, capability projection 6, integration 25, event scope 4, schema recovery 3 (including its startup-negative matrix), file consistency 6, desktop host 20 and source archive 4, all passed. Format and Clippy passed.

These are bounded regressions following the full successful schema command at `a41eec7`; the 611-case browser suite was not repeated for this server-only additive module. A fresh exact-source cloud Checks run remains required for the new mainline. No real native Agent/model, production service, release or installed desktop was changed. Fixture runtime presence never enabled projected native actions.

The task is accepted only as I07a. Native observation freshness/identity, Web adoption, typed errors, command enforcement and complete I07/I10 remain open. [Independent source review](improvement-capability-projection.md) and the [module contract](../../capability-projection-module.md) retain the exact policy limitations.
