#!/usr/bin/env python3
"""Configure AnyWork cloud infrastructure without exposing management credentials.

State is private, outside the repository. All commands reconcile saved resource IDs;
no command upgrades a plan, resets Redis, deletes a resource, or reads business data.
See docs/cloud-configuration.md for the authorized deployment and data boundaries.
"""
import argparse
import base64
import contextlib
import json
import os
import re
from pathlib import Path
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request

UA = 'AnyWork-cloud-provisioner'


class ConfigurationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ConfigurationError(message)


def private_json(path):
    require(path.is_file() and not path.is_symlink(), 'Private state must be a regular file')
    if os.name != 'nt':
        require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0,
                'Private state must have mode 0600 (or stricter)')
    try:
        value = json.loads(path.read_text())
        require(isinstance(value, dict), 'Private state must be an object')
        return value
    except (ValueError, UnicodeError):
        raise ConfigurationError('Private state is not valid JSON') from None


def save_private(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not path.parent.is_symlink(), 'Private directory cannot be a symlink')
    require(not path.is_symlink(), 'Private state cannot be a symlink')
    fd, temporary = tempfile.mkstemp(prefix='.cloud-', dir=path.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def state_lock(path):
    # Separate state files isolate environments; a lock also prevents lost secret
    # updates if two provisioning steps are accidentally started concurrently.
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if os.name == 'nt':
            import msvcrt
            os.write(fd, b'0')
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    except BlockingIOError:
        raise ConfigurationError('Another cloud command is updating this state') from None
    finally:
        os.close(fd)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(url, method='GET', data=None, authorization=None, form=False):
    require(urllib.parse.urlsplit(url).scheme == 'https', 'Cloud API requires HTTPS')
    headers = {'User-Agent': UA, 'Accept': 'application/json'}
    if authorization:
        headers['Authorization'] = authorization
    body = None
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        body = (urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode())
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, data=body, headers=headers, method=method), timeout=30) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            require(len(raw) <= 4 * 1024 * 1024, 'Cloud metadata exceeds its read limit')
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        # Error bodies can contain submitted secrets. Never log them, a request
        # body, Authorization, the URL query, or an unredacted response object.
        code = None
        try:
            value = json.loads(error.read(8192))
            candidate = value.get('code')
            if isinstance(candidate, str) and all(c.isalnum() or c in '._-' for c in candidate):
                code = candidate
        except (ValueError, UnicodeError, AttributeError):
            pass
        suffix = ' (' + code + ')' if code else ''
        raise ConfigurationError(f'Cloud API rejected {method}: HTTP {error.code}{suffix}. '
                                 'Do not retry a mutation blindly; reconcile saved state and resource inventory.') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ConfigurationError('Cloud transport failed; mutation outcome may be unknown. '
                                 'Reconcile inventory before retrying. No automatic retry was performed.') from None
    except (ValueError, UnicodeError):
        raise ConfigurationError('Cloud API returned invalid metadata') from None


def origin(value, development=False):
    p = urllib.parse.urlsplit(value)
    require(p.scheme == 'https' or (development and p.scheme == 'http' and p.hostname in ('localhost', '127.0.0.1')),
            'Use an HTTPS origin (HTTP loopback is allowed only for explicit development)')
    require(p.hostname and '*' not in p.hostname and p.netloc and not p.username and not p.password and p.path in ('', '/') and not p.query and not p.fragment,
            'Expected a credential-free exact origin, without a path/query/fragment')
    return p.scheme + '://' + p.netloc


PUBLIC_KEYS = ('VITE_LOGTO_ENDPOINT', 'VITE_LOGTO_APP_ID', 'VITE_LOGTO_RESOURCE',
               'VITE_CYBERGRID_URL', 'VITE_CYBERGRID_NATIVE_APP_ID')


