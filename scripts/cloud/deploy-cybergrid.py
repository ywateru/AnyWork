#!/usr/bin/env python3
"""Deploy the pinned official CyberGrid tree to a dedicated Vercel project.

Uses private provisioner state and the local Vercel auth cache. Secrets are sent
only to server-side encrypted environment variables; previews get no production
credentials. Mutations are not retried automatically. Never resets Redis.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('configure', Path(__file__).with_name('configure.py'))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)
PIN = '2bd6729c6bbee90ed2926410caca883a0a100890'
REPO_ID = 1450058229
TEAM = 'team_2ljUqxKg8oifxof0IT3yayWz'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', type=Path, required=True)
    p.add_argument('--redis-state', type=Path, required=True)
    p.add_argument('--project', required=True)
    p.add_argument('--prefix', required=True)
    p.add_argument('--frontend-origin', default='https://anywork-tau.vercel.app')
    p.add_argument('--grid-origin', required=True)
    p.add_argument('--allow-local-development', action='store_true')
    p.add_argument('--vercel-auth', type=Path, default=Path.home() / 'Library/Application Support/com.vercel.cli/auth.json')
    args = p.parse_args()
    cloud.require(re.fullmatch(r'[a-z0-9-]{1,80}', args.project), 'Invalid dedicated Vercel project name')
    cloud.require(re.fullmatch(r'[A-Za-z0-9:_-]{1,100}', args.prefix), 'Invalid dedicated Redis prefix')
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
        grid = cloud.origin(args.grid_origin)
        frontend = cloud.origin(args.frontend_origin)
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
        origins = [frontend]
        if args.allow_local_development:
            origins += ['http://127.0.0.1:4173', 'http://localhost:5173']
        env = {'LOGTO_ISSUER': state['tenantEndpoint'] + '/oidc', 'LOGTO_RESOURCE': state['gridResource']['indicator'],
               'LOGTO_BROWSER_CLIENT_ID': state['spaApplication']['id'], 'LOGTO_MANAGEMENT_CLIENT_ID': directory['id'],
               'LOGTO_MANAGEMENT_CLIENT_SECRET': directory['secret'], 'UPSTASH_REDIS_REST_URL': 'https://' + db['endpoint'],
               'UPSTASH_REDIS_REST_TOKEN': db['rest_token'], 'CYBERGRID_REDIS_PREFIX': args.prefix,
               'CYBERGRID_PUBLIC_ORIGIN': grid, 'CYBERGRID_BROWSER_ORIGINS': ','.join(origins)}
        vercel('/v10/projects/' + project + '/env?upsert=true', 'POST', [
            {'key': k, 'value': v, 'type': 'encrypted', 'target': ['production']} for k, v in env.items()])
        deployment = vercel('/v13/deployments', 'POST', {'name': args.project, 'project': project, 'target': 'production',
            'gitSource': {'type': 'github', 'repoId': REPO_ID, 'ref': PIN}})
        state['gridDeployment'] = {k: deployment.get(k) for k in ('id', 'url', 'readyState')}
        state['gridSource'] = PIN
        state['gridEnvironment'] = env
        cloud.save_private(args.state, state)
        print(json.dumps({'project': project, 'origin': grid, 'source': PIN,
                          'deploymentId': deployment['id'], 'status': deployment.get('readyState')}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except cloud.ConfigurationError as error:
        raise SystemExit(str(error)) from None
