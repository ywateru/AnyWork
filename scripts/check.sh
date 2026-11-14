#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
npm run build:desktop-ui
npm run build:mobile-ui
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build
npm run build
npm test
python3 scripts/plugin-catalog-test.py
python3 scripts/capability-projection-test.py
python3 scripts/integration-test.py
python3 scripts/event-scope-test.py
python3 scripts/schema-recovery-test.py
python3 scripts/file-consistency-test.py
python3 scripts/service-control-test.py
python3 scripts/shared-history-test.py
python3 scripts/claude-integration-test.py
python3 scripts/claude-desktop-launch-test.py
python3 scripts/claude-desktop-adapter-test.py
python3 scripts/workbuddy-launch-test.py
python3 scripts/editing-test.py
python3 scripts/discovery-test.py
python3 scripts/shared-control-test.py
python3 scripts/desktop-bridge-test.py
python3 scripts/desktop-ipc-test.py
python3 scripts/desktop-host-http-test.py
python3 scripts/goal-editor-test.py
python3 scripts/goal-mode-test.py
python3 scripts/review-test.py
python3 scripts/cloud/test_configure.py
python3 scripts/cloud/test_selfhost.py
python3 scripts/cloud/test_frontend.py
python3 scripts/cloud/test_deploy.py
python3 scripts/cloud/test_prebuilt.py
python3 scripts/cloud/test_materialize.py
python3 -m unittest discover -s scripts/cloud -p 'test_redis_*.py'
node --test scripts/cloud/test-redis-tls-probe.mjs
python3 scripts/source-archive-test.py
python3 scripts/release-version-test.py
python3 scripts/build-site-test.py
python3 scripts/test-check-android-apk.py
python3 scripts/publish-test.py
python3 scripts/release-ci-test.py
python3 scripts/container-smoke-script-test.py
ANYWORK_ACCOUNT_PRESENCE_OUTPUT_DIR=test-results/account-presence npm run test:e2e:account-presence
npm run test:e2e:mobile
npm run test:e2e
node scripts/desktop-updater-test.mjs