def validate_public_config(values):
    """Validate one complete frontend binding; never mix in another tenant."""
    require(all(isinstance(values.get(key), str) and values[key] for key in PUBLIC_KEYS),
            'All five public account configuration fields are required')
    result = {key: values[key] for key in PUBLIC_KEYS}
    require(not any(c.isspace() for value in result.values() for c in value),
            'Public account configuration cannot contain whitespace')
    try:
        for key in ('VITE_LOGTO_ENDPOINT', 'VITE_CYBERGRID_URL'):
            result[key] = origin(result[key])
        for key in ('VITE_LOGTO_APP_ID', 'VITE_CYBERGRID_NATIVE_APP_ID'):
            require(re.fullmatch(r'[A-Za-z0-9_-]{1,21}', result[key]), 'Invalid public application ID')
        resource = urllib.parse.urlsplit(result['VITE_LOGTO_RESOURCE'])
        require(resource.scheme == 'https' and resource.hostname and not resource.username
                and not resource.password and not resource.query and not resource.fragment
                and '*' not in resource.netloc and not any(c.isspace() for c in resource.netloc),
                'Invalid public account resource')
        resource.port  # Reject malformed/out-of-range ports without printing the submitted value.
        for key in ('VITE_LOGTO_ENDPOINT', 'VITE_CYBERGRID_URL'):
            parsed = urllib.parse.urlsplit(result[key])
            parsed.port
            require(re.fullmatch(r'[A-Za-z0-9.:[\]-]+', parsed.netloc), 'Invalid public account origin')
    except ValueError:
        raise ConfigurationError('Invalid public account configuration') from None
    return result


