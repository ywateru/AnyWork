#!/usr/bin/env python3
"""Isolated HTTP checks for authenticated client presence; never opens a real Codex thread."""
import json, os, pathlib, socket, subprocess, tempfile, time, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parents[1]
BINARY = pathlib.Path(os.environ.get('ANYWORK_TEST_BINARY', ROOT / 'target/release/anywork'))
TOKEN = 'client-presence-isolated-test-token'

def run(trust_proxy):
    with tempfile.TemporaryDirectory(prefix='anywork-client-test-') as directory:
        root = pathlib.Path(directory)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
        args = [str(BINARY), '--bind', f'127.0.0.1:{port}', '--workspace', str(root), '--data-dir', str(root/'data'), '--codex-discovery', 'false', '--token', TOKEN]
        if trust_proxy: args += ['--trust-local-proxy']
        process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def request(path, headers=None, auth=True, method='GET'):
            h = {'Authorization': f'Bearer {TOKEN}'} if auth else {}
            h.update(headers or {})
            with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/api{path}', headers=h, method=method), timeout=3) as response: return json.load(response)
        try:
            for _ in range(80):
                try: request('/health', auth=False); break
                except (OSError, urllib.error.URLError): time.sleep(.1)
            else: raise RuntimeError('test server did not start')
            device = {'X-AnyWork-Client-Id': 'isolated-android-device', 'User-Agent': 'AnyWork-Android/fixture', 'CF-Connecting-IP': '203.0.113.5'}
            assert request('/clients')['clients'] == []
            try: request('/clients/heartbeat', device, auth=False, method='POST'); raise AssertionError('unauthenticated presence accepted')
            except urllib.error.HTTPError as error: assert error.code == 401
            assert request('/clients')['clients'] == []
            request('/clients/heartbeat', device, method='POST')
            clients = request('/clients')['clients']; assert len(clients) == 1
            assert clients[0]['address'] == ('203.0.113.5' if trust_proxy else '127.0.0.1')
            assert clients[0]['user_agent'] == 'AnyWork-Android/fixture'
            before = clients[0]['connected_at']
            request('/info', device)
            clients = request('/clients')['clients']; assert len(clients) == 1 and clients[0]['connected_at'] == before
            assert clients[0]['last_seen'] >= before
            assert TOKEN not in json.dumps(clients)
            request('/clients/heartbeat', {'X-AnyWork-Client-Id': 'short'}, method='POST')
            assert len(request('/clients')['clients']) == 1
            print(f'Client HTTP: auth, heartbeat, deduplication, key exclusion, address trust={trust_proxy}, invalid IDs passed')
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
if __name__ == '__main__': run(False); run(True)
