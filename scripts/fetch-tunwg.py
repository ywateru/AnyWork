#!/usr/bin/env python3
"""Fetch a pinned Hapi-compatible tunwg asset; verify before executing or bundling."""
import hashlib, os, pathlib, platform, sys, tempfile, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = 'v26.08.03%2B122a6d0'
ASSETS = {
    'arm64': ('tunwg-darwin-arm64', '4ff96e3ff7271a1bb940c8e7e071900d2135b483baab387d4f8ba8dc2ddd333a'),
    'x86_64': ('tunwg-darwin', '5b354c7d071cf7c5346f446fbbec8f4fe218278c6d1d9c6dca217dcdd0b96c22'),
}
def main():
    if platform.system() != 'Darwin' or platform.machine() not in ASSETS: raise SystemExit('This packaging helper supports macOS arm64/x86_64.')
    name, digest = ASSETS[platform.machine()]
    output = ROOT/'artifacts/tools'/name
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and hashlib.sha256(output.read_bytes()).hexdigest() == digest: print(output); return
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as temporary: path = pathlib.Path(temporary.name)
    try:
        url = f'https://github.com/tiann/tunwg/releases/download/{VERSION}/{name}'
        with urllib.request.urlopen(url, timeout=60) as response, path.open('wb') as target:
            while data := response.read(1024 * 1024): target.write(data)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest: raise RuntimeError('tunwg SHA-256 mismatch; nothing was installed')
        path.chmod(0o755); path.replace(output)
    finally: path.unlink(missing_ok=True)
    print(output)
if __name__ == '__main__': main()
