#!/usr/bin/env python3
"""Assemble the static homepage, account app, and exact-source offer for Vercel."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'site/dist'

def main():
    if not (DIST / 'en/index.html').is_file() or not (ROOT / 'web/dist/index.html').is_file():
        raise RuntimeError('Build the bilingual site and /app/ Web bundle first')
    subprocess.run(['python3', 'scripts/cloud/prepare-frontend.py', '--check'], cwd=ROOT, check=True)
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    declared = os.environ.get('SOURCE_COMMIT') or os.environ.get('VERCEL_GIT_COMMIT_SHA')
    if declared and declared != source:
        raise RuntimeError('Deployment source does not match checkout HEAD')
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise RuntimeError('Invalid source revision')
    app = DIST / 'app'
    if app.exists():
        shutil.rmtree(app)
    shutil.copytree(ROOT / 'web/dist', app)
    # The account app resolves its images under /app/. Keep the original public
    # /agents/ links usable too, with exactly the same bundled static bytes.
    agents = DIST / 'agents'
    if agents.exists():
        shutil.rmtree(agents)
    shutil.copytree(ROOT / 'web/dist/agents', agents)
    version = json.loads((ROOT / 'package.json').read_text())['version']
    (DIST / 'build.json').write_text(json.dumps({'source': source, 'version': version}, separators=(',', ':')) + '\n')
    subprocess.run(['python3', 'scripts/source-archive.py', '--revision', source], cwd=ROOT, check=True)
    shutil.copy2(ROOT / 'artifacts/anywork-source.tar.gz', DIST / 'anywork-source.tar.gz')
    print('Assembled static website and account application with exact-source offer')

if __name__ == '__main__':
    main()
