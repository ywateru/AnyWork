#!/usr/bin/env python3
"""Require successful, trusted Checks for the exact release source (read-only)."""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

WORKFLOW = '.github/workflows/ci.yml'


class GateError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitHub:
    def __init__(self, repository, token, clock=time.monotonic, sleep=time.sleep):
        require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository), 'Invalid repository name')
        require(token and all(33 <= ord(char) <= 126 for char in token), 'A valid GitHub token is required')
        self.base = 'https://api.github.com/repos/' + repository + '/'
        self.token, self.clock, self.sleep = token, clock, sleep
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, path, deadline):
        for attempt in range(3):
            remaining = deadline - self.clock()
            require(remaining > 0, 'Checks lookup reached its time budget')
            request = urllib.request.Request(self.base + path, headers={
                'Authorization': 'Bearer ' + self.token,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'AnyWork-release-Checks-gate',
            })
            try:
                with self.opener.open(request, timeout=min(30, remaining)) as response:
                    raw = response.read(4 * 1024 * 1024 + 1)
                require(len(raw) <= 4 * 1024 * 1024, 'GitHub metadata exceeds its size budget')
                value = json.loads(raw)
                require(isinstance(value, dict), 'Unexpected GitHub metadata')
                return value
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise GateError(f'GitHub Checks lookup returned HTTP {error.code}; no release is authorized') from None
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise GateError('GitHub Checks lookup failed; no release is authorized') from None
            except (ValueError, UnicodeError):
                raise GateError('GitHub Checks metadata is invalid; no release is authorized') from None
            remaining = deadline - self.clock()
            require(remaining > 0, 'Checks lookup reached its time budget')
            self.sleep(min(2 ** attempt, remaining))


def require_tag_source(repository, tag, sha, api, timeout=60, clock=time.monotonic):
    """Read and peel an existing remote tag; never create/move a ref."""
    require(re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag), 'Expected a version release tag')
    require(re.fullmatch(r'[a-f0-9]{40}', sha), 'Expected the exact 40-character source SHA')
    deadline = clock() + timeout
    url = f'https://github.com/{repository}/releases/tag/{tag}'
    try:
        ref = api.get('git/ref/tags/' + tag, deadline)
        require(ref.get('ref') == 'refs/tags/' + tag, 'Unexpected remote tag identity')
        obj = ref.get('object')
        seen = set()
        for _ in range(10):
            require(isinstance(obj, dict), 'Malformed remote tag object')
            value, kind = obj.get('sha'), obj.get('type')
            require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{40}', value), 'Malformed remote tag SHA')
            if kind == 'commit':
                require(value == sha, 'Remote release tag points to a different source; no tag was moved')
                print('Verified remote tag source:', tag, sha, url)
                return value
            require(kind == 'tag' and value not in seen, 'Unexpected or cyclic remote tag target')
            seen.add(value)
            annotated = api.get('git/tags/' + value, deadline)
            require(annotated.get('sha') == value, 'Unexpected annotated tag identity')
            obj = annotated.get('object')
        raise GateError('Remote tag indirection exceeds its budget')
    except GateError as error:
        raise GateError(str(error) + '; an existing exact-source tag is required: ' + url) from None


def trusted_run(run, workflow_id, repository, sha):
    """PR/fork checks and similarly named workflows cannot authorize a release."""
    return (type(run.get('id')) is int and run['id'] > 0
            and run.get('workflow_id') == workflow_id
            and run.get('head_sha') == sha
            and run.get('head_branch') == 'main'
            and run.get('event') in ('push', 'workflow_dispatch')
            and isinstance(run.get('repository'), dict)
            and run['repository'].get('full_name') == repository
            and isinstance(run.get('head_repository'), dict)
            and run['head_repository'].get('full_name') == repository
            and isinstance(run.get('path'), str)
            and run['path'].split('@', 1)[0] == WORKFLOW)


def check(repository, sha, api, timeout=4500, poll=15, clock=time.monotonic, sleep=time.sleep):
    require(re.fullmatch(r'[a-f0-9]{40}', sha), 'Expected the exact 40-character source SHA')
    require(timeout > 0 and poll > 0, 'Wait budgets must be positive')
    deadline = clock() + timeout
    url = f'https://github.com/{repository}/actions/workflows/ci.yml'
    workflow = api.get('actions/workflows/ci.yml', deadline)
    require(workflow.get('path') == WORKFLOW and type(workflow.get('id')) is int and workflow['id'] > 0
            and workflow.get('state') == 'active', 'Required Checks workflow identity is unavailable: ' + url)
    last_wait = None
    while True:
        require(clock() < deadline, 'Timed out waiting for trusted exact-source Checks: ' + url)
        runs = []
        for page in range(1, 11):
            query = urllib.parse.urlencode({'head_sha': sha, 'branch': 'main', 'per_page': 100, 'page': page})
            value = api.get(f'actions/workflows/{workflow["id"]}/runs?' + query, deadline)
            items = value.get('workflow_runs')
            require(isinstance(items, list), 'Unexpected Checks runs response: ' + url)
            runs.extend(run for run in items if isinstance(run, dict)
                        and trusted_run(run, workflow['id'], repository, sha))
            if len(items) < 100:
                break
        else:
            raise GateError('Checks run lookup exceeds its pagination budget: ' + url)
        successes = [run for run in runs if run.get('status') == 'completed' and run.get('conclusion') == 'success']
        if successes:
            run = max(successes, key=lambda item: item.get('id', 0))
            run_url = f'https://github.com/{repository}/actions/runs/{int(run["id"])}'
            print('Authorized exact-source Checks:', sha, run_url)
            return {'sha': sha, 'run_id': run['id'], 'run_url': run_url}
        active = [run for run in runs if run.get('status') != 'completed']
        if runs and not active:
            run = max(runs, key=lambda item: item.get('id', 0))
            run_url = f'https://github.com/{repository}/actions/runs/{int(run["id"])}'
            conclusion = run.get('conclusion')
            # Render only known conclusion identifiers, never arbitrary API text.
            conclusion = conclusion if conclusion in ('failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale') else 'unsuccessful'
            raise GateError(f'Checks ended with {conclusion}; no release is authorized: {run_url}')
        waiting = tuple(sorted((run['id'], str(run.get('status')), str(run.get('conclusion'))) for run in runs))
        if waiting != last_wait:
            print('Waiting for trusted exact-source Checks:', sha, url, flush=True)
            last_wait = waiting
        remaining = deadline - clock()
        require(remaining > 0, 'Timed out waiting for trusted exact-source Checks: ' + url)
        sleep(min(poll, remaining))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', default=os.environ.get('GITHUB_REPOSITORY', 'ywateru/AnyWork'))
    parser.add_argument('--sha', default=os.environ.get('GITHUB_SHA'), required=not os.environ.get('GITHUB_SHA'))
    parser.add_argument('--tag', help='Also require an existing remote tag to resolve to this exact SHA')
    parser.add_argument('--timeout', type=int, default=4500)
    parser.add_argument('--poll', type=int, default=15)
    args = parser.parse_args(argv)
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN') or ''
    api = GitHub(args.repository, token)
    check(args.repository, args.sha, api, args.timeout, args.poll)
    if args.tag:
        require_tag_source(args.repository, args.tag, args.sha, api, min(args.timeout, 60))


if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print('Release Checks gate stopped:', error, file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Release Checks gate interrupted; no release is authorized', file=sys.stderr)
        sys.exit(130)
    except (ValueError, KeyError, TypeError, OSError):
        print('Release Checks gate stopped: invalid local data or remote response', file=sys.stderr)
        sys.exit(1)
