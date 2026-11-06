#!/usr/bin/env python3
"""Mount a release DMG read-only and compare its app to the signed update bundle."""
import argparse
import hashlib
import importlib
import os
import pathlib
import plistlib
import subprocess
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def digest(source):
    value = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        value.update(chunk)
    return value.digest()


def check(platform, directory):
    image = directory / f'anywork-{platform}.dmg'
    update = directory / f'anywork-{platform}.app.tar.gz'
    version = importlib.import_module('bump-version').current_version()
    subprocess.run(['hdiutil', 'verify', str(image)], check=True)
    with tempfile.TemporaryDirectory(prefix='anywork-dmg-check-') as temporary:
        mount = pathlib.Path(temporary) / 'volume'
        mount.mkdir()
        subprocess.run(['hdiutil', 'attach', str(image), '-readonly', '-nobrowse',
                        '-mountpoint', str(mount)], check=True)
        try:
            if (mount / 'INSTALL-macOS.txt').read_bytes() != (ROOT / 'desktop/INSTALL-macOS.txt').read_bytes():
                raise ValueError('DMG installation guide is missing or outdated')
            app = mount / 'AnyWork.app'
            applications = mount / 'Applications'
            if not applications.is_symlink() or applications.resolve() != pathlib.Path('/Applications'):
                raise ValueError('DMG needs an Applications drag-and-drop link')
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            if info['CFBundleShortVersionString'] != version or info['CFBundleExecutable'] != 'anywork-desktop':
                raise ValueError('DMG application version or launch path mismatch')
            executable = app / 'Contents/MacOS/anywork-desktop'
            server = app / 'Contents/Resources/bin/anywork'
            expected_arch = 'arm64' if platform == 'macos-arm64' else 'x86_64'
            for binary in [executable, server]:
                subprocess.run(['lipo', str(binary), '-verify_arch', expected_arch], check=True)
                if not os.access(binary, os.X_OK):
                    raise ValueError(f'Binary is not executable: {binary.name}')
            for name in ['web/index.html', 'artifacts/anywork-source.tar.gz', 'LICENSE', 'NOTICE']:
                if not (app / 'Contents/Resources' / name).is_file():
                    raise ValueError(f'Missing bundled resource: {name}')
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
            result = subprocess.check_output([str(server), '--version'], text=True).strip()
            if result != f'anywork {version}':
                raise ValueError(f'Bundled server version mismatch: {result}')
            # Both distribution paths must install exactly the same app,
            # including executable permissions, resources and code signature.
            checked = set()
            with tarfile.open(update) as archive:
                for member in archive:
                    relative = pathlib.PurePosixPath(member.name)
                    if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'AnyWork.app':
                        raise ValueError('Unexpected path inside updater archive')
                    target = mount.joinpath(*relative.parts)
                    if member.isfile():
                        with archive.extractfile(member) as source:
                            expected = digest(source)
                        with target.open('rb') as source:
                            actual = digest(source)
                        if expected != actual or (member.mode & 0o777) != (target.stat().st_mode & 0o777):
                            raise ValueError(f'DMG and updater app differ: {member.name}')
                        checked.add(relative.as_posix())
                    elif member.issym() and (not target.is_symlink() or os.readlink(target) != member.linkname):
                        raise ValueError(f'DMG and updater symlinks differ: {member.name}')
            actual_files = {path.relative_to(mount).as_posix() for path in app.rglob('*') if path.is_file() and not path.is_symlink()}
            if checked != actual_files:
                raise ValueError('DMG and updater file lists differ')
            print(f'Verified {platform} DMG v{version}: Applications link, architecture, signature, resources and {len(checked)} identical updater files')
        finally:
            subprocess.run(['hdiutil', 'detach', str(mount)], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', required=True, choices=['macos-arm64', 'macos-x86_64'])
    parser.add_argument('--directory', type=pathlib.Path, default=ROOT / 'release')
    args = parser.parse_args()
    check(args.platform, args.directory.resolve())
