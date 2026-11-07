#!/usr/bin/env python3
"""Check default built-ins against an isolated real server; no native hosts used."""
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = 'default-plugin-fixture-token'


class DefaultPlugins(unittest.TestCase):
    def check_catalog(self, with_home):
        with tempfile.TemporaryDirectory(prefix='anywork-plugin-catalog-', dir='/private/tmp' if pathlib.Path('/private/tmp').is_dir() else None) as tmp:
            root = pathlib.Path(tmp).resolve()
            workspace = root / 'workspace'
            workspace.mkdir()
            plugins = root / 'plugins'
            plugins.mkdir()
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(('ANYWORK_', 'REMOTE_AGENT_')) and key not in ('HOME', 'USERPROFILE')}
            if with_home:
                env['HOME'] = str(root)
            binary = os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork'))
            with (root / 'server.log').open('w+') as log:
                process = subprocess.Popen([binary, '--codex-discovery', 'false',
                    '--bind', f'127.0.0.1:{port}', '--workspace', str(workspace),
                    '--data-dir', str(root / 'data'), '--plugins-dir', str(plugins),
                    '--web-dir', str(root / 'web'), '--token', TOKEN], env=env, stdout=log, stderr=log)
                def request(path, data=None, token=TOKEN):
                    req = urllib.request.Request(f'http://127.0.0.1:{port}/api/{path}',
                        data=None if data is None else json.dumps(data).encode(),
                        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req, timeout=2) as response:
                        return json.load(response)
                try:
                    for _ in range(100):
                        try:
                            request('health')
                            break
                        except OSError:
                            if process.poll() is not None:
                                log.seek(0)
                                self.fail(log.read())
                            time.sleep(.05)
                    rows = request('plugins')['plugins']
                    by_id = {row['id']: row for row in rows}
                    self.assertEqual(set(by_id), {'codex', 'deepseek-harness', 'workbuddy'})
                    self.assertEqual(len(rows), 3)
                    self.assertTrue(by_id['codex']['available'])
                    for agent in ('deepseek-harness', 'workbuddy'):
                        self.assertFalse(by_id[agent]['available'])
                        self.assertIn('插件已启用', by_id[agent]['setup_hint'])
                        with self.assertRaises(urllib.error.HTTPError) as e:
                            request('sessions', {'agent': agent, 'cwd': str(workspace)})
                        self.assertEqual(e.exception.code, 400)
                    for row in rows:
                        self.assertEqual(set(row), {'id', 'name', 'capabilities', 'protocol_version', 'available', 'setup_hint'})
                    self.assertEqual(request('sessions')['sessions'], [])
                    self.assertFalse((root / '.anywork').exists())
                    # Invalid default discovery must not look configured or start a host.
                    if with_home:
                        for agent in ('harness', 'workbuddy'):
                            path = root / '.anywork' / agent / 'host.json'
                            path.parent.mkdir(parents=True, mode=0o700)
                            path.write_text('{}')
                            path.chmod(0o600)
                        rows = {row['id']: row for row in request('plugins')['plugins']}
                        self.assertFalse(rows['deepseek-harness']['available'])
                        self.assertFalse(rows['workbuddy']['available'])
                        self.assertEqual(request('sessions')['sessions'], [])
                        # A valid descriptor means configured, not verified-live.
                        # Catalog reads must not probe or attach either host.
                        with socket.socket() as host:
                            host.bind(('127.0.0.1', 0))
                            host.listen()
                            host.setblocking(False)
                            url = f'http://127.0.0.1:{host.getsockname()[1]}/'
                            secret = 'private-fixture-launch-token'
                            (root / '.anywork/harness/host.json').write_text(json.dumps({
                                'version': 1, 'url': url + '?token=' + secret}))
                            (root / '.anywork/workbuddy/host.json').write_text(json.dumps({
                                'version': 1, 'agent': 'workbuddy', 'appVersion': '5.9.3',
                                'pid': os.getpid(), 'url': url, 'browserId': str(uuid.uuid4()),
                                'configDir': str(root), 'instanceId': str(uuid.uuid4())}))
                            catalog = request('plugins')
                            rows = {row['id']: row for row in catalog['plugins']}
                            self.assertTrue(rows['deepseek-harness']['available'])
                            self.assertTrue(rows['workbuddy']['available'])
                            self.assertNotIn(secret, json.dumps(catalog))
                            self.assertNotIn(url, json.dumps(catalog))
                            with self.assertRaises(BlockingIOError):
                                host.accept()
                    with self.assertRaises(urllib.error.HTTPError) as e:
                        request('plugins', token='wrong')
                    self.assertEqual(e.exception.code, 401)
                finally:
                    process.terminate()
                    process.wait(timeout=10)

    def test_defaults_without_descriptors(self):
        self.check_catalog(True)

    def test_builtins_remain_registered_without_home(self):
        self.check_catalog(False)


if __name__ == '__main__':
    unittest.main()
