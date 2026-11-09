#!/usr/bin/env python3
"""Materialize Vercel builder references from exact tracked Git blobs only.

No provider calls. The caller supplies in-memory forbidden credential values and
persists the returned public receipt outside the upload tree.
"""
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-cybergrid.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
cloud = deploy.cloud


def safe_parts(value):
    cloud.require(isinstance(value, str) and value and '\\' not in value and ':' not in value
                  and not value.startswith('/') and all(p not in ('', '.', '..') for p in value.split('/')),
                  'Unsafe mapped path')
    parts = PurePosixPath(value).parts
    cloud.require(not any(p.startswith('.env') or p in {'.git', '.vercel', 'auth.json', 'diagnostics.json'} for p in parts),
                  'Private mapped path')
    return parts


def no_links(root, parts):
    cloud.require(not root.is_symlink(), 'Mapped symlinks are forbidden')
    current = root
    for part in parts:
        cloud.require(not current.exists() or current.is_dir(), 'Mapped parent must be a directory')
        current = current / part
        cloud.require(not current.is_symlink(), 'Mapped symlinks are forbidden')
    return current


def materialize(upload, source_tree, revision, forbidden):
    cloud.require(re.fullmatch('[0-9a-f]{40}', revision or ''), 'Full adapted source revision required')
    cloud.require(upload.is_absolute() and source_tree.is_absolute(), 'Absolute isolated paths required')
    cloud.require(not upload.is_symlink() and not source_tree.is_symlink(), 'Root symlinks are forbidden')
    def git(*args):
        result = subprocess.run(['git', '-C', str(source_tree), *args], capture_output=True)
        cloud.require(result.returncode == 0, 'Tracked source verification failed')
        return result.stdout
    cloud.require(git('rev-parse', 'HEAD').decode().strip() == revision, 'Source HEAD differs')
    cloud.require(not git('status', '--porcelain', '--untracked-files=no'), 'Tracked source worktree is dirty')
    entries = {}
    for row in git('ls-tree', '-rz', '--full-tree', revision).split(b'\0'):
        if row:
            metadata, path = row.split(b'\t', 1)
            mode, kind, oid = metadata.decode().split(' ')
            entries[path.decode()] = (mode, kind, oid)
    functions = upload / '.vercel/output/functions'
    cloud.require(functions.is_dir(), 'Expected prebuilt functions')
    needles = [v.encode() for v in forbidden if isinstance(v, str) and len(v) >= 8]
    plans, configs, receipt = {}, [], {'schema': 1, 'transform': 'tracked-file-path-map-v1', 'source': revision, 'functions': []}
    for config in sorted(functions.rglob('.vc-config.json')):
        no_links(upload, config.relative_to(upload).parts)
        raw = config.read_bytes()
        document = json.loads(raw)
        mapping = document.get('filePathMap')
        if mapping is None:
            continue
        cloud.require(isinstance(mapping, dict) and mapping, 'Invalid function filePathMap')
        files = []
        for target_name, source_name in sorted(mapping.items()):
            target_parts, source_parts = safe_parts(target_name), safe_parts(source_name)
            cloud.require(source_name in entries, 'Mapped source is not tracked')
            mode, kind, oid = entries[source_name]
            cloud.require(kind == 'blob' and mode in {'100644', '100755'}, 'Mapped source must be a regular tracked blob')
            source = no_links(source_tree, source_parts)
            blob = git('cat-file', 'blob', oid)
            cloud.require(source.is_file() and source.read_bytes() == blob, 'Mapped source bytes differ from Git')
            cloud.require(not any(n in blob for n in needles), 'Known private credential appears in mapped file')
            target = no_links(config.parent, target_parts)
            cloud.require(target != config and target_name != '.vc-config.json', 'Mapped target conflicts with configuration')
            if target.exists():
                cloud.require(target.is_file() and target.read_bytes() == blob and target.stat().st_mode & 0o777 == int(mode[-3:], 8),
                              'Mapped target conflicts with existing function file')
            previous = plans.get(target)
            cloud.require(previous is None or previous == (blob, mode), 'Mapped targets conflict')
            plans[target] = (blob, mode)
            files.append({'target': target_name, 'source': source_name, 'blob': oid,
                          'sha256': hashlib.sha256(blob).hexdigest(), 'mode': mode})
        del document['filePathMap']
        changed = (json.dumps(document, indent=2) + '\n').encode()
        configs.append((config, changed))
        receipt['functions'].append({'config': config.relative_to(upload).as_posix(), 'files': files,
                                    'before': hashlib.sha256(raw).hexdigest(), 'after': hashlib.sha256(changed).hexdigest()})
    # Reject any target ancestor that another mapping intends to create as a file.
    cloud.require(not any(parent in plans for target in plans for parent in target.parents), 'Mapped file/directory conflict')
    for target, (blob, mode) in plans.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
        target.chmod(int(mode[-3:], 8))
    for config, changed in configs:
        config.write_bytes(changed)
    return receipt
