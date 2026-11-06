#!/usr/bin/env python3
"""Plan or explicitly launch the unmodified desktop app on an existing shared engine.

The default operation is read-only. This does not convert an already running
stdio engine, start another engine, stop any task, or modify the application.
"""
import argparse
import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bridge_plan', HERE / 'desktop-bridge-plan.py')
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)
probe_spec = importlib.util.spec_from_file_location('shared_probe', HERE / 'shared-engine-probe.py')
probe = importlib.util.module_from_spec(probe_spec)
probe_spec.loader.exec_module(probe)


def socket_url(path):
    path = pathlib.Path(path).absolute()
    if any(char in str(path) for char in ' :?#%\r\n\t'):
        raise ValueError('Socket path cannot contain spaces, colons or URL delimiters')
    metadata = path.stat()
    if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise ValueError('The shared endpoint must be a Unix socket owned by this user')
    return 'ws+unix://localhost' + str(path) + ':/rpc'


def launch_environment(home, uri):
    env = dict(os.environ)
    env['CODEX_HOME'] = str(home)
    env['CODEX_APP_SERVER_WS_URL'] = uri
    env.pop('CODEX_APP_SERVER_FORCE_CLI', None)
    return env


def check_engine(endpoint):
    client = probe.Client(endpoint, 'anywork_desktop_launcher')
    try:
        client.call('thread/list', {'limit': 1})
    finally:
        client.close()


def running(executable):
    commands = subprocess.check_output(['ps', '-axo', 'command='], text=True)
    return any(line.strip() == str(executable) or line.strip().startswith(str(executable) + ' ')
               for line in commands.splitlines())


def register(data_dir, home, endpoint):
    data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = data_dir / 'codex-runtimes.json'
    value = json.loads(path.read_text()) if path.exists() else {'version': 1, 'runtimes': []}
    if value.get('version') != 1 or not isinstance(value.get('runtimes'), list):
        raise ValueError('Invalid runtime registry')
    entries = [entry for entry in value['runtimes'] if entry.get('socket') != str(endpoint)]
    entries.append({'socket': str(endpoint), 'codex_home': str(home)})
    if len(entries) > 15:
        raise ValueError('Too many registered runtimes; remove stale entries explicitly')
    with tempfile.NamedTemporaryFile(mode='w', dir=data_dir, prefix='.runtimes-', delete=False) as stream:
        temporary = pathlib.Path(stream.name)
        try:
            json.dump({'version': 1, 'runtimes': entries}, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def launch(plan, home, endpoint, data_dir):
    if not plan['static_candidate_found']:
        raise ValueError('Installed application does not match the inspected transport candidate')
    executable = pathlib.Path(plan['candidate_executable'])
    if running(executable):
        raise ValueError('Desktop is already open. Finish current work and quit it before using shared startup; no process was stopped.')
    uri = socket_url(endpoint)
    check_engine(endpoint)
    # Register first, so AnyWork can find the engine as soon as the desktop opens.
    register(data_dir, home, endpoint)
    log_path = data_dir / 'desktop-launch.log'
    descriptor = os.open(log_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, 'ab', buffering=0) as log:
        process = subprocess.Popen([str(executable)], env=launch_environment(home, uri),
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   start_new_session=True)
    return {'launched': True, 'pid': process.pid, 'socket': str(endpoint),
            'desktop_runtime_verified': False,
            'note': 'Startup requested; verify desktop tools, approvals and the same thread in both UIs.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['plan', 'launch'], nargs='?', default='plan')
    parser.add_argument('--app', type=pathlib.Path, default=pathlib.Path('/Applications/ChatGPT.app'))
    parser.add_argument('--codex-home', type=pathlib.Path,
                        default=pathlib.Path(os.environ.get('CODEX_HOME', pathlib.Path.home() / '.codex')))
    parser.add_argument('--socket', type=pathlib.Path)
    parser.add_argument('--data-dir', type=pathlib.Path, default=HERE.parent / '.anywork')
    args = parser.parse_args()
    home = args.codex_home.expanduser().resolve()
    endpoint = args.socket.expanduser().absolute() if args.socket else home / 'app-server-control/app-server-control.sock'
    plan = planner.inspect(args.app.expanduser().resolve(), home)
    if args.operation == 'launch':
        result = launch(plan, home, endpoint, args.data_dir.expanduser().resolve())
    else:
        result = {**plan, 'selected_socket': str(endpoint), 'desktop_running': running(plan['candidate_executable']),
                  'launch_requested': False}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(str(error))
