#!/usr/bin/env python3
"""Isolated launcher checks. Never starts or controls the installed application."""
import importlib.util
import json
import os
import pathlib
import socket
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('desktop_bridge', pathlib.Path(__file__).with_name('desktop-bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Bridge(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aw-bridge-', dir='/tmp')
        self.root = pathlib.Path(self.temp.name)
        self.endpoint = self.root / 'engine.sock'
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(str(self.endpoint))
        self.home = self.root / 'home'
        self.home.mkdir()
        self.data = self.root / 'data'
        self.plan = {'static_candidate_found': True, 'candidate_executable': str(self.root / 'fixture-app')}

    def tearDown(self):
        self.socket.close()
        self.temp.cleanup()

    def test_unix_uri_and_environment_select_existing_engine(self):
        uri = bridge.socket_url(self.endpoint)
        self.assertEqual(uri, 'ws+unix://localhost' + str(self.endpoint) + ':/rpc')
        with patch.dict(os.environ, {'CODEX_APP_SERVER_FORCE_CLI': '1'}):
            env = bridge.launch_environment(self.home, uri)
        self.assertNotIn('CODEX_APP_SERVER_FORCE_CLI', env)
        self.assertEqual(env['CODEX_HOME'], str(self.home))
        self.assertEqual(env['CODEX_APP_SERVER_WS_URL'], uri)

    def test_invalid_paths_and_regular_files_are_rejected(self):
        with self.assertRaises(ValueError): bridge.socket_url(self.root / 'has space.sock')
        regular = self.root / 'regular'
        regular.write_text('fixture')
        with self.assertRaises(ValueError): bridge.socket_url(regular)

    def test_registry_preserves_other_entries_and_updates_duplicate(self):
        bridge.register(self.data, self.home, self.endpoint)
        bridge.register(self.data, self.home, self.root / 'other.sock')
        bridge.register(self.data, self.home, self.endpoint)
        path = self.data / 'codex-runtimes.json'
        value = json.loads(path.read_text())
        self.assertEqual(len(value['runtimes']), 2)
        self.assertEqual(value['runtimes'][-1]['socket'], str(self.endpoint))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.data.stat().st_mode & 0o777, 0o700)

    def test_running_desktop_is_never_restarted_or_registered(self):
        with patch.object(bridge, 'running', return_value=True), patch.object(bridge.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(ValueError, 'already open'): bridge.launch(self.plan, self.home, self.endpoint, self.data)
            start.assert_not_called()
            self.assertFalse(self.data.exists())

    def test_unreachable_engine_does_not_start_app_or_change_registry(self):
        with patch.object(bridge, 'running', return_value=False), patch.object(bridge, 'check_engine', side_effect=OSError('fixture unavailable')), patch.object(bridge.subprocess, 'Popen') as start:
            with self.assertRaises(OSError): bridge.launch(self.plan, self.home, self.endpoint, self.data)
            start.assert_not_called()
            self.assertFalse(self.data.exists())

    def test_launch_requests_same_socket_without_executing_real_app(self):
        process = Mock(pid=123)
        with patch.object(bridge, 'running', return_value=False), patch.object(bridge, 'check_engine') as check, patch.object(bridge.subprocess, 'Popen', return_value=process) as start:
            result = bridge.launch(self.plan, self.home, self.endpoint, self.data)
        check.assert_called_once_with(self.endpoint)
        self.assertEqual(start.call_args.args[0], [self.plan['candidate_executable']])
        self.assertEqual(start.call_args.kwargs['env']['CODEX_APP_SERVER_WS_URL'], bridge.socket_url(self.endpoint))
        self.assertFalse(result['desktop_runtime_verified'])
        self.assertEqual(result['pid'], 123)


if __name__ == '__main__': unittest.main()
