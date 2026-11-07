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


def docker(*args, timeout=60):
    result = subprocess.run(['docker', *args], cwd=ROOT, capture_output=True, timeout=timeout)
    if result.returncode:
        # Container/config/log output can contain credentials. Never echo it.
        raise RuntimeError('Docker operation failed (' + args[0] + '); inspect the isolated CI step')
    return result.stdout.decode().strip()


def acceptance(image, prefix, fixture, version, source_digest):
    container = prefix + '-server'
    volumes = [prefix + suffix for suffix in ('-data', '-workspace', '-codex')]
    for volume in volumes: docker('volume', 'create', volume)
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
        base = start()
        if docker('exec', container, 'id', '-u') != '10001': raise RuntimeError('Container is not the expected non-root user')
        token = read_token()
        if len(token) < 16: raise RuntimeError('Missing generated access key')
        try: request(base, '/api/info', 'incorrect-container-smoke-token')
        except urllib.error.HTTPError as error:
            if error.code != 401: raise RuntimeError('Incorrect authentication response') from None
        else: raise RuntimeError('Unauthenticated API was accepted')
        if json.loads(request(base, '/api/info', token))['version'] != version: raise RuntimeError('API version mismatch')
        html = request(base, '/').decode()
        asset = re.search(r'(?:src|href)="(/assets/[^" ]+\.js)"', html)
        if not asset or not request(base, asset[1]): raise RuntimeError('Missing Web build or JavaScript asset')
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
        print('Passed: clean server image, UID 10001, auth, Web asset, exact corresponding source, session/workspace/access-key persistence; no model requests')
    finally:
        subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=30)
        for volume in volumes: subprocess.run(['docker', 'volume', 'rm', volume], capture_output=True, timeout=30)


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
        if args.build: subprocess.run(['docker', 'image', 'rm', '-f', image], capture_output=True, timeout=30)


if __name__ == '__main__':
    try: main()
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
        # Only fixed diagnostics are safe; transport errors may embed private data.
        print('Container acceptance failed: ' + str(error) if isinstance(error, RuntimeError) else 'Container acceptance failed: local prerequisite or transport error')
        raise SystemExit(1)
