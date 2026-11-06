#!/usr/bin/env python3
"""Test the installed Codex CLI through the real Web client using a local model.

Creates an isolated home, workspace, server and new chat. No account or desktop
app is used. The fixture approval is declined so its command cannot execute.
"""
import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('shared_fixture', ROOT / 'scripts/shared-engine-probe.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


class Model(shared.Model):
    def do_GET(self):
        fixture = self.server.fixture
        if self.path == '/control/status':
            data = {'count': len(fixture['requests']), 'holding': fixture['holding'].is_set()}
        elif self.path.startswith('/control/plan/') and self.path.rsplit('/', 1)[-1] in {'approval', 'hold', 'message'}:
            with fixture['lock']:
                fixture['plans'].append(self.path.rsplit('/', 1)[-1])
            fixture['holding'].clear()
            fixture['release'].clear()
            data = {'ok': True}
        elif self.path == '/control/release':
            fixture['release'].set()
            data = {'ok': True}
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def stop_group(process):
    if process is None:
        return
    # Both children below start a new session; only their owned group is stopped.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def run(cli, server, web):
    if os.name != 'posix':
        raise RuntimeError('This isolated process-group harness currently requires macOS/Linux')
    if '/Applications/' in str(cli):
        raise RuntimeError('Use a separately installed Codex CLI, not the reference desktop bundle')
    with tempfile.TemporaryDirectory(prefix='anywork-real-browser-') as temporary:
        root = pathlib.Path(temporary)
        home, workspace = root / 'codex-home', root / 'workspace'
        home.mkdir()
        workspace.mkdir()
        (workspace / 'README.md').write_text('# Real engine browser fixture\n\nLocal isolated document.\n')
        model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
        model.daemon_threads = True
        model.fixture = {'lock': threading.Lock(), 'requests': [], 'plans': [],
                         'holding': threading.Event(), 'release': threading.Event()}
        threading.Thread(target=model.serve_forever, daemon=True).start()
        (home / 'config.toml').write_text(
            'model="shared-probe"\nmodel_provider="local_probe"\napprovals_reviewer="user"\n'
            '[model_providers.local_probe]\nname="Local deterministic fixture"\n'
            f'base_url="http://127.0.0.1:{model.server_port}/v1"\n'
            'wire_api="responses"\nrequires_openai_auth=false\n')
        env = {key: value for key, value in os.environ.items()
               if key in {'PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL'}}
        env.update(CODEX_HOME=str(home), CODEX_BIN=str(cli), DO_NOT_TRACK='1', RUST_LOG='error')
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        url = f'http://127.0.0.1:{port}'
        (ROOT / 'artifacts').mkdir(exist_ok=True)
        info = {'url': url, 'model': f'http://127.0.0.1:{model.server_port}',
                'engine_version': subprocess.check_output([str(cli), '--version'], env=env, text=True).strip(),
                'workspace': str(workspace),
                'screenshot': str(ROOT / 'artifacts/anywork-real-engine-browser.png'),
                'report': str(ROOT / 'artifacts/anywork-real-engine-browser.json')}
        context = root / 'context.json'
        context.write_text(json.dumps(info))
        process = browser = None
        with (root / 'server.log').open('w+') as log:
            try:
                process = subprocess.Popen([
                    str(server), '--codex-discovery', 'false', '--bind', f'127.0.0.1:{port}',
                    '--workspace', str(workspace), '--data-dir', str(root / 'data'),
                    '--plugins-dir', str(root / 'plugins'), '--web-dir', str(web),
                    '--token', 'isolated-real-engine-browser-fixture'],
                    env=env, stdout=log, stderr=log, start_new_session=True)
                deadline = time.monotonic() + 15
                while True:
                    try:
                        urllib.request.urlopen(url + '/api/health', timeout=1).close()
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError('Isolated AnyWork server did not become ready')
                        time.sleep(.05)
                browser = subprocess.Popen([
                    shutil.which('node') or 'node', str(ROOT / 'scripts/real-engine-browser-check.cjs'),
                    str(context)], cwd=ROOT, start_new_session=True)
                code = browser.wait(timeout=150)
                if code:
                    raise RuntimeError(f'Real-engine browser checks failed ({code})')
            finally:
                model.fixture['release'].set()
                stop_group(browser)
                stop_group(process)
                model.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex', default=shutil.which('codex'))
    parser.add_argument('--server', type=pathlib.Path, default=ROOT / 'target/debug/anywork')
    parser.add_argument('--web', type=pathlib.Path, default=ROOT / 'web/dist')
    args = parser.parse_args()
    if not args.codex or not args.server.is_file() or not (args.web / 'index.html').is_file():
        parser.error('Build AnyWork/Web and install a separate Codex CLI first')
    run(pathlib.Path(args.codex).resolve(), args.server.resolve(), args.web.resolve())
