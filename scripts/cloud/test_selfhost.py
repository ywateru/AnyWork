#!/usr/bin/env python3
"""Offline contracts for configuring an existing shared self-hosted tenant."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('selfhost', Path(__file__).with_name('configure-selfhost.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Inventory:
    def __init__(self):
        self.objects = {'/applications': [{'id': 'bootstrap', 'name': 'Existing management', 'type': 'MachineToMachine'}],
                        '/resources': [], '/roles': []}
        self.account = {'enabled': False, 'fields': {'phone': 'ReadOnly'}}
        self.signin = {'signUp': {'identifiers': ['username']}, 'socialSignInConnectorTargets': ['existing']}
        self.calls = []

    def __call__(self, route, method='GET', data=None):
        self.calls.append((route, method, copy.deepcopy(data)))
        path = route.split('?')[0]
        if path == '/account-center':
            if method == 'PATCH':
                self.account.update(copy.deepcopy(data))
            return copy.deepcopy(self.account)
        if path == '/sign-in-exp':
            if method != 'GET':
                raise AssertionError('Shared sign-in experience was changed')
            return copy.deepcopy(self.signin)
        if method == 'GET':
            return copy.deepcopy(self.objects.get(path, []))
        if method == 'POST':
            if path.endswith('/scopes') and path.startswith('/roles/'):
                self.objects.setdefault(path, []).extend({'id': item} for item in data['scopeIds'])
                return None
            item = {'id': 'owned-' + str(len(self.calls)), **copy.deepcopy(data)}
            self.objects.setdefault(path, []).append(item)
            return copy.deepcopy(item)
        if method == 'PATCH':
            collection, object_id = path.rsplit('/', 1)
            item = next(item for item in self.objects[collection] if item['id'] == object_id)
            item.update(copy.deepcopy(data))
            return copy.deepcopy(item)
        raise AssertionError('Unexpected request')


class SelfHostedContracts(unittest.TestCase):
    def tool(self, root):
        state = {'mode': 'self-hosted', 'tenantEndpoint': 'https://auth.example.invalid',
                 'tokenEndpoint': 'https://auth.example.invalid/oidc/token',
                 'managementApi': 'https://auth.example.invalid/api',
                 'managementResource': 'https://default.logto.app/api',
                 'logtoTenant': {'defaultApplication': {'id': 'bootstrap', 'secret': 'fixture-bootstrap-credential'}}}
        return module.SelfHosted(Path(root) / 'state.json', state)

    def test_custom_domain_does_not_choose_management_audience(self):
        with tempfile.TemporaryDirectory() as root:
            tool = self.tool(root)
            with patch.object(module.cloud, 'request', return_value={'scope': 'all', 'access_token': 'fixture'}) as call:
                tool.authenticate()
            self.assertEqual(call.call_args.args[0], 'https://auth.example.invalid/oidc/token')
            self.assertEqual(call.call_args.args[2]['resource'], 'https://default.logto.app/api')
            self.assertEqual(tool.path.stat().st_mode & 0o777, 0o600)

    def test_absent_management_audience_fails_before_transmission(self):
        with tempfile.TemporaryDirectory() as root:
            tool = self.tool(root)
            tool.state.pop('managementResource')
            with patch.object(module.cloud, 'request') as call:
                with self.assertRaises(module.cloud.ConfigurationError):
                    tool.authenticate()
                call.assert_not_called()

    def test_shared_login_and_existing_management_app_are_preserved_on_replay(self):
        with tempfile.TemporaryDirectory() as root:
            tool, inventory = self.tool(root), Inventory()
            tool.api = inventory
            tool.authenticate = lambda: None
            tool.configure('https://site.example.invalid', 'https://grid.example.invalid', True)
            creations = len([call for call in inventory.calls if call[1] == 'POST'])
            tool.configure('https://site.example.invalid', 'https://grid.example.invalid', True)
            self.assertEqual(creations, len([call for call in inventory.calls if call[1] == 'POST']))
            self.assertEqual(inventory.objects['/applications'][0],
                             {'id': 'bootstrap', 'name': 'Existing management', 'type': 'MachineToMachine'})
            self.assertFalse(any(route == '/sign-in-exp' and method != 'GET'
                                 for route, method, _ in inventory.calls))
            self.assertEqual(inventory.account['fields']['phone'], 'ReadOnly')
            self.assertEqual(inventory.account['fields']['customData'], 'Edit')
            self.assertTrue(tool.state['userRole']['isDefault'])
            self.assertEqual(len(inventory.objects['/applications']), 3)
            native = tool.state['nativeApplication']
            self.assertEqual(native['oidcClientMetadata']['redirectUris'], ['http://127.0.0.1:17897/callback'])
            self.assertFalse(native['customClientMetadata']['isDeviceFlow'])
            self.assertTrue(native['customClientMetadata']['rotateRefreshToken'])

    def test_lost_creation_response_is_reconciled_without_second_post(self):
        with tempfile.TemporaryDirectory() as root:
            tool = self.tool(root)
            identity = {'name': 'AnyWork Web', 'type': 'SPA'}
            tool.state['configurationIntents'] = {'spaApplication': {'phase': 'submitting', 'identity': identity}}
            inventory = Inventory()
            inventory.objects['/applications'].append({'id': 'created', **identity})
            tool.api = inventory
            self.assertEqual(tool.owned('spaApplication', '/applications', identity, identity)['id'], 'created')
            self.assertTrue(all(method == 'GET' for _, method, _ in inventory.calls))

    def test_unknown_creation_without_match_never_blindly_resubmits(self):
        with tempfile.TemporaryDirectory() as root:
            tool = self.tool(root)
            identity = {'name': 'AnyWork Web', 'type': 'SPA'}
            tool.state['configurationIntents'] = {'spaApplication': {'phase': 'submitting', 'identity': identity}}
            tool.api = inventory = Inventory()
            with self.assertRaisesRegex(module.cloud.ConfigurationError, 'Unknown object creation'):
                tool.owned('spaApplication', '/applications', identity, identity)
            self.assertTrue(all(method == 'GET' for _, method, _ in inventory.calls))

    def test_saved_id_mismatch_and_ambiguous_names_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            tool = self.tool(root)
            identity = {'name': 'AnyWork Web', 'type': 'SPA'}
            inventory = Inventory()
            inventory.objects['/applications'].append({'id': 'different', **identity})
            tool.api = inventory
            tool.state['spaApplication'] = {'id': 'saved'}
            with self.assertRaises(module.cloud.ConfigurationError):
                tool.owned('spaApplication', '/applications', identity, identity)
            tool.state.pop('spaApplication')
            inventory.objects['/applications'].append({'id': 'duplicate', **identity})
            with self.assertRaises(module.cloud.ConfigurationError):
                tool.owned('spaApplication', '/applications', identity, identity)
            self.assertTrue(all(method == 'GET' for _, method, _ in inventory.calls))


if __name__ == '__main__':
    unittest.main()
