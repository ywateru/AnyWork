#!/usr/bin/env bash
set -euo pipefail

# Rebuild the pinned browser overlay runtime used by the Web client.
# The source checkout is deliberately outside the repository; only the
# self-contained ESM artifact and its provenance are committed.
root="$(cd "$(dirname "$0")/.." && pwd)"
tag="v2.7.1"
commit="0d9c52b169dc2112687ddefcf571cd01d383193c"
source="${EASYTIER_SOURCE:-${TMPDIR:-/tmp}/easytier-build-${commit:0:6}}"
output="${ANYWORK_EASYTIER_OUTPUT:-$root/web/public/easytier-browser.js}"
esbuild="${ESBUILD_BIN:-$root/node_modules/.bin/esbuild}"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm 10 is required" >&2; exit 1; }
command -v rustup >/dev/null || { echo "rustup is required" >&2; exit 1; }
[[ -x "$esbuild" ]] || { echo "esbuild 0.28.2 is required at $esbuild" >&2; exit 1; }

if [[ ! -d "$source/.git" ]]; then
  git clone --filter=blob:none --no-checkout \
    https://github.com/EasyTier/EasyTier.git "$source"
fi
git -C "$source" fetch --tags origin "$commit"
git -C "$source" checkout --detach "$commit"
[[ "$(git -C "$source" describe --tags --always)" == "$tag" ]] || {
  echo "unexpected EasyTier source revision" >&2
  exit 1
}

cd "$source/easytier-js"
pnpm install --frozen-lockfile
RUSTUP_TOOLCHAIN="${EASYTIER_RUST_TOOLCHAIN:-1.95}" \
  rustup target add wasm32-wasip1

if [[ -z "${PROTOC:-}" ]]; then
  protoc_candidates=(
    "$HOME"/.cargo/registry/src/*/protoc-bin-vendored-macos-aarch_64-*/bin/protoc
    "$HOME"/.cargo/registry/src/*/protoc-bin-vendored-macos-x86_64-*/bin/protoc
    "$HOME"/.cargo/registry/src/*/protoc-bin-vendored-linux-x86_64-*/bin/protoc
    "$HOME"/.cargo/registry/src/*/protoc-bin-vendored-linux-aarch_64-*/bin/protoc
  )
  for candidate in "${protoc_candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      PROTOC="$candidate"
      break
    fi
  done
fi
[[ -n "${PROTOC:-}" && -x "$PROTOC" ]] || {
  echo "set PROTOC to a Protocol Buffers 35.1 compiler" >&2
  exit 1
}
export PROTOC
export RUSTUP_TOOLCHAIN="${EASYTIER_RUST_TOOLCHAIN:-1.95}"

pnpm --filter @easytier/browser build

# The upstream package marks @easytier/runtime as external. Bundle that
# workspace package and the embedded WASM into one dynamic-importable ESM.
temporary="${output}.tmp"
mkdir -p "$(dirname "$output")"
"$esbuild" "$source/easytier-js/browser/dist/index.js" \
  --bundle \
  --format=esm \
  --platform=browser \
  --minify \
  --legal-comments=none \
  --outfile="$temporary"
mv "$temporary" "$output"

printf 'Built %s\n' "$output"
printf 'EasyTier %s (%s)\n' "$tag" "$commit"
shasum -a 256 "$output"
