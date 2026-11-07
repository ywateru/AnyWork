#!/usr/bin/env python3
"""Publish AnyWork once, resume interruptions, and verify the public downloads.

python3 scripts/publish.py --help / npm run release -- --help
Only the standard library and Git are required. No local builds are performed.
"""
import argparse
import base64
import contextlib
import hashlib
import html.parser
import http.client
import importlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
versions = importlib.import_module('bump-version')
guard = importlib.import_module('check-release-version')
updater = importlib.import_module('updater-artifacts')
REPO = 'ywateru/AnyWork'
WEB = 'https://github.com/' + REPO
SITE = 'https://ywateru.github.io/AnyWork'
API = 'https://api.github.com/repos/' + REPO + '/'
FILES = ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json',
         'web/package.json', 'desktop/ui/package.json', 'crates/desktop/tauri.conf.json',
         'desktop/Info.plist', 'android/app/build.gradle.kts', 'docs/release-notes.md']
TARGETS = {target: 'anywork-' + platform + suffix
           for platform, (target, _, _, suffix) in updater.PLATFORMS.items()}
INSTALLERS = {'anywork-macos-arm64.dmg', 'anywork-macos-x86_64.dmg',
              'anywork-windows-x86_64-setup.exe', 'anywork-linux-x86_64.AppImage',
              'anywork-linux-arm64.AppImage', 'anywork-android.apk'}
ASSETS = set(TARGETS.values()) | {name + '.sig' for name in TARGETS.values()} | INSTALLERS | {
    'anywork-linux-x86_64.tar.gz', 'anywork-linux-arm64.tar.gz',
    'anywork-windows-x86_64.zip', 'anywork-source.tar.gz', 'anywork-web.tar.gz',
    'latest.json', 'SHA256SUMS'}


class Failure(Exception):
    pass


def require(value, message):
    if not value:
        raise Failure(message)


