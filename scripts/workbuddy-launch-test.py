#!/usr/bin/env python3
"""Exercise launcher lifecycle with a fake bundle and loopback CDP HTTP fixture only."""
import importlib.util
import json
import os
import pathlib
import plistlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

SCRIPT = pathlib.Path(__file__).with_name('workbuddy-launch.py')
SPEC = importlib.util.spec_from_file_location('workbuddy_launch', SCRIPT)
LAUNCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCH)

FAKE = r'''import http.server,json,os,pathlib,sys,threading,time,uuid
mode=os.environ.get('ANYWORK_LAUNCH_FIXTURE_MODE','ok')
time.sleep(float(os.environ.get('ANYWORK_LAUNCH_FIXTURE_START_DELAY','0')))
config=pathlib.Path(os.environ['WORKBUDDY_CONFIG_DIR'])
profile=pathlib.Path(os.environ['WORKBUDDY_USER_DATA_DIR'])
report=pathlib.Path(os.environ['ANYWORK_LAUNCH_FIXTURE_REPORT'])
report.write_text(json.dumps({'pid':os.getpid(),'config':str(config),'profile':str(profile),'debug':os.environ.get('WORKBUDDY_REMOTE_DEBUGGING_PORT')}))
if mode=='exit':sys.exit(0)
app=pathlib.Path(__file__).parents[2]
identity=str(uuid.uuid4())
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if mode=='redirect':
   self.send_response(302);self.send_header('Location','http://example.invalid/');self.end_headers();return
  if self.path=='/json/version':
   host='example.invalid' if mode=='remote' else '127.0.0.1'
   bid=str(uuid.uuid4()) if mode=='identity' else identity
   data={'Browser':'Chrome/138.0','webSocketDebuggerUrl':f'ws://{host}:{server.server_port}/devtools/browser/{bid}'}
  elif self.path=='/json/list':
   url=(app/'Contents/Resources/app.asar/renderer/index.html').as_uri()
   data=[{'type':'page','title':'WorkBuddy','url':url if mode!='wrongtarget' else 'file:///other/index.html'}]
  else:self.send_response(404);self.end_headers();return
  self.send_response(200);self.end_headers();self.wfile.write(json.dumps(data).encode())
server=http.server.HTTPServer(('127.0.0.1',0),Handler)
if mode not in ('stale','session-stale'):
 target=profile/'session/DevToolsActivePort' if mode=='session' else profile/'DevToolsActivePort'
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_text(f'{server.server_port}\n/devtools/browser/{identity}\n')
 if mode=='ambiguous':
  (profile/'session').mkdir()
  (profile/'session/DevToolsActivePort').write_text(f'{server.server_port}\n/devtools/browser/{identity}\n')
server.serve_forever()
'''


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='anywork-wb-launch-', dir='/private/tmp' if pathlib.Path('/private/tmp').is_dir() else None)
        self.root = pathlib.Path(self.temp.name)
        self.app = self.root / 'WorkBuddy.app'
        (self.app / 'Contents/MacOS').mkdir(parents=True)
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.tencent.workbuddy.mac', 'CFBundleShortVersionString': '5.9.3', 'CFBundleExecutable': 'Electron'}))
        executable = self.app / 'Contents/MacOS/Electron'
        executable.write_text('#!' + sys.executable + '\n' + FAKE)
        executable.chmod(0o700)
        self.config = self.root / 'config'
        self.profile = self.root / 'profile'
        self.descriptor = self.root / 'private/host.json'
        self.report = self.root / 'report.json'
        self.launcher = None

    def tearDown(self):
        if self.launcher is not None and self.launcher.poll() is None:
            self.launcher.terminate()
            self.launcher.communicate(timeout=5)
        if self.report.exists():
            pid = json.loads(self.report.read_text())['pid']
            # Only the explicitly created fake fixture process is terminated.
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        self.temp.cleanup()

    def start(self, mode='ok', timeout=3, startup_delay=0):
        env = {**os.environ, 'HOME': str(self.root), 'ANYWORK_LAUNCH_FIXTURE_MODE': mode, 'ANYWORK_LAUNCH_FIXTURE_REPORT': str(self.report), 'ANYWORK_LAUNCH_FIXTURE_START_DELAY': str(startup_delay)}
        self.launcher = subprocess.Popen([sys.executable, str(SCRIPT), '--app', str(self.app), '--config-dir', str(self.config), '--user-data-dir', str(self.profile), '--descriptor', str(self.descriptor), '--timeout', str(timeout)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return self.launcher

    def wait_report(self):
        # Popen does not wait for the fake desktop's Python imports or report.
        # A deliberate launcher timeout may finish first under CPU pressure.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                return json.loads(self.report.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                time.sleep(0.03)
        self.fail('Fake desktop did not publish its startup report')

    def wait_descriptor(self):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.descriptor.exists():
                return json.loads(self.descriptor.read_text())
            if self.launcher.poll() is not None:
                self.fail('Launcher exited: ' + str(self.launcher.communicate()))
            time.sleep(0.03)
        self.fail('Descriptor not published')

    def test_original_executable_environment_and_private_descriptor(self):
        self.start()
        data = self.wait_descriptor()
        report = json.loads(self.report.read_text())
        self.assertEqual(report['debug'], '0')
        self.assertEqual(report['config'], str(self.config))
        self.assertEqual(report['profile'], str(self.profile))
        self.assertEqual(set(data), {'version', 'agent', 'appVersion', 'pid', 'url', 'browserId', 'configDir', 'instanceId'})
        self.assertEqual((data['version'], data['agent'], data['appVersion'], data['pid']), (1, 'workbuddy', '5.9.3', report['pid']))
        self.assertEqual(data['configDir'], str(self.config))
        self.assertTrue(data['url'].startswith('http://127.0.0.1:'))
        uuid.UUID(data['instanceId'])
        uuid.UUID(data['browserId'])
        self.assertEqual(self.descriptor.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.descriptor.parent.stat().st_mode & 0o777, 0o700)
        self.launcher.terminate()
        out, err = self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 0, err)
        self.assertFalse(self.descriptor.exists())
        os.kill(report['pid'], 0)
        self.assertNotIn(data['browserId'], out + err)
        self.assertNotIn(data['url'], out + err)

    def test_normal_session_directory_is_discovered_without_reusing_stale_root(self):
        self.profile.mkdir()
        stale = self.profile / 'DevToolsActivePort'
        stale.write_text('65534\n/devtools/browser/' + str(uuid.uuid4()) + '\n')
        before = stale.read_bytes()
        self.start('session')
        data = self.wait_descriptor()
        self.assertEqual(data['pid'], json.loads(self.report.read_text())['pid'])
        self.assertEqual(stale.read_bytes(), before)
        self.assertTrue((self.profile / 'session/DevToolsActivePort').is_file())

    def test_ambiguous_fresh_entries_are_rejected_without_terminating_desktop(self):
        self.start('ambiguous')
        _, err = self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertIn('Multiple fresh desktop entries', err)
        self.assertFalse(self.descriptor.exists())
        os.kill(json.loads(self.report.read_text())['pid'], 0)

    def test_session_path_symlink_is_rejected_before_launch(self):
        self.profile.mkdir()
        target = self.root / 'session-target'
        target.mkdir()
        (self.profile / 'session').symlink_to(target)
        self.start()
        _, err = self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertIn('symbolic links', err)
        self.assertFalse(self.report.exists())
        self.assertEqual(list(target.iterdir()), [])

    def test_stale_session_entry_is_not_reused(self):
        (self.profile / 'session').mkdir(parents=True)
        active = self.profile / 'session/DevToolsActivePort'
        active.write_text('65534\n/devtools/browser/' + str(uuid.uuid4()) + '\n')
        before = active.read_bytes()
        self.start('session-stale', timeout=0.4)
        self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertEqual(active.read_bytes(), before)
        self.assertFalse(self.descriptor.exists())

    def test_desktop_exit_cleans_own_descriptor(self):
        self.start()
        data = self.wait_descriptor()
        os.kill(data['pid'], signal.SIGTERM)
        self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 0)
        self.assertFalse(self.descriptor.exists())

    def test_cleanup_preserves_replacement_instance(self):
        self.start()
        data = self.wait_descriptor()
        data['instanceId'] = str(uuid.uuid4())
        replacement = self.descriptor.with_name('replacement.json')
        replacement.write_text(json.dumps(data))
        replacement.chmod(0o600)
        replacement.replace(self.descriptor)
        self.launcher.terminate()
        self.launcher.communicate(timeout=5)
        self.assertEqual(json.loads(self.descriptor.read_text()), data)

    def test_existing_profile_lock_never_launches_or_removes_it(self):
        self.profile.mkdir()
        lock = self.profile / 'SingletonLock'
        lock.symlink_to('fixture-host-123')
        self.start()
        _, err = self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertIn('Quit WorkBuddy normally', err)
        self.assertTrue(lock.is_symlink())
        self.assertFalse(self.report.exists())

    def test_existing_descriptor_is_not_replaced(self):
        self.descriptor.parent.mkdir(mode=0o700)
        self.descriptor.write_text('existing')
        self.descriptor.chmod(0o600)
        self.start()
        self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertEqual(self.descriptor.read_text(), 'existing')
        self.assertFalse(self.report.exists())

    def test_unsafe_directory_is_not_chmodded(self):
        self.descriptor.parent.mkdir(mode=0o755)
        self.descriptor.parent.chmod(0o755)
        self.start()
        _, err = self.launcher.communicate(timeout=5)
        self.assertIn('0700', err)
        self.assertEqual(self.descriptor.parent.stat().st_mode & 0o777, 0o755)
        self.assertFalse(self.report.exists())

    def test_symlink_setup_paths_are_rejected_without_touching_target(self):
        target = self.root / 'target'
        target.mkdir(mode=0o700)
        self.descriptor.parent.symlink_to(target)
        self.start()
        _, err = self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertIn('symbolic links', err)
        self.assertEqual(list(target.iterdir()), [])
        self.assertFalse(self.report.exists())

    def test_wrong_bundle_version_is_rejected_before_launch(self):
        path = self.app / 'Contents/Info.plist'
        data = plistlib.loads(path.read_bytes())
        data['CFBundleShortVersionString'] = '5.9.2'
        path.write_bytes(plistlib.dumps(data))
        self.start()
        self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertFalse(self.report.exists())

    def test_no_debug_on_second_instance_reports_actionable_error(self):
        self.start('exit')
        _, err = self.launcher.communicate(timeout=5)
        self.assertEqual(self.launcher.returncode, 1)
        self.assertIn('Quit it normally', err)
        self.assertFalse(self.descriptor.exists())

    def test_stale_file_remote_redirect_mismatched_id_and_wrong_target_never_publish(self):
        # Every case gets an independent fixture; no live desktop or network service.
        for mode in ['stale', 'remote', 'redirect', 'identity', 'wrongtarget']:
            with self.subTest(mode=mode):
                self.profile.mkdir(exist_ok=True)
                active = self.profile / 'DevToolsActivePort'
                if mode == 'stale':
                    active.write_text('65534\n/devtools/browser/' + str(uuid.uuid4()) + '\n')
                    old = active.read_bytes()
                # Reproduce delayed child scheduling deterministically: the
                # stale case times out before the desktop writes its report.
                self.start(mode, timeout=0.4, startup_delay=0.7 if mode == 'stale' else 0)
                self.launcher.communicate(timeout=5)
                self.assertEqual(self.launcher.returncode, 1)
                self.assertFalse(self.descriptor.exists())
                if mode == 'stale':
                    self.assertEqual(active.read_bytes(), old)
                pid = self.wait_report()['pid']
                os.kill(pid, 0)  # Setup failure must not terminate the desktop.
                os.killpg(pid, signal.SIGTERM)
                self.report.unlink()
                active.unlink(missing_ok=True)

    def test_atomic_publish_preserves_competing_descriptor(self):
        LAUNCH.publish(self.descriptor, {'instanceId': 'first'})
        with self.assertRaises(LAUNCH.SetupError):
            LAUNCH.publish(self.descriptor, {'instanceId': 'second'})
        self.assertEqual(json.loads(self.descriptor.read_text()), {'instanceId': 'first'})
        LAUNCH.cleanup(self.descriptor, 'second')
        self.assertTrue(self.descriptor.exists())
        LAUNCH.cleanup(self.descriptor, 'first')
        self.assertFalse(self.descriptor.exists())


if __name__ == '__main__':
    unittest.main()
