#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
npm run build
RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$RA_PROJECT_ROOT=/anywork --remap-path-prefix=$HOME=/builder" cargo build --locked --release
python3 scripts/source-archive.py
RA_PACKAGE_TEMP="$(mktemp -d -t anywork-package.XXXXXXXX)"
trap 'rm -rf "$RA_PACKAGE_TEMP"' EXIT
RA_PACKAGE_DIR="$RA_PACKAGE_TEMP/anywork-linux-x86_64"
mkdir -p "$RA_PACKAGE_DIR/bin" "$RA_PACKAGE_DIR/web" "$RA_PACKAGE_DIR/artifacts" "$RA_PACKAGE_DIR/plugins"
cp target/release/anywork "$RA_PACKAGE_DIR/bin/"
cp -a web/dist "$RA_PACKAGE_DIR/web/"
cp LICENSE NOTICE "$RA_PACKAGE_DIR/"
cp -a licenses "$RA_PACKAGE_DIR/"
cp plugins/README.md "$RA_PACKAGE_DIR/plugins/"
cp artifacts/anywork-source.tar.gz "$RA_PACKAGE_DIR/artifacts/"
cat > "$RA_PACKAGE_DIR/RUNNING.txt" <<'EOF'
AnyWork 0.1.0 — Linux x86_64

Install and log into the Codex CLI on this machine first.
From this extracted directory, run:
  ./bin/anywork --workspace /absolute/path/to/projects

Open http://127.0.0.1:3210 and enter the token from .anywork/access-token.
Use --bind 0.0.0.0:3210 for trusted LAN devices, or an HTTPS reverse proxy for internet access.
The bundled Web client and source archive are served from this directory.
Agent logins and task execution stay on this machine.
This is a personal trusted workspace server; terminal access uses the server's OS user.
License: AGPL-3.0-only. See LICENSE, NOTICE, and /source.
EOF
tar --owner=0 --group=0 --numeric-owner -czf artifacts/anywork-linux-x86_64.tar.gz -C "$RA_PACKAGE_TEMP" anywork-linux-x86_64
if [[ -f android/app/build/outputs/apk/debug/app-debug.apk ]]; then
    cp android/app/build/outputs/apk/debug/app-debug.apk artifacts/anywork-android-debug.apk
fi
sha256sum artifacts/anywork-source.tar.gz artifacts/anywork-linux-x86_64.tar.gz > artifacts/SHA256SUMS
if [[ -f artifacts/anywork-android-debug.apk ]]; then sha256sum artifacts/anywork-android-debug.apk >> artifacts/SHA256SUMS; fi
printf 'Artifacts: %s/artifacts\n' "$RA_PROJECT_ROOT"
