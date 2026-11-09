#!/usr/bin/env python3
"""Reconcile or deploy the pinned official CyberGrid tree to a dedicated project.

A durable intent precedes deployment. Repeating an operation reuses its provider
result. Unknown outcomes require inventory reconciliation; they are never
silently retried. Deliberate redeployment requires a stable --redeploy UUID.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import uuid

spec = importlib.util.spec_from_file_location('configure', Path(__file__).with_name('configure.py'))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)
PIN = '2bd6729c6bbee90ed2926410caca883a0a100890'
REPO_ID = 1450058229
TEAM = 'team_2ljUqxKg8oifxof0IT3yayWz'
TERMINAL = {'READY', 'ERROR', 'CANCELED'}
ACTIVE = {'INITIALIZING', 'QUEUED', 'BUILDING'}


def configuration_identity(project, name, source, env):
    # This digest also detects credential rotation, but discloses no plaintext
    # environment values in provider metadata or the durable intent.
    encoded = json.dumps(env, sort_keys=True, separators=(',', ':')).encode()
    return {'projectId': project, 'projectName': name, 'source': source,
            'namespace': env['CYBERGRID_REDIS_PREFIX'], 'target': 'production',
            'configHash': hashlib.sha256(encoded).hexdigest()}


def metadata(intent):
    return {'anyworkOperation': intent['operationId'],
            'anyworkConfiguration': intent['identity']['configHash'],
            'anyworkSource': intent['identity']['source']}


def observe(vercel, intent):
    """Resolve known ID or an unknown POST outcome, without creating anything."""
    identity = intent['identity']
    deployment_id = intent.get('deploymentId')
    if not deployment_id:
        cloud.require(intent['phase'] == 'submitting', 'Deployment intent is not ready for reconciliation')
        candidates, continuation = [], None
        for _ in range(20):
            route = '/v6/deployments?projectId=' + identity['projectId'] + '&limit=100'
            if continuation is not None:
                route += '&until=' + str(continuation)
            page = vercel(route)
            cloud.require(isinstance(page.get('deployments'), list), 'Invalid deployment inventory')
            for item in page['deployments']:
                meta = item.get('meta') or {}
                if meta.get('anyworkOperation') == intent['operationId']:
                    cloud.require(all(meta.get(k) == v for k, v in metadata(intent).items()),
                                  'Deployment operation has conflicting provider configuration; reconcile manually')
                    candidates.append(item)
            continuation = (page.get('pagination') or {}).get('next')
            if continuation is None:
                break
        else:
            raise cloud.ConfigurationError('Deployment inventory exceeds reconciliation limit; reconcile manually')
        ids = {item.get('uid') or item.get('id') for item in candidates}
        cloud.require(None not in ids and len(ids) == 1,
                      'Deployment outcome is unresolved or ambiguous; no new deployment was submitted. Reconcile manually')
        deployment_id = ids.pop()
    deployment = vercel('/v13/deployments/' + deployment_id)
    cloud.require(deployment.get('projectId') == identity['projectId'],
                  'Saved deployment belongs to another project; reconcile manually')
    actual_source = (deployment.get('gitSource') or {}).get('ref') or (deployment.get('meta') or {}).get('githubCommitSha')
    cloud.require(actual_source == identity['source'], 'Saved deployment source differs; reconcile manually')
    if not intent.get('legacy'):
        cloud.require(all((deployment.get('meta') or {}).get(k) == v for k, v in metadata(intent).items()),
                      'Saved deployment identity differs; reconcile manually')
    status = deployment.get('readyState') or deployment.get('state')
    cloud.require(status in TERMINAL | ACTIVE, 'Unknown deployment state; reconcile manually')
    intent.update(deploymentId=deployment_id, phase='observed', status=status)
    return deployment


def snapshot(state, intent, deployment):
    state['gridDeployment'] = {k: deployment.get(k) for k in ('id', 'url', 'readyState')}
    state['gridSource'] = intent['identity']['source']


def deploy(vercel, state, save, desired, env, redeploy=None):
    intent = state.get('gridDeploymentIntent')
    if intent is None and state.get('gridDeployment'):
        # Adopt only a legacy result whose private saved configuration is known.
        # Missing provenance is an explicit manual-recovery condition, never a
        # reason to blindly submit another deployment.
        cloud.require(state.get('gridSource') == desired['source'] and state.get('gridEnvironment') == env,
                      'Legacy deployment has incomplete or changed configuration; reconcile its identity manually')
        cloud.require(state['gridDeployment'].get('id'), 'Legacy deployment ID is missing')
        intent = {'schema': 1, 'operationId': str(uuid.uuid4()), 'identity': desired,
                  'phase': 'submitting', 'deploymentId': state['gridDeployment']['id'], 'legacy': True}
        state['gridDeploymentIntent'] = intent
        save()
    new_operation = redeploy and intent and redeploy != intent['operationId']
    if intent:
        cloud.require(intent.get('schema') == 1 and intent.get('phase') in ('prepared', 'environment-applied', 'submitting', 'observed'),
                      'Invalid saved deployment intent; reconcile manually')
        if new_operation:
            cloud.require(not any(item['operationId'] == redeploy for item in state.get('gridDeploymentHistory', [])),
                          'Redeploy operation ID was already used; choose a new explicit operation after reconciliation')
            previous = observe(vercel, intent)
            cloud.require(intent['status'] in TERMINAL,
                          'Previous deployment is still in progress; reuse it instead of redeploying')
            snapshot(state, intent, previous)
            state.setdefault('gridDeploymentHistory', []).append(dict(intent))
            intent = None
        else:
            cloud.require(intent['identity'] == desired,
                          'Deployment configuration changed; reconcile the previous operation, then use an explicit --redeploy UUID')
            if intent['phase'] in ('submitting', 'observed'):
                deployment = observe(vercel, intent)
                snapshot(state, intent, deployment)
                state['gridEnvironment'] = env
                save()
                cloud.require(intent['status'] not in {'ERROR', 'CANCELED'},
                              'Deployment ended unsuccessfully; use an explicit --redeploy UUID for a new operation')
                return deployment
    if intent is None:
        intent = {'schema': 1, 'operationId': redeploy or str(uuid.uuid4()), 'identity': desired, 'phase': 'prepared'}
        state['gridDeploymentIntent'] = intent
        save()  # Must succeed before any environment or deployment mutation.
    if intent['phase'] == 'prepared':
        vercel('/v10/projects/' + desired['projectId'] + '/env?upsert=true', 'POST', [
            {'key': k, 'value': v, 'type': 'encrypted', 'target': ['production']} for k, v in env.items()])
        intent['phase'] = 'environment-applied'
        save()  # Reapplying an identical encrypted env upsert is idempotent.
    intent['phase'] = 'submitting'
    save()  # Crash before/after POST must reconcile, never blindly resubmit.
    deployment = vercel('/v13/deployments', 'POST', {
        'name': desired['projectName'], 'project': desired['projectId'], 'target': 'production',
        'gitSource': {'type': 'github', 'repoId': REPO_ID, 'ref': desired['source']}, 'meta': metadata(intent)})
    cloud.require(deployment.get('id'), 'Deployment response omitted its ID; reconcile inventory before continuing')
    intent.update(deploymentId=deployment['id'], phase='observed', status=deployment.get('readyState'))
    snapshot(state, intent, deployment)
    state['gridEnvironment'] = env  # Existing private-state compatibility; never provider metadata.
    save()
    return deployment


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', type=Path, required=True)
    p.add_argument('--redis-state', type=Path, required=True)
    p.add_argument('--project', required=True)
    p.add_argument('--prefix', required=True)
    p.add_argument('--frontend-origin', default='https://anywork-tau.vercel.app')
    p.add_argument('--grid-origin', required=True)
    p.add_argument('--allow-local-development', action='store_true')
    p.add_argument('--redeploy', metavar='UUID', help='Start a deliberate new deployment; reuse this UUID when resuming')
    p.add_argument('--vercel-auth', type=Path, default=Path.home() / 'Library/Application Support/com.vercel.cli/auth.json')
    args = p.parse_args()
    cloud.require(re.fullmatch(r'[a-z0-9-]{1,80}', args.project), 'Invalid dedicated Vercel project name')
    cloud.require(re.fullmatch(r'[A-Za-z0-9:_-]{1,80}', args.prefix), 'Invalid dedicated Redis prefix (1–80 characters)')
    if args.redeploy:
        try:
            cloud.require(str(uuid.UUID(args.redeploy)) == args.redeploy, 'Redeploy UUID must be canonical')
        except ValueError:
            raise cloud.ConfigurationError('Redeploy UUID must be canonical') from None
    repository = Path(__file__).resolve().parents[2]
    for private in (args.state, args.redis_state):
        cloud.require(private.is_absolute() and repository not in private.resolve().parents and private.resolve() != repository, 'Cloud state must be outside the repository')
    with cloud.state_lock(args.state):
        state = cloud.private_json(args.state)
        db = cloud.private_json(args.redis_state)['upstashDatabase']
        auth = cloud.private_json(args.vercel_auth)['token']
        def vercel(route, method='GET', data=None):
            return cloud.request('https://api.vercel.com' + route + ('&' if '?' in route else '?') + 'teamId=' + TEAM, method, data, 'Bearer ' + auth)
        cloud.require(state.get('gridResource') and state.get('userRole'), 'Logto resource/default role must be configured first')
        cloud.require(not args.allow_local_development or state['logtoTenant']['tag'] == 'development', 'Loopback origins are development-only')
        grid, frontend = cloud.origin(args.grid_origin), cloud.origin(args.frontend_origin)
        cloud.require(state['gridResource']['indicator'] == grid + '/api', 'Fixed audience does not match the saved deployment configuration')
        cloud.require(db.get('tls') is True and db.get('eviction') is False, 'Redis must use TLS with eviction disabled')
        if not state.get('vercelGridProject'):
            projects = vercel('/v9/projects')['projects']
            cloud.require(not any(x['name'] == args.project for x in projects), 'Project exists; recover its ID into private state before proceeding')
            project = vercel('/v11/projects', 'POST', {'name': args.project, 'framework': None, 'publicSource': False})
            state['vercelGridProject'] = project['id']
            cloud.save_private(args.state, state)
        project = state['vercelGridProject']
        actual = vercel('/v9/projects/' + project)
        cloud.require(actual['name'] == args.project, 'Saved Vercel project ID differs; refusing to overwrite another project')
        directory = state['logtoTenant']['defaultApplication']
        origins = [frontend] + (['http://127.0.0.1:4173', 'http://localhost:5173'] if args.allow_local_development else [])
        env = {'LOGTO_ISSUER': state['tenantEndpoint'] + '/oidc', 'LOGTO_RESOURCE': state['gridResource']['indicator'],
               'LOGTO_BROWSER_CLIENT_ID': state['spaApplication']['id'], 'LOGTO_MANAGEMENT_CLIENT_ID': directory['id'],
               'LOGTO_MANAGEMENT_CLIENT_SECRET': directory['secret'], 'UPSTASH_REDIS_REST_URL': 'https://' + db['endpoint'],
               'UPSTASH_REDIS_REST_TOKEN': db['rest_token'], 'CYBERGRID_REDIS_PREFIX': args.prefix,
               'CYBERGRID_PUBLIC_ORIGIN': grid, 'CYBERGRID_BROWSER_ORIGINS': ','.join(origins)}
        identity = configuration_identity(project, args.project, PIN, env)
        deployment = deploy(vercel, state, lambda: cloud.save_private(args.state, state), identity, env, args.redeploy)
        print(json.dumps({'project': project, 'origin': grid, 'source': PIN,
                          'deploymentId': deployment['id'], 'status': deployment.get('readyState')}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except cloud.ConfigurationError as error:
        raise SystemExit(str(error)) from None
