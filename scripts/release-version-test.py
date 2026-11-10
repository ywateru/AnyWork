#!/usr/bin/env python3
"""Exercise real version bumps and complete signed manifest assembly offline."""
import base64
import importlib
import json
import pathlib
import re
import shutil
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
bump = importlib.import_module('bump-version')
guard = importlib.import_module('check-release-version')
updater = importlib.import_module('updater-artifacts')

class ReleaseVersions(unittest.TestCase):
    def test_bump_updates_all_embedded_versions_and_rejects_reuse(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'web/package.json', 'desktop/ui/package.json', 'crates/desktop/tauri.conf.json', 'desktop/Info.plist', 'android/app/build.gradle.kts']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            original = bump.current_version(root)
            new = bump.bump('patch', root)
            self.assertGreater(bump.version_tuple(new), bump.version_tuple(original))
            self.assertEqual(guard.check_local('v' + new, root)[0], new)
            lock = root / 'Cargo.lock'
            valid_lock = lock.read_text()
            lock.write_text(re.sub(r'(name = "anywork-remote"\nversion = ")[^"]+', lambda m: m[1] + original, valid_lock))
            with self.assertRaisesRegex(ValueError, 'Workspace lock version mismatch: anywork-remote'):
                guard.check_local('v' + new, root)
            lock.write_text(valid_lock)
            for value in [new, original, '0.0.0', '1.00.0', '1.0.0-beta']:
                with self.assertRaises(ValueError):
                    bump.bump(value, root)
            with self.assertRaises(ValueError):
                guard.check_local('v' + original, root)
            major = bump.bump('major', root)
            self.assertEqual(guard.check_local('v' + major, root)[0], major)

    def test_published_version_order_is_numeric_and_strict(self):
        releases = [{'tag_name': 'v0.1.9'}, {'tag_name': 'v0.2.0-beta', 'prerelease': True}]
        guard.check_published('0.1.10', releases)
        for version in ['0.1.8', '0.1.9', '0.0.99']:
            with self.assertRaises(ValueError):
                guard.check_published(version, releases)
        guard.check_published('0.1.10', [{'tag_name': 'v9.0.0', 'draft': True}])

    def test_manifest_requires_every_target_and_matching_versioned_signatures(self):
        fixture = json.loads((ROOT / 'crates/desktop/tests/fixtures/signed-update.json').read_text())
        with tempfile.TemporaryDirectory() as temp:
            directory = pathlib.Path(temp)
            with self.assertRaisesRegex(ValueError, 'Missing macOS installer'):
                updater.manifest(directory, '9.0.0', 'notes')
            for platform, (target, _, _, suffix) in updater.PLATFORMS.items():
                name = 'anywork-' + platform + suffix
                (directory / name).write_text(fixture['payload'])
                (directory / (name + '.sig')).write_text(fixture['signature'])
                (directory / ('updater-' + platform + '.json')).write_text(json.dumps({'target': target, 'filename': name, 'signature': fixture['signature']}))
            for platform in ['macos-arm64', 'macos-x86_64']:
                with self.assertRaisesRegex(ValueError, 'Missing macOS installer'):
                    updater.manifest(directory, '9.0.0', 'notes')
                (directory / f'anywork-{platform}.dmg').write_bytes(b'fixture-dmg')
            image = directory / 'anywork-macos-arm64.dmg'
            image.write_bytes(b'')
            with self.assertRaisesRegex(ValueError, 'Missing macOS installer'):
                updater.manifest(directory, '9.0.0', 'notes')
            image.write_bytes(b'fixture-dmg')
            with self.assertRaises(ValueError):
                updater.manifest(directory, '9.0.1', 'notes')
            result = updater.manifest(directory, '9.0.0', 'notes')
            self.assertEqual(len(result['platforms']), 5)
            self.assertEqual(list(directory.glob('updater-*.json')), [])
            self.assertTrue(all('/v9.0.0/' in item['url'] for item in result['platforms'].values()))
        legacy = base64.b64encode(b'untrusted comment: test\nabc\ntrusted comment: timestamp:1\nabc').decode()
        with self.assertRaises(ValueError):
            updater.signature_version(legacy)

if __name__ == '__main__':
    unittest.main(verbosity=2)