class Provisioner:
    def __init__(self, path, state):
        self.path, self.state = path, state

    def save(self):
        save_private(self.path, self.state)

    def cloud(self, route, method='GET', data=None):
        require(self.state.get('logtoCloudPat'), 'Add logtoCloudPat to private state first')
        return request('https://cloud.logto.io' + route, method, data, 'Bearer ' + self.state['logtoCloudPat'])

    def create_tenant(self, name, tag, region):
        if self.state.get('logtoTenant'):
            require(self.state['logtoTenant']['name'] == name and self.state['logtoTenant']['tag'] == tag,
                    'Saved tenant differs; use a separate private state file')
            return
        regions = self.cloud('/api/me/regions')['regions']
        require(any(x['name'] == region and tag in x.get('tags', [tag]) for x in regions), 'Region/tag unavailable')
        tenants = self.cloud('/api/tenants')
        require(not any(x['name'] == name for x in tenants),
                'Tenant name already exists. Recover its credentials/state; refusing duplicate creation')
        self.state['logtoTenant'] = self.cloud('/api/tenants', 'POST', {'name': name, 'tag': tag, 'regionName': region})
        self.state['tenantEndpoint'] = self.state['logtoTenant']['indicator'].removesuffix('/api')
        self.save()

    def management_token(self):
        t = self.state.get('logtoTenant')
        require(t and t.get('defaultApplication'), 'Saved tenant creation credentials are required')
        a = t['defaultApplication']
        require(a.get('id') and a.get('secret'), 'Saved M2M credentials are incomplete')
        auth = base64.b64encode((a['id'] + ':' + a['secret']).encode()).decode()
        endpoint = self.state['tenantEndpoint']
        token = request(endpoint + '/oidc/token', 'POST', {'grant_type': 'client_credentials', 'resource': endpoint + '/api', 'scope': 'all'}, 'Basic ' + auth, form=True)
        self.state['managementToken'] = token['access_token']
        self.save()

    def logto(self, route, method='GET', data=None):
        return request(self.state['tenantEndpoint'] + route, method, data, 'Bearer ' + self.state['managementToken'])

    def configure_logto(self, frontend, grid, local_development=False):
        development = self.state['logtoTenant']['tag'] == 'development'
        require(not local_development or development, 'Loopback origins cannot be added to a production tenant')
        frontend, grid = origin(frontend), origin(grid)
        self.management_token()
        self.state['frontendOrigin'], self.state['gridOrigin'] = frontend, grid
        callbacks = [frontend + '/app/callback', grid + '/console/callback/']
        logouts = [frontend + '/app/', grid + '/']
        origins = [frontend, grid]
        if local_development:
            for local in ('http://127.0.0.1:4173', 'http://localhost:5173'):
                callbacks.append(local + '/app/callback')
                logouts.append(local + '/app/')
                origins.append(local)
        apps = self.logto('/api/applications?page_size=100')
        for key, name, kind, redirects, exits, cors in [
            ('spaApplication', 'AnyWork Web', 'SPA', callbacks, logouts, origins),
            ('nativeApplication', 'AnyWork Desktop', 'Native', ['http://127.0.0.1:17897/callback'], [], []),
        ]:
            metadata = {'oidcClientMetadata': {'redirectUris': redirects, 'postLogoutRedirectUris': exits},
                        'customClientMetadata': {'corsAllowedOrigins': cors, 'isDeviceFlow': False, 'rotateRefreshToken': True, 'alwaysIssueRefreshToken': True}}
            existing = next((x for x in apps if x['name'] == name and x['type'] == kind), None)
            app = self.logto('/api/applications/' + existing['id'], 'PATCH', metadata) if existing else self.logto('/api/applications', 'POST', {'name': name, 'type': kind, **metadata})
            self.state[key] = app
            self.save()
        self.logto('/api/account-center', 'PATCH', {'enabled': True, 'fields': {'name': 'ReadOnly', 'avatar': 'ReadOnly', 'email': 'ReadOnly', 'customData': 'Edit'}})
        methods = [{'identifier': 'email', 'password': True, 'verificationCode': True, 'isPasswordPrimary': True}]
        if development:
            methods.append({'identifier': 'username', 'password': True, 'verificationCode': False, 'isPasswordPrimary': True})
        self.logto('/api/sign-in-exp', 'PATCH', {
            'color': {'primaryColor': '#171717', 'darkPrimaryColor': '#FFFFFF', 'isDarkModeEnabled': False},
            'languageInfo': {'autoDetect': True, 'fallbackLanguage': 'zh-CN'},
            'signInMode': 'SignInAndRegister', 'socialSignInConnectorTargets': [],
            'signIn': {'methods': methods}, 'signUp': {'identifiers': ['email'], 'password': True, 'verify': True},
            'forgotPasswordMethods': ['EmailVerificationCode']})
        resource = next((x for x in self.logto('/api/resources') if x['indicator'] == grid + '/api'), None)
        if resource is None:
            resource = self.logto('/api/resources', 'POST', {'name': 'AnyWork CyberGrid', 'indicator': grid + '/api', 'accessTokenTtl': 300})
        if resource.get('accessTokenTtl') != 300:
            resource = self.logto('/api/resources/' + resource['id'], 'PATCH', {'accessTokenTtl': 300})
        self.state['gridResource'] = resource
        self.save()
        scopes = self.logto('/api/resources/' + resource['id'] + '/scopes')
        scope = next((x for x in scopes if x['name'] == 'connect'), None)
        if scope is None:
            scope = self.logto('/api/resources/' + resource['id'] + '/scopes', 'POST', {'name': 'connect', 'description': 'Discover and connect to your own AnyWork devices'})
        self.state['gridScope'] = scope
        self.save()
        roles = self.logto('/api/roles?page_size=100')
        role = next((x for x in roles if x['name'] == 'AnyWork user' and x['type'] == 'User'), None)
        if role is None:
            role = self.logto('/api/roles', 'POST', {'name': 'AnyWork user', 'description': 'Discover and connect to own devices', 'type': 'User', 'isDefault': True, 'scopeIds': [scope['id']]})
        if not role.get('isDefault'):
            role = self.logto('/api/roles/' + role['id'], 'PATCH', {'isDefault': True})
        assigned = self.logto('/api/roles/' + role['id'] + '/scopes')
        if not any(x['id'] == scope['id'] for x in assigned):
            self.logto('/api/roles/' + role['id'] + '/scopes', 'POST', {'scopeIds': [scope['id']]})
        self.state['userRole'] = role
        # Upstream requires Management API all. A dedicated tenant's creation M2M
        # is used, as Free permits only one M2M; never distribute its secret.
        self.state['directoryApplication'] = self.logto('/api/applications/' + self.state['logtoTenant']['defaultApplication']['id'])
        self.save()

    def create_redis(self, email, key_file):
        if self.state.get('upstashDatabase'):
            return
        require(key_file.is_file() and not key_file.is_symlink(), 'Upstash key file must be a regular file')
        if os.name != 'nt':
            require(stat.S_IMODE(key_file.stat().st_mode) & 0o077 == 0, 'Upstash key file must be mode 0600')
        key = key_file.read_text().strip()
        require(key and '\n' not in key and ':' not in email, 'Invalid Upstash management credentials')
        auth = 'Basic ' + base64.b64encode((email + ':' + key).encode()).decode()
        items = request('https://api.upstash.com/v2/redis/databases', authorization=auth)
        require(not any(x['database_name'] == 'anywork-cybergrid' for x in items), 'Redis already exists; recover private state instead of creating a duplicate')
        self.state['upstashDatabase'] = request('https://api.upstash.com/v2/redis/database', 'POST', {
            'database_name': 'anywork-cybergrid', 'platform': 'aws', 'primary_region': 'us-east-1', 'read_regions': [],
            'plan': 'free', 'eviction': False, 'tls': True}, auth)
        self.save()

    def public(self):
        s = self.state
        require(s.get('tenantEndpoint') and s.get('spaApplication', {}).get('id')
                and s.get('nativeApplication', {}).get('id') and s.get('gridOrigin')
                and s.get('gridResource', {}).get('indicator'), 'Tenant/apps/resource/Grid not configured')
        return validate_public_config({
            'VITE_LOGTO_ENDPOINT': s['tenantEndpoint'], 'VITE_LOGTO_APP_ID': s['spaApplication']['id'],
            'VITE_LOGTO_RESOURCE': s['gridResource']['indicator'], 'VITE_CYBERGRID_URL': s['gridOrigin'],
            'VITE_CYBERGRID_NATIVE_APP_ID': s['nativeApplication']['id']})


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', type=Path, required=True, help='Private JSON state outside Git; mode 0600')
    p.add_argument('command', choices=['create-tenant', 'configure-logto', 'create-redis', 'public-config', 'entitlements'])
    p.add_argument('--name', default='AnyWork')
    p.add_argument('--tag', choices=['development', 'production'], default='production')
    p.add_argument('--region', default='JP')
    p.add_argument('--frontend-origin', default='https://anywork.aixgg.com')
    p.add_argument('--grid-origin', default='https://anywork-cybergrid.vercel.app')
    p.add_argument('--allow-local-development', action='store_true')
    p.add_argument('--upstash-email')
    p.add_argument('--upstash-key-file', type=Path, default=Path.home() / '.ssh/upstash_api')
    args = p.parse_args()
    require(args.state.is_absolute(), 'Use an absolute private state path outside the repository')
    repository = Path(__file__).resolve().parents[2]
    require(repository != args.state.resolve() and repository not in args.state.resolve().parents,
            'Cloud secrets must be outside the repository')
    with state_lock(args.state):
        state = private_json(args.state)
        tool = Provisioner(args.state, state)
        if args.command == 'create-tenant':
            tool.create_tenant(args.name, args.tag, args.region)
        elif args.command == 'configure-logto':
            tool.configure_logto(args.frontend_origin, args.grid_origin, args.allow_local_development)
        elif args.command == 'create-redis':
            require(args.upstash_email, '--upstash-email is required')
            tool.create_redis(args.upstash_email, args.upstash_key_file)
        elif args.command == 'entitlements':
            require(state.get('logtoTenant'), 'Tenant state is required')
            skus = tool.cloud('/api/tenants/' + state['logtoTenant']['id'] + '/available-skus')
            usage = tool.cloud('/api/tenants/' + state['logtoTenant']['id'] + '/subscription-usage')
            print(json.dumps({'quota': usage['quota'], 'plans': [{k: item.get(k) for k in ('id', 'name', 'unitPrice', 'quota')} for item in skus if item['id'] in ('free', 'pro-202509', 'rbac-enabled')]}, indent=2))
            return
        else:
            print(json.dumps(tool.public(), indent=2))
            return
    print('Cloud configuration step completed; secrets retained only in private state.')


if __name__ == '__main__':
    try:
        main()
    except ConfigurationError as error:
        raise SystemExit(str(error)) from None
