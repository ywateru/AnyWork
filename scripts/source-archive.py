#!/usr/bin/env python3
"""Export tracked public source; never walk an entire developer workspace."""
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'artifacts/anywork-source.tar.gz'
MANIFEST = 'SOURCE_MANIFEST.json'
PRIVATE_PARTS = {
    '.git', '.anywork', '.remote-agent', '.codex', '.agents', '.aws', '.ssh',
    'node_modules', 'target', 'references', 'artifacts', 'dist', 'build',
    '.gradle', '.kotlin', '__pycache__', '.idea', '.vscode',
    'test-results', 'playwright-report', 'coverage', 'private', 'local',
    'backups', 'screenshots', 'captures', 'workspace',
}
PRIVATE_NAMES = {'supervisord.conf', 'local.properties', 'auth.json',
                 'credentials.json', 'access-token', MANIFEST}
PRIVATE_SUFFIXES = ('.log', '.pid', '.sock', '.db', '.sqlite', '.sqlite3',
                    '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore',
                    '.apk', '.aab', '.zip', '.tar', '.tar.gz', '.tgz',
                    '.bundle', '.tmp', '.bak', '.orig', '.pyc',
                    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm')
PUBLIC_IMAGES = {'web/public/icon-192.png', 'web/public/icon-512.png', 'desktop/icon.png', 'site/assets/social.png'}


def is_public(name):
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('Unsafe source manifest path')
    if any(part in PRIVATE_PARTS for part in path.parts):
        return False
    if path.name in PRIVATE_NAMES or path.name.startswith('credentials-'):
        return False
    if path.name.startswith('.env') and path.name != '.env.example':
        return False
    if name.startswith('plugins/') and path.suffix == '.json':
        return False
    if name.startswith('docs/local-'):
        return False
    if name in PUBLIC_IMAGES:
        return True
    if path.name.endswith(PRIVATE_SUFFIXES) or '.db-' in path.name or '.sqlite-' in path.name or '.sqlite3-' in path.name:
        return False
    return True


def source_files():
    if (ROOT / '.git').exists():
        result = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '-z'],
                                check=True, stdout=subprocess.PIPE)
        candidates = result.stdout.decode('utf-8').split('\0')
    elif (ROOT / MANIFEST).is_file():
        candidates = json.loads((ROOT / MANIFEST).read_text())
        if not isinstance(candidates, list) or not all(isinstance(p, str) for p in candidates):
            raise ValueError('Invalid source manifest')
    else:
        raise RuntimeError('Export source from a Git checkout or the generated source archive; no trusted file list is available')
    files = sorted({name for name in candidates if name and is_public(name)})
    for name in files:
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('Source symlinks must be reviewed before export')
        if not path.is_file():
            raise ValueError('Tracked source file is missing; stage deletions before exporting')
    return files


def public_metadata(info):
    # Source packages should not reveal the local OS account name or UID.
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    return info


def main():
    files = source_files()
    OUTPUT.parent.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=OUTPUT.parent, suffix='.tmp', delete=False) as temporary:
        path = pathlib.Path(temporary.name)
    try:
        with tarfile.open(path, 'w:gz') as archive:
            for name in files:
                archive.add(ROOT / name, arcname='anywork/' + name, recursive=False, filter=public_metadata)
            content = (json.dumps(files, ensure_ascii=False, indent=2) + '\n').encode()
            info = tarfile.TarInfo('anywork/' + MANIFEST)
            info.size = len(content)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(content))
        path.replace(OUTPUT)
    finally:
        path.unlink(missing_ok=True)
    print(OUTPUT)


if __name__ == '__main__':
    main()
