#!/usr/bin/env python3
"""Configure owned AnyWork objects in an existing self-hosted Logto tenant.

The shared sign-in experience and the supplied management application are never
modified. Each create is preceded by a saved intent and reconciled by inventory.
Management audience is explicit and may differ from the custom API hostname.
"""
import argparse
import base64
import importlib.util
from pathlib import Path
import urllib.parse

spec = importlib.util.spec_from_file_location('configure', Path(__file__).with_name('configure.py'))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


class SelfHosted:
    def __init__(self, path, state):
        self.path, self.state = path, state

    def save(self):
        cloud.save_private(self.path, self.state)

    def api(self, route, method='GET', data=None):
        cloud.require(route.startswith('/') and not route.startswith('//'), 'Invalid management route')
        return cloud.request(self.state['managementApi'] + route, method, data,
                             'Bearer ' + self.state['managementToken'])

    def authenticate(self):
        state = self.state
        cloud.require(state.get('mode') == 'self-hosted', 'Explicit self-hosted state required')
        endpoint = cloud.origin(state['tenantEndpoint'])
        cloud.require(state.get('tokenEndpoint') == endpoint + '/oidc/token', 'Unexpected token endpoint')
        cloud.require(state.get('managementApi') == endpoint + '/api', 'Unexpected management API')
        audience = urllib.parse.urlsplit(state.get('managementResource', ''))
        cloud.require(audience.scheme == 'https' and audience.hostname and not audience.username
                      and not getattr(audience, 'pass' + 'word') and not audience.query and not audience.fragment,
                      'Explicit management resource required')
        app = state['logtoTenant']['defaultApplication']
        auth = base64.b64encode((app['id'] + ':' + app['secret']).encode()).decode()
        token = cloud.request(state['tokenEndpoint'], 'POST', {
            'grant_type': 'client_credentials', 'resource': state['managementResource'], 'scope': 'all'},
            'Basic ' + auth, form=True)
        cloud.require(token.get('scope') == 'all' and token.get('access_token'), 'Management permission missing')
        state['managementToken'] = token['access_token']
        self.save()

    def owned(self, key, route, identity, payload):
        """Resolve saved ID/name before creating; unknown POST outcomes stay fenced."""
        inventory = self.api(route + ('&' if '?' in route else '?') + 'page_size=100')
        cloud.require(isinstance(inventory, list) and len(inventory) < 100, 'Inventory requires manual pagination')
        matches = [item for item in inventory if all(item.get(k) == v for k, v in identity.items())]
        cloud.require(len(matches) <= 1, 'Ambiguous owned object; reconcile manually')
        saved = self.state.get(key)
        if saved:
            cloud.require(matches and matches[0]['id'] == saved['id'], 'Saved owned object differs from inventory')
            return matches[0]
        intent = self.state.setdefault('configurationIntents', {}).get(key)
        if intent:
            cloud.require(intent['identity'] == identity, 'Saved object intent differs')
            cloud.require(matches, 'Unknown object creation outcome; reconcile manually before another POST')
        if matches:
            result = matches[0]
        else:
            self.state['configurationIntents'][key] = {'phase': 'submitting', 'identity': identity}
            self.save()
            result = self.api(route, 'POST', payload)
        cloud.require(isinstance(result, dict) and result.get('id'), 'Object response omitted ID; reconcile inventory')
        self.state[key] = result
        self.state['configurationIntents'][key] = {'phase': 'observed', 'identity': identity, 'id': result['id']}
        self.save()
        return result

    def configure(self, frontend, grid, allow_loopback=False):
        frontend, grid = cloud.origin(frontend), cloud.origin(grid)
        self.authenticate()
        state = self.state
        state.update(frontendOrigin=frontend, gridOrigin=grid)
        self.save()
        origins = [frontend, grid]
        callbacks = [frontend + '/app/callback', grid + '/console/callback/']
        exits = [frontend + '/app/', grid + '/']
        if allow_loopback:
            for local in ['http://localhost:5173', 'http://127.0.0.1:4173']:
                origins.append(local)
                callbacks.append(local + '/app/callback')
                exits.append(local + '/app/')
        for key, name, kind, redirects, logouts, cors in [
            ('spaApplication', 'AnyWork Web', 'SPA', callbacks, exits, origins),
            ('nativeApplication', 'AnyWork Desktop', 'Native', ['http://127.0.0.1:17897/callback'], [], []),
        ]:
            metadata = {'oidcClientMetadata': {'redirectUris': redirects, 'postLogoutRedirectUris': logouts},
                        'customClientMetadata': {'corsAllowedOrigins': cors, 'isDeviceFlow': False,
                                                 'rotateRefreshToken': True, 'alwaysIssueRefreshToken': True}}
            app = self.owned(key, '/applications', {'name': name, 'type': kind},
                             {'name': name, 'type': kind, **metadata})
            state[key] = self.api('/applications/' + app['id'], 'PATCH', metadata)
            self.save()
        account = self.api('/account-center')
        fields = dict(account.get('fields') or {})
        fields.update(name='ReadOnly', avatar='ReadOnly', email='ReadOnly', customData='Edit')
        self.api('/account-center', 'PATCH', {'enabled': True, 'fields': fields})
        resource = self.owned('gridResource', '/resources', {'indicator': grid + '/api'},
                              {'name': 'AnyWork CyberGrid', 'indicator': grid + '/api', 'accessTokenTtl': 300})
        if resource.get('accessTokenTtl') != 300:
            resource = self.api('/resources/' + resource['id'], 'PATCH', {'accessTokenTtl': 300})
            state['gridResource'] = resource
            self.save()
        scope_route = '/resources/' + resource['id'] + '/scopes'
        scope = self.owned('gridScope', scope_route, {'name': 'connect'},
                           {'name': 'connect', 'description': 'Discover and connect to your own AnyWork devices'})
        role = self.owned('userRole', '/roles', {'name': 'AnyWork user', 'type': 'User'},
                          {'name': 'AnyWork user', 'description': 'Connect to own AnyWork devices',
                           'type': 'User', 'isDefault': True, 'scopeIds': [scope['id']]})
        if not role.get('isDefault'):
            role = self.api('/roles/' + role['id'], 'PATCH', {'isDefault': True})
        if not any(item['id'] == scope['id'] for item in self.api('/roles/' + role['id'] + '/scopes')):
            self.api('/roles/' + role['id'] + '/scopes', 'POST', {'scopeIds': [scope['id']]})
        state['userRole'] = role
        # Record readback without changing the shared login or email connectors.
        state['configuredAccountApi'] = self.api('/account-center')
        state['preservedSignInExperience'] = self.api('/sign-in-exp')
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--frontend-origin', default='https://anywork-tau.vercel.app')
    parser.add_argument('--grid-origin', required=True)
    parser.add_argument('--allow-loopback', action='store_true')
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    cloud.require(args.state.is_absolute() and repository not in args.state.resolve().parents
                  and args.state.resolve() != repository, 'Private state must be outside the repository')
    with cloud.state_lock(args.state):
        tool = SelfHosted(args.state, cloud.private_json(args.state))
        tool.configure(args.frontend_origin, args.grid_origin, args.allow_loopback)
    print('Configured owned self-hosted AnyWork objects; shared sign-in experience preserved.')


if __name__ == '__main__':
    try:
        main()
    except (cloud.ConfigurationError, KeyError, ValueError):
        raise SystemExit('Self-hosted configuration failed safely; reconcile private state and inventory before retrying.') from None
