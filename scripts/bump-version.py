#!/usr/bin/env python3
"""Advance all shipped application versions together; never reuse a version."""
import argparse
import json
import pathlib
import plistlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKSPACE_PACKAGES = ('anywork', 'anywork-desktop', 'anywork-remote', 'remote-agent-sdk', 'remote-agent-codex', 'anywork-mobile', 'tauri-plugin-mobile-system', 'tauri-plugin-mobile-auth')

def current_version(root=ROOT):
    return re.search(r'\[workspace.package\]\s*version\s*=\s*"([^"]+)"', (root / 'Cargo.toml').read_text())[1]

def version_tuple(value):
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', value):
        raise ValueError('Use a stable MAJOR.MINOR.PATCH version without leading zeroes')
    return tuple(map(int, value.split('.')))

def bump(value, root=ROOT):
    old = current_version(root)
    major, minor, patch = version_tuple(old)
    new = {'patch': f'{major}.{minor}.{patch + 1}', 'minor': f'{major}.{minor + 1}.0', 'major': f'{major + 1}.0.0'}.get(value, value)
    if version_tuple(new) <= version_tuple(old):
        raise ValueError('Every release must have a strictly newer version')
    path = root / 'Cargo.toml'
    path.write_text(path.read_text().replace(f'version = "{old}"', f'version = "{new}"', 1))
    names = ['package.json', 'web/package.json', 'desktop/ui/package.json', 'crates/desktop/tauri.conf.json', 'crates/mobile/tauri.conf.json']
    for name in names:
        path = root / name
        # Preserve the file's existing formatting.
        text = path.read_text()
        path.write_text(re.sub(r'("version"\s*:\s*")[^"]+', lambda m: m[1] + new, text, count=1))
    path = root / 'package-lock.json'
    lock = json.loads(path.read_text())
    lock['version'] = new
    for name in ['', 'web', 'desktop/ui']:
        lock['packages'][name]['version'] = new
    path.write_text(json.dumps(lock, indent=2) + '\n')
    path = root / 'Cargo.lock'
    text = path.read_text()
    for name in WORKSPACE_PACKAGES:
        text = re.sub(r'(name = "' + re.escape(name) + r'"\nversion = ")[^"]+', lambda m: m[1] + new, text)
    path.write_text(text)
    path = root / 'crates/mobile/tauri.conf.json'
    config = json.loads(path.read_text())
    code = config['bundle']['android']['versionCode'] + 1
    config['bundle']['android']['versionCode'] = code
    path.write_text(json.dumps(config, indent=2) + '\n')
    path = root / 'desktop/Info.plist'
    data = plistlib.loads(path.read_bytes())
    data['CFBundleShortVersionString'] = new
    data['CFBundleVersion'] = str(code)
    path.write_bytes(plistlib.dumps(data, sort_keys=False))
    return new

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version', help='patch, minor, major, or an exact newer version')
    args = parser.parse_args()
    print(bump(args.version))
