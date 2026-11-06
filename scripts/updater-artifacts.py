#!/usr/bin/env python3
"""Stage full resources and collect signed native Tauri update artifacts."""
import argparse
import base64
import datetime
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from importlib import import_module
version = import_module('bump-version').current_version

PLATFORMS = {
    'macos-arm64': ('darwin-aarch64', 'macos', '*.app.tar.gz', '.app.tar.gz'),
    'macos-x86_64': ('darwin-x86_64', 'macos', '*.app.tar.gz', '.app.tar.gz'),
    'windows-x86_64': ('windows-x86_64', 'nsis', '*-setup.exe', '-setup.exe'),
    'linux-x86_64': ('linux-x86_64', 'appimage', '*.AppImage', '.AppImage'),
    'linux-arm64': ('linux-aarch64', 'appimage', '*.AppImage', '.AppImage'),
}

def prepare():
    destination = ROOT / 'artifacts/bundle-resources'
    if destination.exists():
        shutil.rmtree(destination)
    (destination / 'bin').mkdir(parents=True)
    suffix = '.exe' if sys.platform == 'win32' else ''
    shutil.copy2(ROOT / ('target/release/anywork' + suffix), destination / ('bin/anywork' + suffix))
    shutil.copytree(ROOT / 'web/dist', destination / 'web')
    shutil.copytree(ROOT / 'licenses', destination / 'licenses')
    (destination / 'plugins').mkdir()
    shutil.copy2(ROOT / 'plugins/README.md', destination / 'plugins/README.md')
    subprocess.run([sys.executable, 'scripts/source-archive.py'], cwd=ROOT, check=True)
    (destination / 'artifacts').mkdir()
    shutil.copy2(ROOT / 'artifacts/anywork-source.tar.gz', destination / 'artifacts/anywork-source.tar.gz')
    for name in ['LICENSE', 'NOTICE']:
        shutil.copy2(ROOT / name, destination / name)
    print('Staged server, web, licenses and corresponding source for native updater bundles')

def signature_version(signature):
    text = base64.b64decode(signature, validate=True).decode()
    comments = [line for line in text.splitlines() if line.startswith('trusted comment: ')]
    if len(comments) != 1:
        raise ValueError('Missing signed trusted comment')
    versions = [field.split(':', 1)[1] for field in comments[0].split('\t') if field.startswith('version:')]
    if len(versions) != 1:
        raise ValueError('Signature does not bind exactly one application version')
    return versions[0]

def collect(platform):
    target, folder, pattern, suffix = PLATFORMS[platform]
    candidates = list((ROOT / 'target/release/bundle' / folder).glob(pattern))
    if len(candidates) != 1:
        raise ValueError(f'Expected exactly one {platform} updater artifact, found {len(candidates)}')
    artifact = candidates[0]
    signature = pathlib.Path(str(artifact) + '.sig').read_text().strip()
    if signature_version(signature) != version():
        raise ValueError('Updater signature version disagrees with application version')
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    name = f'anywork-{platform}{suffix}'
    shutil.copy2(artifact, output / name)
    shutil.copy2(str(artifact) + '.sig', output / (name + '.sig'))
    if platform.startswith('macos'):
        images = list((ROOT / 'target/release/bundle/dmg').glob('*.dmg'))
        if len(images) != 1:
            raise ValueError(f'Expected exactly one {platform} DMG installer, found {len(images)}')
        shutil.copy2(images[0], output / f'anywork-{platform}.dmg')
    (output / f'updater-{platform}.json').write_text(json.dumps({'target': target, 'filename': name, 'signature': signature}) + '\n')
    print(f'Collected signed update for {target}')

def manifest(directory, app_version, notes):
    for platform in ['macos-arm64', 'macos-x86_64']:
        image = directory / f'anywork-{platform}.dmg'
        if not image.is_file() or image.stat().st_size == 0:
            raise ValueError(f'Missing macOS installer: {image.name}')
    platforms = {}
    for platform in PLATFORMS:
        item = json.loads((directory / f'updater-{platform}.json').read_text())
        expected, _, _, suffix = PLATFORMS[platform]
        if item['target'] != expected or item['filename'] != f'anywork-{platform}{suffix}':
            raise ValueError('Unexpected updater artifact target/name')
        if signature_version(item['signature']) != app_version:
            raise ValueError('Updater signature version mismatch')
        if not (directory / item['filename']).is_file():
            raise ValueError('Missing updater package')
        if (directory / (item['filename'] + '.sig')).read_text().strip() != item['signature']:
            raise ValueError('Updater signature file mismatch')
        platforms[expected] = {'url': f'https://github.com/ywateru/AnyWork/releases/download/v{app_version}/{item["filename"]}', 'signature': item['signature']}
    result = {'version': app_version, 'notes': notes, 'pub_date': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'), 'platforms': platforms}
    (directory / 'latest.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    for path in directory.glob('updater-*.json'):
        path.unlink()
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'collect', 'manifest'])
    parser.add_argument('--platform', choices=PLATFORMS)
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare()
    elif args.action == 'collect':
        if not args.platform:
            parser.error('--platform is required')
        collect(args.platform)
    else:
        manifest(ROOT / 'release', version(), (ROOT / 'docs/release-notes.md').read_text())
        print('Created complete, version-bound latest.json for all five desktop targets')
