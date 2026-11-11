#!/usr/bin/env python3
"""Pinned CyberGrid environment-only Redis cutover. Prepare is read-only remotely.

Apply/rollback require a fresh exact root GO. A submitting deployment is only
reconciled; the CLI is never resubmitted. Private state must stay outside source.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import uuid
from urllib.parse import quote

spec = importlib.util.spec_from_file_location('grid_deploy', Path(__file__).with_name('deploy-cybergrid.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
cloud = deploy.cloud
PROJECT = 'prj_QEkGqB1XuC8AbtRGZaNSsMD1otvX'
NAME = 'anywork-cybergrid-selfhost'
ALIAS = NAME + '.vercel.app'
SOURCE = 'c923cc232e74e4aff78fa3c82916ce9fb9a283b5'
ARTIFACT = 'aa53c54c1306560a12bdb7c35f2a71e91c31aff42474647f1cbe7fd3edb5cd10'
PREFIX = 'anywork:selfhost:v1'
BASE = {'LOGTO_ISSUER', 'LOGTO_RESOURCE', 'LOGTO_BROWSER_CLIENT_ID', 'LOGTO_APPLICATION_DIRECTORY_MODE',
        'LOGTO_APPLICATIONS_JSON', 'CYBERGRID_REDIS_PREFIX', 'CYBERGRID_PUBLIC_ORIGIN', 'CYBERGRID_BROWSER_ORIGINS'}
OLD = {'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'}
NEW = {'REDIS_URL', 'CYBERGRID_REDIS_TRANSPORT'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tool_tree_hash(root):
    cloud.require(root.is_dir() and not root.is_symlink(), 'CLI_TREE_REQUIRED')
    result = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            content = ('link:' + os.readlink(path)).encode()
        elif path.is_dir():
            continue
        else:
            cloud.require(path.is_file(), 'CLI_SPECIAL_FILE_REJECTED')
            content = bytes.fromhex(digest(path))
        result.update(relative.encode() + b'\0' + content + b'\0')
    return result.hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def helpers():
    return {p.name: digest(p) for p in [Path(__file__).resolve(), Path(deploy.__file__), Path(cloud.__file__),
                                      Path(__file__).with_name('redis-tls-probe.mjs'), Path(__file__).with_name('redis-ready.mjs')]}


def read_environment(vercel):
    rows = vercel('/v9/projects/' + PROJECT + '/env')['envs']
    selected = [r for r in rows if 'production' in r.get('target', [])]
    cloud.require(len({r['key'] for r in selected}) == len(selected), 'DUPLICATE_PRODUCTION_ENV')
    out = {}
    for r in selected:
        cloud.require(r['target'] == ['production'] and r['type'] == 'encrypted', 'UNEXPECTED_ENV_SCOPE')
        e = vercel('/v1/projects/' + PROJECT + '/env/' + r['id'])
        cloud.require(e.get('decrypted') is True and e.get('key') == r['key'] and isinstance(e.get('value'), str),
                      'ENV_DECRYPTION_UNAVAILABLE')
        out[r['key']] = {'id': r['id'], 'value': e['value']}
    return out


def values(environment):
    return {k: r['value'] for k, r in environment.items()}


def alias_id(vercel):
    alias = vercel('/v4/aliases/' + ALIAS)
    cloud.require(alias.get('projectId') == PROJECT, 'ALIAS_PROJECT_CHANGED')
    return (alias.get('deployment') or {}).get('id')


def redis_environment(value):
    cloud.require(value.get('schema') == 1 and value.get('transport') == 'tls-tcp'
                  and value.get('host') == 'redis.x.aixgg.com' and value.get('port') == 6379
                  and value.get('username') == 'redis_2429e58a' and value.get('namespace') == PREFIX
                  and isinstance(value.get('password'), str) and value['password'], 'INVALID_TLS_REDIS_STATE')
    return {'CYBERGRID_REDIS_TRANSPORT': 'tcp',
            'REDIS_URL': 'rediss://' + quote(value['username'], safe='') + ':' + quote(value['password'], safe='')
                         + '@redis.x.aixgg.com:6379/0'}


def prepare(op, baseline, upload, provenance, cli, vercel):
    cloud.require(not (op / 'candidate.private.json').exists() and not (op / 'operation.private.json').exists(),
                  'OPERATION_ALREADY_PREPARED')
    saved = cloud.private_json(baseline)
    old = saved['gridDeploymentIntent']
    cloud.require(old['identity']['source'] == SOURCE and old['identity']['outputHash'] == ARTIFACT
                  and old['status'] == 'READY', 'SAVED_BASELINE_DIFFERS')
    cloud.require(alias_id(vercel) == old['deploymentId'], 'LIVE_BASELINE_DIFFERS')
    detail = vercel('/v13/deployments/' + old['deploymentId'])
    cloud.require(detail.get('projectId') == PROJECT and detail.get('readyState') == 'READY'
                  and all((detail.get('meta') or {}).get(k) == v for k, v in deploy.metadata(old).items()),
                  'BASELINE_PROVIDER_BINDING_DIFFERS')
    before = read_environment(vercel)
    old_env = values(before)
    cloud.require(set(old_env) == BASE | OLD and old_env == saved['gridEnvironment'], 'BASELINE_ENVIRONMENT_DIFFERS')
    redis = cloud.private_json(op / 'redis-input.private.json')
    desired = {k: v for k, v in old_env.items() if k not in OLD}
    desired.update(redis_environment(redis))
    proof = cloud.private_json(op / 'node-readonly-proof.private.json')
    cloud.require(all(proof.get(k) is True for k in ['tls', 'hostnameVerified', 'authenticated', 'ping',
                  'wrongHostnameRejected', 'untrustedIssuerRejected']) and proof['types'] == {
                      'meta': 'none', 'initialized': 'none', 'revision': 'none', 'sequence': 'none'}, 'READONLY_PROOF_REQUIRED')
    version = deploy.subprocess.run(['node', str(cli), '--version'], capture_output=True, text=True, timeout=30)
    cloud.require(version.returncode == 0 and version.stdout.strip() == '50.28.0', 'CLI_VERSION_DIFFERS')
    identity = deploy.configuration_identity(PROJECT, NAME, SOURCE, desired)
    identity.update(deploy.prebuilt_identity(upload, provenance, SOURCE, PROJECT,
                                            [redis['password'], old_env['UPSTASH_REDIS_REST_TOKEN']]))
    cloud.require(identity['outputHash'] == ARTIFACT, 'ARTIFACT_DIFFERS')
    # The copied upload is exact; the old immutable operation is never reused or written.
    target = op / 'upload'
    shutil.copytree(upload, target)
    cloud.require(deploy.prebuilt_identity(target, provenance, SOURCE, PROJECT, [redis['password']]) == {
        k: identity[k] for k in ['sourceKind', 'upstreamSource', 'patchHash', 'outputHash']}, 'COPIED_ARTIFACT_DIFFERS')
    operation = op.name.removeprefix('redis-selfhost-')
    cloud.require(str(uuid.UUID(operation)) == operation, 'CANONICAL_OPERATION_UUID_REQUIRED')
    candidate = {'schema': 1, 'operationId': operation, 'preparedAt': now(), 'helperHashes': helpers(),
                 'redisInputHash': digest(op / 'redis-input.private.json'),
                 'proofHash': digest(op / 'node-readonly-proof.private.json'),
                 'baselineDeploymentId': old['deploymentId'], 'baselineEnvironment': before,
                 'desiredEnvironment': desired, 'identity': identity, 'upload': str(target),
                 'provenance': str(provenance), 'cli': str(cli), 'cliHash': digest(cli),
                 'cliTree': str(cli.parents[2]), 'cliTreeHash': tool_tree_hash(cli.parents[2])}
    cloud.save_private(op / 'candidate.private.json', candidate)
    cloud.save_private(op / 'operation.private.json', {'schema': 1, 'operationId': operation, 'phase': 'prepared',
                       'candidateHash': digest(op / 'candidate.private.json')})
    return candidate


def binding(op, state):
    candidate = cloud.private_json(op / 'candidate.private.json')
    cloud.require(state['candidateHash'] == digest(op / 'candidate.private.json')
                  and state['operationId'] == candidate['operationId'] and candidate['helperHashes'] == helpers()
                  and candidate['redisInputHash'] == digest(op / 'redis-input.private.json')
                  and candidate['proofHash'] == digest(op / 'node-readonly-proof.private.json')
                  and candidate['cliHash'] == digest(candidate['cli'])
                  and candidate['cliTreeHash'] == tool_tree_hash(Path(candidate['cliTree'])), 'OPERATION_BINDING_DIFFERS')
    identity = deploy.prebuilt_identity(Path(candidate['upload']), Path(candidate['provenance']), SOURCE, PROJECT, [])
    cloud.require(all(candidate['identity'][k] == v for k, v in identity.items()), 'ARTIFACT_BINDING_DIFFERS')
    return candidate


def authorize(go, candidate, state, action):
    value = cloud.private_json(go)
    cloud.require(value.get('action') == action and value.get('operationId') == candidate['operationId']
                  and value.get('candidateHash') == state['candidateHash'] and value.get('helperHashes') == helpers(), 'EXACT_GO_REQUIRED')
    try:
        remaining = (datetime.fromisoformat(value['expiresAt']) - datetime.now(timezone.utc)).total_seconds()
    except (ValueError, TypeError, KeyError):
        remaining = -1
    cloud.require(0 < remaining <= 600, 'FRESH_GO_REQUIRED')


def checkpoint(op, state, phase):
    state.update(phase=phase, updatedAt=now())
    cloud.save_private(op / 'operation.private.json', state)


def set_environment(vercel, desired, present):
    # Safe ordering: active deployments have immutable environment. Future builds
    # select tcp explicitly even while the old REST pair temporarily remains.
    vercel('/v10/projects/' + PROJECT + '/env?upsert=true', 'POST', [
        {'key': k, 'value': v, 'type': 'encrypted', 'target': ['production']} for k, v in desired.items()])
    for key in sorted(set(present) - set(desired)):
        vercel('/v9/projects/' + PROJECT + '/env/' + present[key]['id'], 'DELETE')
    cloud.require(values(read_environment(vercel)) == desired, 'ENVIRONMENT_READBACK_DIFFERS')


def inspect(op, state, candidate, vercel):
    if state['phase'] == 'rollback-submitting':
        if alias_id(vercel) == candidate['baselineDeploymentId'] and values(read_environment(vercel)) == values(candidate['baselineEnvironment']):
            checkpoint(op, state, 'rolled-back')
    if state['phase'] in {'submitting', 'observed', 'ready'}:
        intent = state['deploymentIntent']
        deployment = deploy.observe(vercel, intent)
        state['deploymentId'] = deployment['id']
        checkpoint(op, state, 'ready' if intent['status'] == 'READY' else 'observed')
    return {'phase': state['phase'], 'deploymentId': state.get('deploymentId'), 'aliasDeploymentId': alias_id(vercel),
            'desiredEnvironmentMatches': values(read_environment(vercel)) == candidate['desiredEnvironment']}


def initialize_namespace(op, candidate):
    module = Path(candidate['upload']) / '.vercel/output/functions/api/index.func/server/src/redis.js'
    result = deploy.subprocess.run(['node', str(Path(__file__).with_name('redis-ready.mjs')),
        str(op / 'redis-input.private.json'), str(module), str(op / 'namespace-ready.private.json')],
        capture_output=True, timeout=20)
    cloud.require(result.returncode == 0, 'NAMESPACE_READY_FAILED_BEFORE_VERCEL_MUTATION')
    proof = cloud.private_json(op / 'namespace-ready.private.json')
    cloud.require(proof.get('schema') == 1 and proof.get('ready') is True and proof.get('namespace') == PREFIX
                  and isinstance(proof.get('epoch'), str) and str(uuid.UUID(proof['epoch'])) == proof['epoch'],
                  'NAMESPACE_READY_PROOF_DIFFERS')
    return digest(op / 'namespace-ready.private.json')


def apply(op, state, candidate, go, vercel):
    authorize(go, candidate, state, 'apply')
    cloud.require(state['phase'] == 'prepared', 'SINGLE_SUBMISSION_ONLY_INSPECT_UNKNOWN')
    cloud.require(alias_id(vercel) == candidate['baselineDeploymentId'], 'LIVE_BASELINE_DIFFERS')
    cloud.require(read_environment(vercel) == candidate['baselineEnvironment'], 'BASELINE_ENVIRONMENT_DIFFERS')
    checkpoint(op, state, 'namespace-initializing')
    state['namespaceReadyHash'] = initialize_namespace(op, candidate)
    checkpoint(op, state, 'environment-submitting')
    set_environment(vercel, candidate['desiredEnvironment'], candidate['baselineEnvironment'])
    checkpoint(op, state, 'environment-ready')
    cloud.require(alias_id(vercel) == candidate['baselineDeploymentId'], 'LIVE_BASELINE_DIFFERS')
    state['deploymentIntent'] = {'schema': 1, 'operationId': candidate['operationId'],
                                 'phase': 'submitting', 'identity': candidate['identity']}
    checkpoint(op, state, 'submitting')
    deploy.submit_prebuilt(Path(candidate['upload']), Path(candidate['cli']), state['deploymentIntent'])
    return inspect(op, state, candidate, vercel)


def rollback(op, state, candidate, go, vercel):
    authorize(go, candidate, state, 'rollback')
    cloud.require(state['phase'] not in {'prepared', 'rollback-submitting', 'rolled-back'}, 'ROLLBACK_STATE_REQUIRES_RECONCILIATION')
    current = alias_id(vercel)
    allowed = {candidate['baselineDeploymentId'], state.get('deploymentId')}
    cloud.require(current in allowed and current is not None, 'ROLLBACK_ALIAS_CHANGED')
    present = read_environment(vercel)
    cloud.require(BASE <= set(present) <= BASE | OLD | NEW, 'ROLLBACK_UNEXPECTED_ENVIRONMENT')
    old_values = values(candidate['baselineEnvironment'])
    cloud.require(all(row['value'] in [old_values.get(key), candidate['desiredEnvironment'].get(key)]
                      for key, row in present.items()), 'ROLLBACK_ENVIRONMENT_CHANGED')
    checkpoint(op, state, 'rollback-submitting')
    set_environment(vercel, values(candidate['baselineEnvironment']), present)
    if current != candidate['baselineDeploymentId']:
        vercel('/v2/deployments/' + candidate['baselineDeploymentId'] + '/aliases', 'POST', {'alias': ALIAS})
    cloud.require(alias_id(vercel) == candidate['baselineDeploymentId'], 'ROLLBACK_ALIAS_READBACK_DIFFERS')
    checkpoint(op, state, 'rolled-back')
    return {'phase': 'rolled-back', 'aliasDeploymentId': candidate['baselineDeploymentId']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'apply', 'inspect', 'rollback'])
    parser.add_argument('--operation', type=Path, required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--upload', type=Path)
    parser.add_argument('--provenance', type=Path)
    parser.add_argument('--cli', type=Path)
    parser.add_argument('--go', type=Path)
    args = parser.parse_args()
    op = args.operation
    cloud.require(op.is_absolute() and op.is_dir() and not op.is_symlink()
                  and Path(__file__).resolve().parents[2] not in op.resolve().parents
                  and op.resolve() != Path(__file__).resolve().parents[2]
                  and not op.stat().st_mode & 0o077, 'PRIVATE_EXTERNAL_OPERATION_REQUIRED')
    auth = cloud.private_json(Path.home() / 'Library/Application Support/com.vercel.cli/auth.json')['token']
    def vercel(route, method='GET', data=None):
        return cloud.request('https://api.vercel.com' + route + ('&' if '?' in route else '?') + 'teamId=' + deploy.TEAM,
                             method, data, 'Bearer ' + auth)
    with cloud.state_lock(op / 'operation.private.json'):
        if args.action == 'prepare':
            cloud.require(all([args.baseline, args.upload, args.provenance, args.cli]), 'PREPARE_PATHS_REQUIRED')
            result = prepare(op, args.baseline, args.upload, args.provenance, args.cli, vercel)
            result = {'phase': 'prepared', 'operationId': result['operationId'],
                      'candidateHash': digest(op / 'candidate.private.json')}
        else:
            state = cloud.private_json(op / 'operation.private.json')
            candidate = binding(op, state)
            if args.action == 'inspect':
                result = inspect(op, state, candidate, vercel)
            else:
                cloud.require(args.go is not None, 'EXACT_GO_REQUIRED')
                result = (apply if args.action == 'apply' else rollback)(op, state, candidate, args.go, vercel)
        print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No raw socket/URL/provider error can escape with embedded credentials.
        raise SystemExit('REDIS_CUTOVER_STOPPED_RECONCILE_PRIVATE_OPERATION') from None
