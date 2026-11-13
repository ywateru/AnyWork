#!/usr/bin/env python3
"""Reject mismatched, duplicate or backwards releases before any build starts."""
import argparse
import base64
import importlib
import json
import os
import pathlib
import plistlib
import re
import urllib.request
import urllib.error

ROOT = pathlib.Path(__file__).resolve().parents[1]
versions = importlib.import_module('bump-version')

def check_local(tag, root=ROOT):
    version = versions.current_version(root)
    versions.version_tuple(version)
    if tag != 'v' + version:
        raise ValueError('Release tag must match Cargo.toml')
    cargo_lock = (root / 'Cargo.lock').read_text()
    for name in versions.WORKSPACE_PACKAGES:
        locked = re.findall(r'(?m)^name = "' + re.escape(name) + r'"\nversion = "([^"]+)"', cargo_lock)
        if locked != [version]:
            raise ValueError(f'Workspace lock version mismatch: {name}')
    for name in ['package.json', 'web/package.json', 'desktop/ui/package.json', 'crates/desktop/tauri.conf.json', 'crates/mobile/tauri.conf.json']:
        if json.loads((root / name).read_text())['version'] != version:
            raise ValueError(f'Version mismatch: {name}')
    lock = json.loads((root / 'package-lock.json').read_text())
    if lock['version'] != version or any(lock['packages'][name]['version'] != version for name in ['', 'web', 'desktop/ui']):
        raise ValueError('npm workspace lock versions disagree')
    mobile = json.loads((root / 'crates/mobile/tauri.conf.json').read_text())
    if mobile['identifier'] != 'dev.remoteagent.app' or mobile['bundle']['android']['minSdkVersion'] != 26:
        raise ValueError('Android upgrade identity or minimum SDK changed')
    code = mobile['bundle']['android']['versionCode']
    if type(code) is not int:
        raise ValueError('Invalid Android versionCode')
    if not 0 < code <= 2100000000:
        raise ValueError('Invalid Android versionCode')
    plist = plistlib.loads((root / 'desktop/Info.plist').read_bytes())
    if plist['CFBundleShortVersionString'] != version or plist['CFBundleVersion'] != str(code):
        raise ValueError('macOS bundle version mismatch')
    configuration = json.loads((root / 'crates/desktop/tauri.conf.json').read_text())
    if plist['CFBundleExecutable'] != configuration.get('mainBinaryName', 'anywork-desktop'):
        raise ValueError('macOS download and updater launch paths must agree')
    return version, code

def check_published(version, releases):
    for release in releases:
        if release.get('draft') or release.get('prerelease'):
            continue
        tag = release['tag_name']
        if not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
            continue
        if versions.version_tuple(version) <= versions.version_tuple(tag[1:]):
            raise ValueError(f'Release {version} must be newer than already published {tag}')

def api(path):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'AnyWork-release-guard'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    request = urllib.request.Request('https://api.github.com/repos/ywateru/AnyWork/' + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def published_android_code(tag):
    # Immutable old tags used Java/Gradle; only a genuine 404 permits legacy fallback.
    try:
        content = api('contents/crates/mobile/tauri.conf.json?ref=' + tag)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        content = api('contents/android/app/build.gradle.kts?ref=' + tag)
        text = base64.b64decode(content['content']).decode()
        return int(re.search(r'versionCode\s*=\s*(\d+)', text)[1])
    config = json.loads(base64.b64decode(content['content']))
    code = config['bundle']['android']['versionCode']
    if type(code) is not int or not 0 < code <= 2100000000:
        raise ValueError('Invalid published Android versionCode')
    return code

def check_remote(version, android_code):
    releases = []
    page = 1
    while True:
        items = api(f'releases?per_page=100&page={page}')
        releases.extend(items)
        if len(items) < 100:
            break
        page += 1
    check_published(version, releases)
    stable = [r for r in releases if not r['draft'] and not r['prerelease'] and re.fullmatch(r'v\d+\.\d+\.\d+', r['tag_name'])]
    if stable:
        latest = max(stable, key=lambda r: versions.version_tuple(r['tag_name'][1:]))
        previous = published_android_code(latest['tag_name'])
        if android_code <= previous:
            raise ValueError('Android versionCode must increase for every release')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag')
    parser.add_argument('--remote', action='store_true', help='Check published releases and Android update compatibility')
    args = parser.parse_args()
    value, code = check_local(args.tag)
    if args.remote:
        check_remote(value, code)
    print('Verified new release version:', value)
