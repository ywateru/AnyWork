#!/usr/bin/env python3
"""Package the native updater's exact app with an Applications link and text guide."""
import argparse
import importlib
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def build(platform):
    app = ROOT / 'target/release/bundle/macos/AnyWork.app'
    if not (app / 'Contents/MacOS/anywork-desktop').is_file():
        raise ValueError('Build the native macOS app bundle first')
    version = importlib.import_module('bump-version').current_version()
    output = ROOT / 'target/release/bundle/dmg'
    output.mkdir(parents=True, exist_ok=True)
    image = output / f'AnyWork_{version}_{platform}.dmg'
    with tempfile.TemporaryDirectory(prefix='anywork-dmg-') as temporary:
        staging = pathlib.Path(temporary) / 'AnyWork'
        staging.mkdir()
        subprocess.run(['ditto', str(app), str(staging / 'AnyWork.app')], check=True)
        (staging / 'Applications').symlink_to('/Applications')
        shutil.copy2(ROOT / 'desktop/INSTALL-macOS.txt', staging / 'INSTALL-macOS.txt')
        subprocess.run(['hdiutil', 'create', '-volname', 'AnyWork', '-srcfolder', str(staging),
                        '-format', 'UDZO', '-ov', str(image)], check=True)
    print(f'Created macOS installer: {image}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', required=True, choices=['macos-arm64', 'macos-x86_64'])
    args = parser.parse_args()
    build(args.platform)
