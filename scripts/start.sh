#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
if [[ ! -f web/dist/index.html ]]; then npm ci; npm run build; fi
cargo build --locked --release
python3 scripts/source-archive.py
exec target/release/anywork "$@"
