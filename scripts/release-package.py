#!/usr/bin/env python3
"""Package the already-built native binaries and their corresponding source."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', required=True, choices=['macos-arm64', 'macos-x86_64', 'linux-x86_64', 'linux-arm64', 'windows-x86_64'])
    args = parser.parse_args()
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    windows = args.platform.startswith('windows')
    suffix = '.exe' if windows else ''
    subprocess.run(['python3', 'scripts/source-archive.py'], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix='anywork-release-') as temp:
        folder = pathlib.Path(temp) / 'AnyWork'
        folder.mkdir()
        if args.platform.startswith('macos'):
            app = folder / 'AnyWork.app'
            resources = app / 'Contents/Resources'
            executable = app / 'Contents/MacOS/AnyWork'
            executable.parent.mkdir(parents=True)
            shutil.copy2(ROOT / 'target/release/anywork-desktop', executable)
            shutil.copy2(ROOT / 'desktop/Info.plist', app / 'Contents/Info.plist')
            iconset = pathlib.Path(temp) / 'AnyWork.iconset'
            iconset.mkdir()
            for size in [16, 32, 128, 256, 512]:
                for scale in [1, 2]:
                    name = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
                    subprocess.run(['sips', '-z', str(size * scale), str(size * scale), str(ROOT / 'desktop/icon.png'), '--out', str(iconset / name)], check=True, stdout=subprocess.DEVNULL)
            resources.mkdir(parents=True)
            subprocess.run(['python3', str(ROOT / 'scripts/make-icns.py'), str(iconset), str(resources / 'AnyWork.icns')], check=True)
        else:
            resources = folder / 'resources'
            shutil.copy2(ROOT / ('target/release/anywork-desktop' + suffix), folder / ('anywork-desktop' + suffix))
        (resources / 'bin').mkdir(parents=True)
        shutil.copy2(ROOT / ('target/release/anywork' + suffix), resources / ('bin/anywork' + suffix))
        shutil.copytree(ROOT / 'web/dist', resources / 'web')
        shutil.copytree(ROOT / 'licenses', resources / 'licenses')
        (resources / 'plugins').mkdir()
        shutil.copy2(ROOT / 'plugins/README.md', resources / 'plugins/README.md')
        (resources / 'artifacts').mkdir()
        shutil.copy2(ROOT / 'artifacts/anywork-source.tar.gz', resources / 'artifacts/anywork-source.tar.gz')
        for name in ['LICENSE', 'NOTICE']:
            shutil.copy2(ROOT / name, resources / name)
        (folder / 'START-HERE.txt').write_text('AnyWork ' + json.loads((ROOT / 'package.json').read_text())['version'] + '\n\nEnglish: https://ywateru.github.io/AnyWork/en/\n中文: https://ywateru.github.io/AnyWork/zh/\n\nInstall and sign into Codex on the host first.\nOpen AnyWork.app (macOS) or anywork-desktop (Linux/Windows).\nKeep the resources directory beside the portable executable.\nmacOS: ad-hoc signed, not notarized. Windows: unsigned, requires WebView2.\nLinux: requires GTK 3 and WebKitGTK 4.1; see the installation guide.\nDesktop sharing uses version-dependent local Codex interfaces on Unix.\n\nCLI: cd into the resources directory, then run:\n  ./bin/anywork --web-dir web --workspace /absolute/path/to/projects\nWindows: .\\bin\\anywork.exe --web-dir web --workspace C:\\Projects\n\nThe token is in .anywork/access-token. Keep it private.\nLicense: AGPL-3.0-only. Source is included in resources/artifacts.\n', encoding='utf-8')
        if args.platform.startswith('macos'):
            subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
            # ditto preserves the signed macOS bundle metadata.
            subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(folder), str(output / f'anywork-{args.platform}.zip')], check=True)
        elif windows:
            with zipfile.ZipFile(output / f'anywork-{args.platform}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(folder.rglob('*')):
                    archive.write(path, path.relative_to(folder.parent))
        else:
            def neutral(info):
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                return info
            with tarfile.open(output / f'anywork-{args.platform}.tar.gz', 'w:gz') as archive:
                archive.add(folder, arcname='AnyWork', filter=neutral)
    print(f'Packaged {args.platform}')

if __name__ == '__main__':
    main()
