#!/usr/bin/env python3
"""Launch the original WorkBuddy desktop with its local debugging entry enabled.

No package patching, engine startup, credential access or desktop termination.
The descriptor is privileged local setup data; never publish it over a tunnel.
"""
import argparse
import http.client
import json
import os
import pathlib
import plistlib
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid


class SetupError(Exception):
    pass


def no_symlinks(path):
    """Check lexical ancestors; resolving first would conceal a symlink."""
    path = pathlib.Path(os.path.abspath(path))
    for part in [*reversed(path.parents), path]:
        try:
            if stat.S_ISLNK(part.lstat().st_mode):
                raise SetupError('Setup paths must not contain symbolic links')
        except FileNotFoundError:
            pass
    return path


def private_dir(path):
    path = no_symlinks(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise SetupError('Use a private directory owned by your user with mode 0700')
    return path


def read_regular(path, limit=65536):
    path = no_symlinks(path)
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    except OSError as error:
        raise SetupError('Cannot read the expected desktop setup file') from error
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SetupError('Invalid desktop setup file')
        return file.read(limit + 1)


def bundle_info(app):
    app = no_symlinks(app)
    try:
        info = plistlib.loads(read_regular(app / 'Contents/Info.plist'))
    except (ValueError, plistlib.InvalidFileException) as error:
        raise SetupError('Cannot read the WorkBuddy application metadata') from error
    if info.get('CFBundleIdentifier') != 'com.tencent.workbuddy.mac' or info.get('CFBundleShortVersionString') != '5.9.3':
        raise SetupError('This launcher supports the official WorkBuddy Desktop 5.9.3 macOS bundle')
    name = info.get('CFBundleExecutable')
    if not isinstance(name, str) or pathlib.PurePath(name).name != name or name in ('', '.', '..'):
        raise SetupError('Invalid WorkBuddy executable metadata')
    executable = no_symlinks(app / 'Contents/MacOS' / name)
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise SetupError('The WorkBuddy executable is missing or cannot run')
    return app, executable, info['CFBundleShortVersionString']


def file_identity(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode):
        raise SetupError('DevToolsActivePort must be a regular file, not a symbolic link')
    return info.st_ino, info.st_mtime_ns, info.st_size


def read_endpoint(path):
    try:
        lines = read_regular(path, 4096).decode('utf-8').splitlines()
    except UnicodeError as error:
        raise SetupError('Invalid DevToolsActivePort contents') from error
    if len(lines) != 2 or not lines[0].isdigit() or not 1 <= int(lines[0]) <= 65535:
        raise SetupError('Invalid DevToolsActivePort port')
    prefix = '/devtools/browser/'
    if not lines[1].startswith(prefix):
        raise SetupError('Invalid DevToolsActivePort browser identity')
    browser_id = lines[1][len(prefix):]
    try:
        if str(uuid.UUID(browser_id)) != browser_id.lower():
            raise ValueError()
    except ValueError as error:
        raise SetupError('Invalid DevToolsActivePort browser identity') from error
    return int(lines[0]), browser_id


def local_json(port, path):
    # http.client uses no proxy and does not follow redirects.
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
    try:
        connection.request('GET', path, headers={'Host': f'127.0.0.1:{port}'})
        response = connection.getresponse()
        if response.status != 200:
            raise SetupError('The local desktop debugging endpoint did not return HTTP 200')
        data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise SetupError('The local desktop debugging response is too large')
        return json.loads(data)
    finally:
        connection.close()


def verify_endpoint(port, browser_id, app):
    version = local_json(port, '/json/version')
    if not isinstance(version, dict) or not isinstance(version.get('webSocketDebuggerUrl'), str):
        raise SetupError('Invalid desktop debugging version response')
    url = urllib.parse.urlsplit(version.get('webSocketDebuggerUrl', ''))
    if (url.scheme != 'ws' or url.hostname != '127.0.0.1' or url.port != port or
            url.path != '/devtools/browser/' + browser_id or url.username or url.password or url.query or url.fragment):
        raise SetupError('The local desktop browser identity does not match its discovery file')
    targets = local_json(port, '/json/list')
    expected = (app / 'Contents/Resources/app.asar/renderer/index.html').as_uri()
    if not isinstance(targets, list) or not any(
        isinstance(target, dict) and target.get('type') == 'page' and isinstance(target.get('url'), str) and
        urllib.parse.urlsplit(target.get('url', ''))._replace(query='', fragment='').geturl() == expected
        for target in targets
    ):
        raise SetupError('Waiting for the original WorkBuddy main renderer')


def publish(path, descriptor):
    parent = private_dir(path.parent)
    no_symlinks(path)
    # A launcher must not overwrite another owner's entry, including a stale one.
    if path.exists():
        raise SetupError('A desktop descriptor already exists; stop its launcher before starting another')
    fd, temporary = tempfile.mkstemp(prefix='.host-', dir=parent)
    try:
        with os.fdopen(fd, 'w') as file:
            os.fchmod(file.fileno(), 0o600)
            json.dump(descriptor, file, separators=(',', ':'))
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        # Atomic no-replace publication. link fails if another launcher won.
        os.link(temporary, path, follow_symlinks=False)
    except FileExistsError as error:
        raise SetupError('Another launcher already published the desktop descriptor') from error
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def cleanup(path, instance_id):
    try:
        info = path.lstat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            return
        data = json.loads(read_regular(path))
        if data.get('instanceId') == instance_id:
            # Check identity again before unlink; never remove a replacement entry.
            current = path.lstat()
            if (info.st_ino, info.st_dev) == (current.st_ino, current.st_dev):
                path.unlink()
    except (OSError, ValueError, SetupError, AttributeError):
        pass


def parser():
    result = argparse.ArgumentParser(description=__doc__, epilog='Keep this launcher running while using AnyWork. Ctrl-C removes only its discovery descriptor; WorkBuddy remains open. Quit WorkBuddy normally to close its local debugging port. If the profile is already running, quit it normally and launch again. No account credentials are read.')
    result.add_argument('--app', type=pathlib.Path, default=pathlib.Path('/Applications/WorkBuddy.app'))
    result.add_argument('--config-dir', type=pathlib.Path, default=pathlib.Path.home() / '.workbuddy')
    result.add_argument('--user-data-dir', type=pathlib.Path, help='Electron profile (default: CONFIG_DIR/app). Explicit temporary directories isolate tests.')
    result.add_argument('--descriptor', type=pathlib.Path, default=pathlib.Path.home() / '.anywork/workbuddy/host.json')
    result.add_argument('--timeout', type=float, default=60, help='Startup timeout in seconds (default: 60)')
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    stopped = False

    def stop(_signum, _frame):
        nonlocal stopped
        stopped = True

    instance_id = str(uuid.uuid4())
    descriptor = pathlib.Path(os.path.abspath(args.descriptor))
    try:
        no_symlinks(descriptor)
        if not 0 < args.timeout <= 600:
            raise SetupError('Startup timeout must be greater than zero and at most 600 seconds')
        app, executable, version = bundle_info(args.app)
        config = no_symlinks(args.config_dir)
        user_data = no_symlinks(args.user_data_dir or config / 'app')
        private_dir(descriptor.parent)
        if descriptor.exists():
            raise SetupError('A desktop descriptor already exists; stop its launcher before starting another')
        if (user_data / 'SingletonLock').is_symlink() or (user_data / 'SingletonLock').exists():
            raise SetupError('This WorkBuddy profile is already running or has a stale instance lock. Quit WorkBuddy normally, then run this launcher again. No lock was removed.')
        config.mkdir(mode=0o700, parents=True, exist_ok=True)
        user_data.mkdir(mode=0o700, parents=True, exist_ok=True)
        active_file = user_data / 'DevToolsActivePort'
        previous = file_identity(active_file)
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, stop)
        environment = {**os.environ, 'WORKBUDDY_CONFIG_DIR': str(config), 'WORKBUDDY_USER_DATA_DIR': str(user_data), 'WORKBUDDY_REMOTE_DEBUGGING_PORT': '0'}
        # Desktop owns its descendants. A launcher signal must never terminate them.
        desktop = subprocess.Popen([str(executable)], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + args.timeout
        connected = False
        while not stopped and time.monotonic() < deadline:
            if desktop.poll() is not None:
                raise SetupError('WorkBuddy exited before sharing its entry. An existing profile may already own the desktop. Quit it normally, then retry this launcher; no second engine was started by AnyWork.')
            current = file_identity(active_file)
            if current is not None and current != previous:
                try:
                    port, browser_id = read_endpoint(active_file)
                    verify_endpoint(port, browser_id, app)
                except (OSError, ValueError, SetupError, http.client.HTTPException):
                    time.sleep(0.1)
                    continue
                publish(descriptor, {'version': 1, 'agent': 'workbuddy', 'appVersion': version, 'pid': desktop.pid, 'url': f'http://127.0.0.1:{port}/', 'browserId': browser_id, 'configDir': str(config), 'instanceId': instance_id})
                connected = True
                break
            time.sleep(0.1)
        if stopped:
            return 0
        if not connected:
            raise SetupError('WorkBuddy did not publish a matching local entry before timeout. If already running, quit it normally and retry. The desktop was not terminated.')
        print(f'WorkBuddy local entry ready. Descriptor: {descriptor}', flush=True)
        print('Keep this launcher running. Ctrl-C disconnects discovery; WorkBuddy stays open. Quit WorkBuddy normally to close the local debugging port.', flush=True)
        while not stopped and desktop.poll() is None:
            time.sleep(0.2)
        return 0
    except (SetupError, OSError, ValueError) as error:
        # Do not echo arbitrary server responses, debugger URLs or inherited env.
        message = str(error) if isinstance(error, SetupError) else 'Local desktop setup failed; check application and private directory permissions'
        print('WorkBuddy setup: ' + message, file=sys.stderr)
        return 1
    finally:
        cleanup(descriptor, instance_id)


if __name__ == '__main__':
    sys.exit(main())
