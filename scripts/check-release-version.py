#!/usr/bin/env python3
"""Prevent a release tag from disagreeing with embedded application versions."""
import json
import pathlib
import re
import sys
root = pathlib.Path(__file__).resolve().parents[1]
version = re.search(r'\[workspace.package\]\s*version\s*=\s*"([^"]+)"', (root / 'Cargo.toml').read_text())[1]
assert sys.argv[1] == 'v' + version, 'Release tag must match Cargo.toml'
for name in ['package.json', 'web/package.json', 'desktop/ui/package.json', 'crates/desktop/tauri.conf.json']:
    assert json.loads((root / name).read_text())['version'] == version, f'Version mismatch: {name}'
android = (root / 'android/app/build.gradle.kts').read_text()
assert re.search(r'versionName\s*=\s*"([^"]+)"', android)[1] == version, 'Android version mismatch'
print('Verified release version:', version)
