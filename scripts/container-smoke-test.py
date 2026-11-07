#!/usr/bin/env python3
"""Clean Docker acceptance with disposable volumes and a local RPC fixture only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def build_diagnostics(raw):
    """Keep a bounded, credential-scrubbed build-only tail; never runtime logs."""
    text = raw[-65536:].decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = ''.join(char for char in text if char in '\n\t' or 32 <= ord(char) < 127)
    lines = []
    for line in text.splitlines():
        if re.search(r'(?i)(token|secret|password|authorization|credential|private.?key)', line):
            lines.append('[credential-bearing build line redacted]')
            continue
        line = re.sub(r'https?://\S+', '[URL redacted]', line)
        line = re.sub(r'(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)', '[credential redacted]', line)
        lines.append(line)
    return ('\n'.join(lines))[-8192:]


def docker(*args, timeout=60):
    if args[0] == 'build':
        # Do not retain an unbounded build log in memory or dump runtime logs.
        with tempfile.TemporaryFile() as log:
            failed = False
            try:
                result = subprocess.run(['docker', *args], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
                failed = result.returncode != 0
            except subprocess.TimeoutExpired:
                failed = True
            if failed:
                log.seek(0, 2); size = log.tell(); log.seek(max(0, size - 65536))
                safe = build_diagnostics(log.read())
                path = ROOT / 'artifacts/container-build-diagnostics.log'
                path.parent.mkdir(exist_ok=True)
                path.write_text(safe); path.chmod(0o600)
                print('Isolated build diagnostics (scrubbed, at most 8 KiB):\n' + safe)
                raise RuntimeError('Docker build failed or timed out; see artifacts/container-build-diagnostics.log')
        return ''
    result = subprocess.run(['docker', *args], cwd=ROOT, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Docker operation failed (' + args[0] + '); runtime output was withheld to protect the generated access key')
    return result.stdout.decode().strip()


def verify_web_identity(request, version, source_digest):
    """Check source/version association and every served file digest, not JS presence."""
    identity = json.loads(request('/build-identity.json'))
    if not isinstance(identity, dict) or identity.get('schema') != 1 or identity.get('appVersion') != version or identity.get('sourceSha256') != source_digest:
        raise RuntimeError('Web build source/version identity mismatch')
    files = identity.get('files')
    fingerprint = identity.get('appFingerprint')
    if not isinstance(files, dict) or not 2 <= len(files) <= 5000 or '/index.html' not in files or not isinstance(fingerprint, str) or not re.fullmatch(r'anywork-[a-f0-9]{16}', fingerprint):
        raise RuntimeError('Malformed Web build identity')
    fetched = {}; total = 0
    for path, digest in files.items():
        if not isinstance(path, str) or not re.fullmatch(r'/[A-Za-z0-9_./-]+', path) or any(part in ('', '.', '..') for part in path[1:].split('/')) or path.startswith(('/api/', '/ws/')) or path == '/source' or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise RuntimeError('Unsafe Web build manifest entry')
        content = request('/' if path == '/index.html' else path)
        total += len(content)
        if total > 300 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != digest:
            raise RuntimeError('Served Web file differs from build identity')
        fetched[path] = content if path == '/index.html' else None
    html = fetched['/index.html'].decode()
    marker = re.search(r'<meta name="app-version" content="(anywork-[a-f0-9]{16})">', html)
    asset = re.search(r'(?:src|href)="(/assets/[^" ]+\.js)"', html)
    if not marker or marker[1] != fingerprint or not asset or asset[1] not in files:
        raise RuntimeError('Web entrypoint does not match the identified build')


def cleanup_docker(*args):
    try:
        subprocess.run(['docker', *args], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        print('Warning: an owned disposable Docker resource could not be cleaned; check the unique smoke resource names')


def acceptance(image, prefix, fixture, version, source_digest):
    container = prefix + '-server'
    volumes = [prefix + suffix for suffix in ('-data', '-workspace', '-codex')]
    created_volumes = []
    def start():
        docker('run', '-d', '--name', container, '-p', '127.0.0.1::3210',
               '-v', volumes[0]+':/data', '-v', volumes[1]+':/workspace',
               '-v', volumes[2]+':/home/agent/.codex',
               '-v', str(fixture)+':/fixture:ro', image,
               '--codex-discovery', 'false', '--plugins-dir', '/fixture')
        mapping = docker('port', container, '3210/tcp')
        if not re.fullmatch(r'127\.0\.0\.1:\d+', mapping): raise RuntimeError('Unexpected published address')
        base = 'http://' + mapping
        for _ in range(150):
            try:
                with urllib.request.urlopen(base+'/api/health', timeout=1) as response:
                    if json.load(response)['version'] != version: raise RuntimeError('Server version mismatch')
                break
            except (OSError, urllib.error.URLError): time.sleep(.2)
        else: raise RuntimeError('Isolated container did not become healthy')
        return base
    def request(base, path, token=None, body=None):
        headers = {'Authorization': 'Bearer '+token} if token else {}
        if body is not None: headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(base+path, headers=headers,
                                        data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(request, timeout=10) as response: return response.read()
    def read_token():
        return docker('exec', container, 'node', '-e', "process.stdout.write(require('fs').readFileSync('/data/access-token','utf8').trim())")
    try:
        for volume in volumes:
            created_volumes.append(volume)
            docker('volume', 'create', volume)
        base = start()
        if docker('exec', container, 'id', '-u') != '10001': raise RuntimeError('Container is not the expected non-root user')
        token = read_token()
        if len(token) < 16: raise RuntimeError('Missing generated access key')
        try: request(base, '/api/info', 'incorrect-container-smoke-token')
        except urllib.error.HTTPError as error:
            if error.code != 401: raise RuntimeError('Incorrect authentication response') from None
        else: raise RuntimeError('Unauthenticated API was accepted')
        if json.loads(request(base, '/api/info', token))['version'] != version: raise RuntimeError('API version mismatch')
        verify_web_identity(lambda path: request(base, path), version, source_digest)
        if hashlib.sha256(request(base, '/source')).hexdigest() != source_digest: raise RuntimeError('Corresponding source differs')
        session = json.loads(request(base, '/api/sessions', token, dict(agent='container-fixture', cwd='/workspace', title='Container persistence')))['session']
        if session['agent'] != 'container-fixture': raise RuntimeError('Fixture Agent was not used')
        docker('exec', container, 'node', '-e', "require('fs').writeFileSync('/workspace/persistent.txt','container-smoke')")
        docker('stop', '--time', '10', container)
        docker('rm', container)
        base = start()
        if read_token() != token: raise RuntimeError('Access key changed after recreate')
        restored = json.loads(request(base, '/api/sessions/'+session['id'], token))['session']
        if restored['title'] != 'Container persistence': raise RuntimeError('Session was not persisted')
        if docker('exec', container, 'node', '-e', "process.stdout.write(require('fs').readFileSync('/workspace/persistent.txt','utf8'))") != 'container-smoke':
            raise RuntimeError('Workspace was not persisted')
        print('Passed: clean server image, UID 10001, auth, source-bound Web identity and file digests, exact corresponding source, session/workspace/access-key persistence; no model requests')
    finally:
        cleanup_docker('rm', '-f', container)
        for volume in created_volumes: cleanup_docker('volume', 'rm', volume)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--build', action='store_true', help='Build this source archive with --no-cache, then remove the owned image')
    choice.add_argument('--image', help='Test an existing image without removing it')
    args = parser.parse_args()
    prefix = 'anywork-smoke-' + uuid.uuid4().hex[:16]
    image = prefix if args.build else args.image
    if not image or image.startswith('-'): raise RuntimeError('Invalid container image reference')
    archive = ROOT / 'artifacts/anywork-source.tar.gz'
    if not archive.is_file(): raise RuntimeError('Run python3 scripts/source-archive.py before this test')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    docker('version', '--format', '{{.Server.Version}}')
    try:
        if args.build:
            docker('build', '--no-cache', '--progress=plain', '-t', image, '.', timeout=2400)
        reported = docker('run', '--rm', '--entrypoint', 'anywork', image, '--version')
        if reported != 'anywork ' + version: raise RuntimeError('Image binary version mismatch')
        with tempfile.TemporaryDirectory(prefix=prefix) as directory:
            fixture = Path(directory); fixture.chmod(0o755)
            (fixture/'agent.cjs').write_text("""require('readline').createInterface({input:process.stdin}).on('line',line=>{
const r=JSON.parse(line);if(r.id===undefined)return;let result={};
if(r.method==='initialize')result={userAgent:'container-fixture'};
if(r.method==='thread/start'||r.method==='thread/resume')result={thread:{id:r.params.threadId||'container-fixture-thread'}};
console.log(JSON.stringify({id:r.id,result}));});
""")
            (fixture/'fixture.json').write_text(json.dumps(dict(id='container-fixture', name='Container fixture', protocol_version=1, command='node', args=['/fixture/agent.cjs'], capabilities=['chat', 'resume'])))
            for path in fixture.iterdir(): path.chmod(0o644)
            acceptance(image, prefix, fixture, version, digest)
    finally:
        if args.build: cleanup_docker('image', 'rm', '-f', image)


if __name__ == '__main__':
    try: main()
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
        # Only fixed diagnostics are safe; transport errors may embed private data.
        print('Container acceptance failed: ' + str(error) if isinstance(error, RuntimeError) else 'Container acceptance failed: local prerequisite or transport error')
        raise SystemExit(1)
