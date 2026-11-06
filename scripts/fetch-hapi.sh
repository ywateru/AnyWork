#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
if [[ -d references/hapi/.git ]]; then
    git -C references/hapi rev-parse HEAD
    exit 0
fi
mkdir -p references
git clone https://github.com/tiann/hapi.git references/hapi
git -C references/hapi checkout --detach fa02830a60c2e29c20b1de94f8645174b06492ec
