#!/usr/bin/env python3
"""Verify explicit desktop service control against an isolated real server and fake agent."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'isolated-service-control-test-token'


class ServiceControl(unittest.TestCase):
    def test_authenticated_local_stop_preserves_data_and_rejects_busy_or_proxied_requests(self):
        with tempfile.TemporaryDirectory(prefix='anywork-service-control-') as temp:
            base = Path(temp)
            workspace = base / 'workspace'
            workspace.mkdir()
            plugins = base / 'plugins'
            plugins.mkdir()
            (plugins / 'fixture.json').write_text(json.dumps({
                'id': 'fixture', 'name': 'Fixture', 'protocol_version': 1,
                'command': 'python3', 'args': [str(ROOT / 'scripts/fake-agent.py')],
                'capabilities': ['chat', 'resume', 'interrupt'],
            }))
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            binary = os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork'))
            args = [binary, '--codex-discovery', 'false', '--bind', f'127.0.0.1:{port}',
                    '--workspace', str(workspace), '--data-dir', str(base / 'data'),
                    '--plugins-dir', str(plugins), '--web-dir', str(ROOT / 'web/dist')]
            # Use a private key file instead of putting a real credential on a process command line.
            (base / 'data').mkdir()
            (base / 'data/access-token').write_text(TOKEN)
            processes = []
            def start():
                process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env={**os.environ, 'FAKE_AGENT_STATE_DIR': str(base / 'fixture-state')})
                processes.append(process)
                for _ in range(200):
                    try:
                        urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1).close()
                        return process
                    except OSError:
                        if process.poll() is not None:
                            self.fail('Isolated service exited before becoming healthy')
                        time.sleep(.05)
                self.fail('Isolated service did not start')
            def request(path, body=None, headers=None, token=TOKEN):
                values = {'Authorization': 'Bearer ' + token}
                values.update(headers or {})
                data = None if body is None else json.dumps(body).encode()
                if data is not None:
                    values['Content-Type'] = 'application/json'
                try:
                    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/api' + path,
                            data=data, headers=values), timeout=5) as response:
                        return response.status, json.load(response)
                except urllib.error.HTTPError as error:
                    return error.code, json.load(error)
            def wait_status(sid, expected):
                for _ in range(150):
                    _, body = request('/sessions/' + sid)
                    if body['session']['status'] == expected:
                        return
                    time.sleep(.02)
                self.fail(f'Session did not become {expected}')
            desktop = {'X-AnyWork-Service-Control': 'desktop'}
            try:
                process = start()
                self.assertTrue(request('/info')[1]['local_service_control'])
                self.assertEqual(request('/service/stop', {}, desktop, token='wrong')[0], 401)
                self.assertEqual(request('/service/stop', {})[0], 403)
                for header in ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'CF-Connecting-IP', 'X-Real-IP', 'Origin']:
                    self.assertEqual(request('/service/stop', {}, {**desktop, header: 'example'})[0], 403, header)
                self.assertIsNone(process.poll())
                _, created = request('/sessions', {'cwd': str(workspace), 'agent': 'fixture'})
                sid = created['session']['id']
                wait_status(sid, 'idle')
                request('/sessions/' + sid + '/messages', {'text': 'slow'})
                wait_status(sid, 'running')
                self.assertEqual(request('/service/stop', {}, desktop)[0], 409)
                self.assertIsNone(process.poll())
                request('/sessions/' + sid + '/interrupt', {})
                wait_status(sid, 'idle')
                self.assertEqual(request('/service/stop', {}, desktop), (200, {'stopping': True}))
                self.assertEqual(process.wait(timeout=10), 0)
                self.assertEqual((base / 'data/access-token').read_text(), TOKEN)
                process = start()
                self.assertEqual(request('/sessions/' + sid)[0], 200)
                self.assertEqual(request('/service/stop', {}, desktop)[0], 200)
                self.assertEqual(process.wait(timeout=10), 0)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)


if __name__ == '__main__':
    unittest.main(verbosity=2)