def valid_tag(tag):
    require(isinstance(tag, str) and re.fullmatch(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', tag),
            'Expected a stable release tag such as v0.1.13')
    return tag


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitHub:
    def __init__(self, token, sleep=time.sleep):
        require(isinstance(token, str) and (not token or all(33 <= ord(char) <= 126 for char in token)),
                'GitHub token contains invalid characters; replace it with a valid credential')
        self.token, self.sleep = token, sleep
        self.api_opener = urllib.request.build_opener(NoRedirect())
        self.public_opener = urllib.request.build_opener()

    def request(self, path, method='GET', data=None, public=False, missing=False):
        url = path if public else API + path
        if public:
            parsed = urllib.parse.urlsplit(url)
            require(parsed.scheme == 'https' and not parsed.username and not parsed.password,
                    'Public verification requires credential-free HTTPS URLs')
        headers = {'User-Agent': 'AnyWork-publisher', 'Accept': 'application/vnd.github+json', 'Cache-Control': 'no-cache'}
        if not public:
            require(self.token, 'A GitHub token is required for API requests')
            headers['Authorization'] = 'Bearer ' + self.token
        body = None if data is None else json.dumps(data).encode()
        if body is not None:
            headers['Content-Type'] = 'application/json'
        for attempt in range(3 if method in ('GET', 'HEAD') else 1):
            try:
                opener = self.public_opener if public else self.api_opener
                with opener.open(urllib.request.Request(url, data=body, headers=headers, method=method), timeout=30) as response:
                    # Metadata and signatures only; never consume installer bodies.
                    raw = b'' if method == 'HEAD' else response.read(4 * 1024 * 1024 + 1)
                    require(len(raw) <= 4 * 1024 * 1024, 'HTTP metadata exceeds its read limit')
                    return raw, dict(response.headers)
            except urllib.error.HTTPError as error:
                if missing and error.code == 404:
                    return None, {}
                if method in ('GET', 'HEAD') and error.code in (429, 500, 502, 503, 504) and attempt < 2:
                    self.sleep(2 ** attempt)
                    continue
                raise Failure(f'HTTP {error.code} during {method}; resume the command after resolving access/network errors') from None
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
                if method in ('GET', 'HEAD') and attempt < 2:
                    self.sleep(2 ** attempt)
                    continue
                raise Failure('HTTP transport failed; mutation outcome may be unknown. Resume to reconcile; no mutation was retried') from None

    def json(self, path, **kwargs):
        raw, _ = self.request(path, **kwargs)
        if raw is None:
            return None
        try:
            return json.loads(raw) if raw else None
        except (ValueError, UnicodeError):
            raise Failure('GitHub returned incomplete or invalid JSON; resume to reconcile') from None

    def list(self, path, key=None):
        result = []
        for page in range(1, 101):
            data = self.json(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            items = data[key] if key else data
            require(isinstance(items, list), 'Unexpected GitHub collection response')
            result.extend(items)
            if len(items) < 100:
                return result
        raise Failure('GitHub collection exceeds pagination limit')

    def public(self, url, method='GET'):
        return self.request(url, method=method, public=True)


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            # Persist the rename as well as the contents on POSIX filesystems.
            directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        # Windows replace is atomic; the standard library has no directory fsync.
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def process_lock(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not directory.is_symlink(), 'Private publisher directory must not be a symlink')
    os.chmod(directory, 0o700)
    path = directory / 'lock'
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'r+b') as stream:
        stream.write(b'0')
        stream.flush()
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Failure('Another publisher is running for this repository') from None
        yield


class Publisher:
    def __init__(self, root, api, timeout=10800, poll=15, sleep=time.sleep, clock=time.monotonic):
        self.root, self.api = pathlib.Path(root).resolve(), api
        self.sleep, self.clock, self.poll = sleep, clock, poll
        self.deadline = clock() + timeout
        common = self.git('rev-parse', '--path-format=absolute', '--git-common-dir')
        self.private = pathlib.Path(common) / 'anywork-publish'
        self.path = self.private / 'state.json'
        self.state = None
        self.retried = set()

    def git(self, *args, input=None, env=None, network=False, check=True):
        environment = os.environ.copy()
        environment.update(env or {})
        command = ['git']
        if network:
            helper = self.private / 'askpass.py'
            helper.write_text('#!' + sys.executable + '\nimport os,sys\nprint("x-access-token" if "username" in sys.argv[1].lower() else os.environ["ANYWORK_PUBLISH_TOKEN"])\n')
            helper.chmod(0o700)
            environment.update(ANYWORK_PUBLISH_TOKEN=self.api.token, GIT_TERMINAL_PROMPT='0', GIT_ASKPASS=str(helper))
            command += ['-c', 'credential.helper=']
        remaining = self.deadline - self.clock()
        require(remaining > 0, 'Publication wait timed out; resume the same command')
        process = subprocess.Popen(command + list(args), cwd=self.root, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment,
                                   start_new_session=os.name != 'nt')
        try:
            stdout, stderr = process.communicate(input, timeout=min(60, remaining))
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as interrupted:
            if os.name == 'nt':
                # Kill Git's transport children as well as Git itself.
                try:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    process.kill()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.stdout.close()
                process.stderr.close()
            if isinstance(interrupted, KeyboardInterrupt):
                raise
            raise Failure('Git command timed out; mutation outcome may be unknown. Resume to reconcile') from None
        result = subprocess.CompletedProcess(command + list(args), process.returncode, stdout, stderr)
        if check and result.returncode:
            # Git/server output may contain credential-helper diagnostics. Never echo it.
            raise Failure('Git command failed (' + args[0] + '); inspect repository/authentication and resume')
        return result.stdout.decode().strip() if check else result

    def head(self):
        return self.git('rev-parse', 'HEAD')

    def clean(self):
        require(not self.git('status', '--porcelain', '--untracked-files=all'),
                'Commit or remove working-tree changes first; the publisher never stages arbitrary files')

    def checkout(self):
        require(self.git('branch', '--show-current') == 'main', 'Run from a committed main checkout')
        allowed = (WEB, WEB + '.git', 'git@github.com:' + REPO, 'git@github.com:' + REPO + '.git')
        origins = self.git('remote', 'get-url', '--all', 'origin').splitlines()
        pushes = self.git('remote', 'get-url', '--push', '--all', 'origin').splitlines()
        require(origins and pushes and all(url in allowed for url in origins + pushes),
                'origin must identify ywateru/AnyWork without embedded credentials')

    def load(self, path=None):
        path = path or self.path
        require(not path.is_symlink(), 'Publisher state must not be a symlink')
        if not path.exists():
            return None
        try:
            state = json.loads(path.read_text())
        except (ValueError, OSError):
            raise Failure('Private publisher state is unreadable; preserve it and inspect the repository') from None
        require(state.get('schema') == 1 and state.get('root') == str(self.root),
                'Publisher state belongs to another checkout or unsupported schema')
        return state

    def save(self):
        atomic_json(self.path, self.state)

    def tick(self):
        require(self.clock() < self.deadline, 'Publication wait timed out; state is preserved. Run the same command to resume')
        self.sleep(self.poll)

    def remote_main(self):
        return self.api.json('git/ref/heads/main')['object']['sha']

    def remote_tag(self, tag):
        return self.api.json('git/ref/tags/' + urllib.parse.quote(valid_tag(tag), safe=''), missing=True)

    def tag_commit(self, ref):
        obj = ref['object']
        for _ in range(5):
            if obj['type'] == 'commit':
                return obj['sha']
            require(obj['type'] == 'tag', 'Release tag does not resolve to a commit')
            obj = self.api.json('git/tags/' + obj['sha'])['object']
        raise Failure('Release tag indirection exceeds limit')

    def next_version(self, bump):
        current = versions.current_version(self.root)
        reserved = [current]
        for item in self.api.list('tags') + self.api.list('releases'):
            name = item.get('name') if 'tag_name' not in item else item['tag_name']
            if isinstance(name, str) and re.fullmatch(r'v\d+\.\d+\.\d+', name):
                reserved.append(name[1:])
        major, minor, patch = max(map(versions.version_tuple, reserved))
        return {'patch': f'{major}.{minor}.{patch + 1}', 'minor': f'{major}.{minor + 1}.0',
                'major': f'{major + 1}.0.0'}[bump]

    def prepare(self, bump):
        self.clean()
        self.state = {'schema': 1, 'root': str(self.root), 'base': self.head(),
                      'version': self.next_version(bump), 'phase': 'preparing',
                      'date': str(int(time.time())) + ' +0000', 'intents': {}}
        self.state['tag'] = 'v' + self.state['version']
        self.save()  # Durable plan precedes all source/version mutations.

    def finish_prepare(self):
        state = self.state
        require(self.head() == state['base'], 'Source changed during version preparation; use --new after committing source fixes')
        self.clean()
        with tempfile.TemporaryDirectory(prefix='prepare-', dir=self.private) as temp:
            root = pathlib.Path(temp)
            for name in FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes((self.root / name).read_bytes())
            versions.bump(state['version'], root)
            notes = root / 'docs/release-notes.md'
            text, count = re.subn(r'(?m)^(\*\*New in )\d+\.\d+\.\d+( / 本次更新\*\*)$',
                                  lambda match: match[1] + state['version'] + match[2], notes.read_text(), count=1)
            require(count == 1, 'Release notes need one current New in / 本次更新 heading')
            notes.write_text(text)
            guard.check_local(state['tag'], root)
            index = root / 'index'
            environment = {'GIT_INDEX_FILE': str(index)}
            self.git('read-tree', state['base'], env=environment)
            for name in FILES:
                blob = self.git('hash-object', '-w', '--stdin', input=(root / name).read_bytes())
                mode = self.git('ls-tree', state['base'], '--', name).split()[0]
                self.git('update-index', '--add', '--cacheinfo', mode, blob, name, env=environment)
            tree = self.git('write-tree', env=environment)
            state['source'] = self.git('commit-tree', tree, '-p', state['base'],
                                       input=('Release ' + state['tag'] + '\n').encode(),
                                       env={'GIT_AUTHOR_DATE': state['date'], 'GIT_COMMITTER_DATE': state['date']})
        state['phase'] = 'prepared'
        self.save()

    def install_prepared(self):
        state = self.state
        require(self.head() in (state['base'], state['source']),
                'Checkout changed; commit source fixes and use --new, or restore the pinned checkout to resume')
        # A crash during reset may leave any subset of known version files at
        # either revision. Refuse every other edit, including unknown bytes.
        changed = self.git('diff', '--name-only', state['base']).splitlines()
        staged = self.git('diff', '--cached', '--name-only', state['base']).splitlines()
        untracked = self.git('ls-files', '--others', '--exclude-standard')
        require(not untracked and set(changed + staged) <= set(FILES), 'Unexpected source edits; commit them and use --new')
        for name in FILES:
            file = self.root / name
            require(file.is_file() and not file.is_symlink(), 'Prepared version file type changed; preserve edits and use --new')
            actual = file.read_bytes()
            allowed = [self.git('show', revision + ':' + name, check=False).stdout
                       for revision in (state['base'], state['source'])]
            indexed = self.git('show', ':' + name, check=False).stdout
            require(actual in allowed and indexed in allowed, 'Prepared version files or index were edited; preserve edits and use --new')
            base_mode = self.git('ls-tree', state['base'], '--', name).split()[0]
            if os.name != 'nt':
                require(bool(file.stat().st_mode & 0o111) == (base_mode == '100755'),
                        'Prepared working file modes changed; preserve edits and use --new')
            require(self.git('ls-files', '--stage', '--', name).split()[0] == base_mode, 'Prepared file modes changed; preserve edits and use --new')
        self.git('reset', '--hard', state['source'])
        self.clean()
        state['phase'] = 'checks'
        self.save()

    def mutation(self, key, path, data=None):
        intents = self.state['intents']
        if key in intents:
            return
        intents[key] = {'requested': int(time.time()), 'outcome': 'unknown'}
        self.save()
        self.api.json(path, method='POST', data=data)
        intents[key]['outcome'] = 'accepted'
        self.save()

    def runs(self, workflow, sha, branch):
        workflow_id = self.api.json('actions/workflows/' + workflow)['id']
        query = urllib.parse.urlencode({'head_sha': sha, 'branch': branch})
        return [run for run in self.api.list('actions/workflows/' + workflow + '/runs?' + query, 'workflow_runs')
                if run.get('head_sha') == sha and run.get('head_branch') == branch
                and run.get('workflow_id') == workflow_id]

    def wait_workflow(self, workflow, sha, branch, retry=False, dispatch=False, after=None):
        started = self.clock()
        while True:
            runs = self.runs(workflow, sha, branch)
            if after:
                runs = [run for run in runs if run.get('created_at', '') >= after]
            successful = [run for run in runs if run.get('status') == 'completed' and run.get('conclusion') == 'success']
            if successful:
                run = max(successful, key=lambda run: run['id'])
                self.state.setdefault('gates', {})[workflow] = {'id': run['id'], 'url': run['html_url'], 'sha': sha}
                self.save()
                return run
            if runs:
                run = max(runs, key=lambda run: run['id'])
                if run.get('status') == 'completed':
                    attempt = run.get('run_attempt', 1)
                    key = f'retry:{run["id"]}:{attempt}'
                    if retry and workflow not in self.retried:
                        self.retried.add(workflow)
                        endpoint = 'rerun-failed-jobs' if run.get('conclusion') == 'failure' else 'rerun'
                        self.mutation(key, f'actions/runs/{run["id"]}/{endpoint}')
                    elif key not in self.state['intents']:
                        raise Failure(f'{workflow} ended with {run.get("conclusion")}: {run["html_url"]}. Use --retry-failed; if already published, use --pages-only {self.state["tag"]}')
                    # A saved retry intent must observe a newer attempt before
                    # interpreting another failure; never resubmit the same POST.
                    elif self.state['intents'][key].get('observed_new_attempt'):
                        raise Failure('Retried workflow failed: ' + run['html_url'])
                else:
                    for key, intent in self.state['intents'].items():
                        if key.startswith(f'retry:{run["id"]}:'):
                            intent['observed_new_attempt'] = True
                    self.save()
            elif dispatch and self.clock() - started >= 90:
                require(self.remote_main() == sha, 'Remote main changed before dispatch; refusing a different source snapshot')
                self.mutation('dispatch:' + workflow, 'actions/workflows/' + workflow + '/dispatches', {'ref': 'main'})
            self.tick()

    def push_main(self):
        source = self.state['source']
        if self.remote_main() == source:
            return
        self.state['main_push_intent'] = True
        self.save()
        try:
            self.git('push', 'origin', source + ':refs/heads/main', network=True)
        except Failure:
            if self.remote_main() != source:
                raise
        require(self.remote_main() == source, 'Remote main does not match the pinned source')

    def push_tag(self):
        state = self.state
        remote = self.remote_tag(state['tag'])
        if remote:
            require(state.get('tag_object') == remote['object']['sha'] and self.tag_commit(remote) == state['source'],
                    'Reserved release tag differs from this operation; tags are immutable')
            return
        require(self.remote_main() == state['source'], 'Remote main changed after Checks; refusing to publish another checkout')
        local = self.git('rev-parse', '--verify', 'refs/tags/' + state['tag'], check=False)
        if local.returncode:
            self.git('tag', '-a', state['tag'], state['source'], '-m', 'AnyWork ' + state['tag'])
        require(self.git('cat-file', '-t', 'refs/tags/' + state['tag']) == 'tag'
                and self.git('rev-list', '-n', '1', state['tag']) == state['source'], 'Local tag conflicts with pinned release')
        state['tag_object'] = self.git('rev-parse', 'refs/tags/' + state['tag'])
        state['phase'] = 'release'
        self.save()
        try:
            self.git('push', 'origin', 'refs/tags/' + state['tag'], network=True)
        except Failure:
            remote = self.remote_tag(state['tag'])
            if not remote or remote['object']['sha'] != state['tag_object']:
                raise
        remote = self.remote_tag(state['tag'])
        require(remote and remote['object']['sha'] == state['tag_object'], 'Tag push not yet confirmed; resume to reconcile')

    def verify_release(self, tag, source=None):
        valid_tag(tag)
        release = self.api.json('releases/tags/' + tag)
        require(not release['draft'] and not release['prerelease'] and release['tag_name'] == tag, 'Release is not a published stable version')
        ref = self.remote_tag(tag)
        require(ref, 'Release tag is missing')
        commit = self.tag_commit(ref)
        require(not source or commit == source, 'Published tag points to the wrong source commit')
        items = release['assets']
        assets = {item['name']: item for item in items}
        require(len(items) == len(ASSETS) and set(assets) == ASSETS, 'Release must contain exactly the expected 20 assets')
        base = WEB + '/releases/download/' + tag + '/'
        for name, asset in assets.items():
            require(asset.get('size', 0) > 0 and asset.get('state') == 'uploaded'
                    and asset.get('browser_download_url') == base + name
                    and re.fullmatch(r'sha256:[a-f0-9]{64}', asset.get('digest') or ''), 'Incomplete or unexpected release asset metadata')
        def small(name):
            raw, _ = self.api.public(base + name)
            require('sha256:' + hashlib.sha256(raw).hexdigest() == assets[name]['digest'], 'Downloaded metadata digest mismatch: ' + name)
            return raw
        checks = {}
        for line in small('SHA256SUMS').decode().splitlines():
            match = re.fullmatch(r'([a-f0-9]{64}) [ *](\S+)', line)
            require(match and match[2] not in checks, 'Invalid or duplicate checksum entry')
            checks[match[2]] = match[1]
        require(set(checks) == ASSETS - {'SHA256SUMS'}, 'Expected all 19 checksum entries')
        for name, digest in checks.items():
            require(assets[name]['digest'] == 'sha256:' + digest, 'GitHub digest/checksum mismatch: ' + name)
        manifest = json.loads(small('latest.json'))
        require(manifest['version'] == tag[1:] and set(manifest['platforms']) == set(TARGETS), 'Updater target/version mismatch')
        for target, name in TARGETS.items():
            item = manifest['platforms'][target]
            require(item['url'] == base + name and small(name + '.sig').decode().strip() == item['signature']
                    and updater.signature_version(item['signature']) == tag[1:], 'Updater signature file/version metadata mismatch')
        for name in sorted(INSTALLERS):
            _, headers = self.api.public(base + name, method='HEAD')
            require(int(headers.get('Content-Length', headers.get('content-length', -1))) == assets[name]['size'], 'Installer HEAD size mismatch: ' + name)
        return release, commit

    def verify_site(self, release):
        nonce = '?anywork-publish=' + str(release['id'])
        raw, _ = self.api.public(SITE + '/release.json' + nonce)
        data = json.loads(raw)
        require(data and data['tag_name'] == release['tag_name'], 'Download website still advertises another release')
        assets = {item['name']: item for item in release['assets']}
        names = [item['name'] for item in data['assets']]
        require(len(names) == len(assets) and set(names) == set(assets), 'Website release metadata is incomplete or duplicated')
        for item in data['assets']:
            require(item['name'] in assets and all(item[key] == assets[item['name']][key]
                    for key in ('size', 'browser_download_url')), 'Website asset metadata differs from release')
        for language in ('en', 'zh'):
            raw, _ = self.api.public(SITE + '/' + language + '/' + nonce)
            parser = Downloads()
            parser.feed(raw.decode())
            require(parser.version == release['tag_name'], 'Embedded website version is stale: ' + language)
            require(INSTALLERS <= set(parser.links), 'Website installer links are missing: ' + language)
            for name, url in parser.links.items():
                require(name in assets and url == assets[name]['browser_download_url'], 'Embedded download link is stale: ' + language)

    def wait_site(self, release):
        while True:
            try:
                self.verify_site(release)
                return
            except (Failure, ValueError, KeyError):
                self.tick()

    def allow_new(self):
        old = self.state
        if old:
            require(self.git('merge-base', '--is-ancestor', old.get('base') or old['source'], 'HEAD', check=False).returncode == 0,
                    'New source must descend from the previous operation')
        if old and old.get('phase') != 'complete' and old.get('source'):
            remote = self.remote_tag(old['tag'])
            require(remote or old.get('phase') not in ('release', 'pages'),
                    'Previous tag push is unresolved; resume it before --new')
            if remote:
                runs = self.runs('release.yml', old['source'], old['tag'])
                require(runs and all(run.get('status') == 'completed' for run in runs),
                        'Previous tagged release may still publish; wait for it to finish before --new')
        if old:
            archive = self.private / ('state-' + str(time.time_ns()) + '.json')
            atomic_json(archive, old)
        self.state = None

    def publish(self, bump='patch', retry=False, new=False):
        self.checkout()
        self.state = self.load()
        if new:
            self.clean()
            self.allow_new()
            self.prepare(bump)
        elif self.state and self.state['phase'] == 'complete':
            self.clean()
            if self.head() == self.state['source']:
                print('Already published:', self.state['release_url'], SITE)
                return self.state
            require(self.git('merge-base', '--is-ancestor', self.state['source'], 'HEAD', check=False).returncode == 0,
                    'main no longer descends from the published source')
            self.prepare(bump)
        elif not self.state:
            self.prepare(bump)
        if self.state['phase'] == 'preparing':
            self.finish_prepare()
        if self.state['phase'] == 'prepared':
            self.install_prepared()
        self.clean()
        require(self.head() == self.state['source'], 'Pinned source changed; use --new after committing fixes')
        if self.state['phase'] == 'checks':
            print('Waiting for exact-source Checks:', self.state['source'])
            self.push_main()
            self.wait_workflow('ci.yml', self.state['source'], 'main', retry, dispatch=True)
            self.push_tag()
        if self.state['phase'] == 'release':
            self.push_tag()  # Reconcile a crash before/during the original tag push.
            self.wait_workflow('release.yml', self.state['source'], self.state['tag'], retry)
            self.state['phase'] = 'pages'
            self.save()
        release, _ = self.verify_release(self.state['tag'], self.state['source'])
        self.pages(release, self.state['source'], retry)
        self.state.update(phase='complete', release_url=release['html_url'], site_url=SITE,
                          verified={'assets': 20, 'checksums': 19, 'version_bound_signature_files': 5})
        self.save()
        print('Published and verified:', release['html_url'], SITE)
        return self.state

    def pages(self, release, sha, retry):
        self.wait_workflow('pages.yml', sha, 'main', retry, dispatch=True, after=release['published_at'])
        self.wait_site(release)

    def pages_only(self, tag, retry=False):
        self.checkout()
        self.clean()
        release, source = self.verify_release(tag)
        self.path = self.private / ('pages-' + tag + '.json')
        self.state = self.load()
        if not self.state:
            self.state = {'schema': 1, 'root': str(self.root), 'tag': tag, 'source': source,
                          'pages_sha': self.remote_main(), 'phase': 'pages', 'intents': {}}
            self.save()
        require(self.remote_main() == self.state['pages_sha'], 'Remote main changed during Pages repair; preserve state and inspect the deployment')
        self.pages(release, self.state['pages_sha'], retry)
        self.state['phase'] = 'complete'
        self.save()
        print('Verified existing release and repaired Pages:', release['html_url'], SITE)


class Downloads(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.version, self.links = None, {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'body':
            self.version = attrs.get('data-release-version')
        if tag == 'a' and 'data-asset' in attrs:
            self.links[attrs['data-asset']] = attrs.get('href')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bump', choices=['patch', 'minor', 'major'], default='patch')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--dry-run', action='store_true', help='Read-only plan / 只读预览')
    modes.add_argument('--status', action='store_true', help='Read private progress / 查看进度')
    modes.add_argument('--verify-existing', metavar='TAG', help='Read-only release and website verification')
    modes.add_argument('--pages-only', metavar='TAG', help='Repair website for an immutable existing release')
    parser.add_argument('--new', action='store_true', help='Archive a stopped operation after committed source fixes')
    parser.add_argument('--retry-failed', action='store_true', help='Explicitly rerun failed workflow jobs once')
    parser.add_argument('--token-file', type=pathlib.Path)
    parser.add_argument('--timeout', type=int, default=10800, help='Overall wait budget in seconds; resume preserves work')
    parser.add_argument('--poll', type=int, default=15)
    args = parser.parse_args(argv)
    require(args.timeout > 0 and args.poll > 0, 'Timeout and poll must be positive')
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if not token and not args.status:
        path = args.token_file or pathlib.Path.home() / '.ssh/ghp'
        require(path.is_file(), 'Set GH_TOKEN/GITHUB_TOKEN or provide --token-file (default ~/.ssh/ghp)')
        token = path.read_text().strip()
    api = GitHub(token or '')
    publisher = Publisher(ROOT, api, args.timeout, args.poll)
    if args.status:
        state = publisher.load()
        print(json.dumps({key: state.get(key) for key in ('phase', 'version', 'source', 'tag', 'release_url', 'gates')} if state else {'phase': 'not-started'}, indent=2))
        return
    if args.dry_run:
        publisher.checkout()
        publisher.clean()
        state = publisher.load()
        noop = state and state['phase'] == 'complete' and publisher.head() == state['source']
        print(json.dumps({'operation': 'no-op' if noop else 'resume' if state and state['phase'] != 'complete' else 'prepare',
                          'version': state['version'] if state and (noop or state['phase'] != 'complete') else publisher.next_version(args.bump),
                          'source': publisher.head(), 'mutations': False}, indent=2))
        return
    if args.verify_existing:
        release, source = publisher.verify_release(valid_tag(args.verify_existing))
        publisher.verify_site(release)
        print(json.dumps({'release': release['html_url'], 'source': source, 'site': SITE, 'verified': True}))
        return
    with process_lock(publisher.private):
        if args.pages_only:
            publisher.pages_only(valid_tag(args.pages_only), args.retry_failed)
        else:
            publisher.publish(args.bump, args.retry_failed, args.new)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Interrupted; private state is preserved. Run the same command to resume.', file=sys.stderr)
        sys.exit(130)
    except Failure as error:
        print('Publication stopped:', str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, OSError, TypeError):
        # Never echo arbitrary HTTP/header/environment errors containing credentials.
        print('Publication stopped: invalid local data or remote response; state is preserved for inspection.', file=sys.stderr)
        sys.exit(1)
