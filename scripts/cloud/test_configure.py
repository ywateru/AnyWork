#!/usr/bin/env python3
"""Offline safety checks; real cloud acceptance is recorded separately."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cloud_configure', Path(__file__).with_name('configure.py'))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


class CloudSafety(unittest.TestCase):
    def test_private_state_is_atomic_and_refuses_public_permissions_and_symlinks(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / 'private.json'
            cloud.save_private(p, {'secret': 'fixture'})
            self.assertEqual(cloud.private_json(p), {'secret': 'fixture'})
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            os.chmod(p, 0o644)
            with self.assertRaisesRegex(cloud.ConfigurationError, '0600'):
                cloud.private_json(p)
            q = Path(root) / 'link.json'
            q.symlink_to(p)
            with self.assertRaises(cloud.ConfigurationError):
                cloud.save_private(q, {})

    def test_error_body_and_request_secrets_never_appear_in_error(self):
        secret = 'fixture-management-secret'
        error = urllib.error.HTTPError('https://example.invalid', 403, 'denied', {},
                                       io.BytesIO(json.dumps({'code': 'subscription.limit_exceeded', 'message': secret}).encode()))
        with patch.object(cloud.urllib.request.OpenerDirector, 'open', side_effect=error):
            with self.assertRaises(cloud.ConfigurationError) as raised:
                cloud.request('https://example.invalid', 'POST', {'secret': secret}, 'Bearer ' + secret)
        self.assertIn('HTTP 403 (subscription.limit_exceeded)', str(raised.exception))
        self.assertNotIn(secret, str(raised.exception))

    def test_authenticated_redirects_are_never_followed(self):
        self.assertIsNone(cloud.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://attacker.invalid'))
        with self.assertRaises(cloud.ConfigurationError):
            cloud.request('http://example.invalid')

    def test_production_refuses_loopback_before_any_mutation(self):
        p = cloud.Provisioner(Path('/unused'), {'logtoTenant': {'tag': 'production'}})
        with patch.object(p, 'management_token') as token:
            with self.assertRaisesRegex(cloud.ConfigurationError, 'production'):
                p.configure_logto('https://site.invalid', 'https://grid.invalid', True)
            token.assert_not_called()

    def test_exact_origins_reject_credentials_paths_and_wildcards(self):
        for value in ['https://a.invalid/path', 'https://name:secret@a.invalid', 'https://a.invalid?x=1', 'http://a.invalid', 'https://*.invalid']:
            with self.assertRaises(cloud.ConfigurationError):
                cloud.origin(value)
        self.assertEqual(cloud.origin('http://127.0.0.1:4173', True), 'http://127.0.0.1:4173')

    def test_existing_tenant_name_prevents_duplicate_creation(self):
        p = cloud.Provisioner(Path('/unused'), {'logtoCloudPat': 'fixture'})
        with patch.object(p, 'cloud', side_effect=[{'regions': [{'name': 'JP'}]}, [{'name': 'AnyWork'}]]) as api:
            with self.assertRaisesRegex(cloud.ConfigurationError, 'duplicate'):
                p.create_tenant('AnyWork', 'production', 'JP')
            self.assertEqual(api.call_count, 2)

    def test_public_configuration_contains_only_explicit_public_fields(self):
        p = cloud.Provisioner(Path('/unused'), {'tenantEndpoint': 'https://tenant.invalid',
              'spaApplication': {'id': 'spa', 'secret': 'never-public'},
              'nativeApplication': {'id': 'native', 'secret': 'never-public'},
              'gridOrigin': 'https://grid.invalid', 'gridResource': {'indicator': 'https://grid.invalid/api'}, 'logtoCloudPat': 'never-public'})
        public = p.public()
        self.assertEqual(len(public), 5)
        self.assertNotIn('never-public', json.dumps(public))


    def test_public_export_refuses_incomplete_binding_instead_of_using_production(self):
        complete = {'tenantEndpoint': 'https://tenant.invalid', 'spaApplication': {'id': 'spa'},
                    'nativeApplication': {'id': 'native'}, 'gridOrigin': 'https://grid.invalid',
                    'gridResource': {'indicator': 'https://grid.invalid/api'}}
        for missing in complete:
            with self.subTest(missing=missing):
                state = {k: v for k, v in complete.items() if k != missing}
                with self.assertRaises(cloud.ConfigurationError):
                    cloud.Provisioner(Path('/unused'), state).public()

    def test_public_validation_allows_complete_self_hosted_binding_and_rejects_unsafe_urls(self):
        values = dict(zip(cloud.PUBLIC_KEYS, ['https://identity.example.invalid', 'spa',
            'https://grid.example.invalid/api', 'https://grid.example.invalid', 'native']))
        self.assertEqual(cloud.validate_public_config(values), values)
        for key, bad in [('VITE_LOGTO_ENDPOINT', 'https://identity.invalid/oidc'),
                         ('VITE_LOGTO_ENDPOINT', 'https://a.invalid;object-src'),
                         ('VITE_CYBERGRID_URL', 'https://grid.invalid?query=secret'),
                         ('VITE_LOGTO_RESOURCE', 'https://name:secret@grid.invalid/api'),
                         ('VITE_LOGTO_RESOURCE', 'https://grid.invalid:99999/api'),
                         ('VITE_LOGTO_APP_ID', 'invalid application id')]:
            with self.subTest(key=key, bad=bad), self.assertRaises(cloud.ConfigurationError):
                cloud.validate_public_config({**values, key: bad})


if __name__ == '__main__':
    unittest.main()
