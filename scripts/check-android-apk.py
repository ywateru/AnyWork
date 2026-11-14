#!/usr/bin/env python3
"""Verify the APK from the canonical Tauri entry; no device or network access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ABI_ELF = {
    'arm64-v8a': (2, 183),
    'armeabi-v7a': (1, 40),
    'x86': (1, 3),
    'x86_64': (2, 62),
}


def check_elf(data, abi=None):
    if data[:4] != b'\x7fELF' or data[5] != 1:
        raise ValueError('Expected little-endian Android ELF')
    bits = data[4]
    if abi is not None and (bits, struct.unpack_from('<H', data, 18)[0]) != ABI_ELF[abi]:
        raise ValueError('Native ELF architecture does not match APK ABI: ' + abi)
    if bits == 2:
        offset = struct.unpack_from('<Q', data, 32)[0]
        stride, count = struct.unpack_from('<HH', data, 54)
        align_offset, align_format = 48, '<Q'
    elif bits == 1:
        offset = struct.unpack_from('<I', data, 28)[0]
        stride, count = struct.unpack_from('<HH', data, 42)
        align_offset, align_format = 28, '<I'
    else:
        raise ValueError('Invalid ELF class')
    loads = 0
    for index in range(count):
        start = offset + index * stride
        if struct.unpack_from('<I', data, start)[0] == 1:
            loads += 1
            if struct.unpack_from(align_format, data, start + align_offset)[0] < 16384:
                raise ValueError('Native PT_LOAD alignment is smaller than 16 KiB')
    if not loads:
        raise ValueError('Native ELF contains no loadable segment')


def check_native_layout(archive, abi):
    native = [info for info in archive.infolist() if info.filename.startswith('lib/') and info.filename.endswith('.so')]
    expected = f'lib/{abi}/libanywork_mobile.so'
    libraries = [info for info in native if info.filename == expected]
    if len(libraries) != 1:
        raise ValueError('APK must contain exactly one ' + expected)
    if any(not re.fullmatch(r'lib/' + re.escape(abi) + r'/[^/]+\.so', info.filename) for info in native):
        raise ValueError('APK must contain only the requested ABI: ' + abi)
    for info in native:
        check_elf(archive.read(info), abi)
    return libraries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--profile', choices=['debug', 'release'], required=True)
    parser.add_argument('--abi', choices=list(ABI_ELF), required=True,
                        help='Require exactly this ABI, including matching native ELF headers')
    args = parser.parse_args()
    sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', str(Path.home() / 'Library/Android/sdk'))))
    tools = sdk / 'build-tools/36.0.0'
    config = json.loads((ROOT / 'crates/mobile/tauri.conf.json').read_text())
    result = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(args.apk)], text=True)
    for expected in ["name='dev.remoteagent.app'", f"versionCode='{config['bundle']['android']['versionCode']}'", f"versionName='{config['version']}'", "sdkVersion:'26'"]:
        if expected not in result:
            raise ValueError('APK upgrade metadata mismatch: ' + expected)
    if config['bundle']['android']['versionCode'] <= 31:
        raise ValueError('APK cannot upgrade legacy versionCode 31')
    ui_files = [p.relative_to(ROOT / 'web/dist-mobile').as_posix().encode() for p in (ROOT / 'web/dist-mobile').rglob('*') if p.is_file() and p.suffix in ['.html', '.js', '.css', '.txt']]
    if b'mobile.html' not in ui_files:
        raise ValueError('Bundled UI has not been built')
    notice = ROOT / 'web/dist-mobile/THIRD_PARTY_NOTICES.txt'
    if not notice.is_file() or 'Logto' not in notice.read_text():
        raise ValueError('Mobile bundle lacks the Logto SDK third party notice')
    with zipfile.ZipFile(args.apk) as archive:
        libraries = check_native_layout(archive, args.abi)
        for info in libraries:
            native = archive.read(info)
            if any(path not in native for path in ui_files):
                raise ValueError('Native library lacks the built local asset keys: ' + info.filename)
    subprocess.run([str(tools / 'zipalign'), '-c', '-P', '16', '4', str(args.apk)], check=True, capture_output=True)
    cert = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--print-certs', str(args.apk)], text=True)
    digest = re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)', cert)
    if not digest:
        raise ValueError('APK lacks a verified signing certificate')
    if args.profile == 'release':
        certificate = subprocess.check_output(['keytool', '-exportcert', '-keystore', os.environ['ANYWORK_ANDROID_KEYSTORE'], '-alias', os.environ.get('ANYWORK_ANDROID_KEY_ALIAS', 'anywork'), '-storepass:env', 'ANYWORK_ANDROID_STORE_PASSWORD'], stderr=subprocess.PIPE)
        if digest[1].lower() != hashlib.sha256(certificate).hexdigest():
            raise ValueError('APK does not use the configured upgrade certificate')
    print(f'Verified Android identity, bundled UI, native libraries, signing and 16 KiB alignment (1 ABI: {args.abi}).')


if __name__ == '__main__':
    main()
