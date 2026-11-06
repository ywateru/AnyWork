#!/usr/bin/env python3
"""Read-only desktop bridge candidate plan. Never launches or attaches to an app."""
import argparse
import hashlib
import json
import os
import pathlib
import plistlib
import stat
import struct


def members(archive):
    with archive.open('rb') as stream:
        prefix = stream.read(16)
        if len(prefix) != 16:
            raise ValueError('Invalid ASAR header')
        _, header_size, _, json_size = struct.unpack('<IIII', prefix)
        if json_size > 64 * 1024 * 1024 or header_size < json_size:
            raise ValueError('Invalid ASAR header sizes')
        tree = json.loads(stream.read(json_size))
        base = 8 + header_size

        def visit(node, parent=''):
            for name, item in node.get('files', {}).items():
                path = parent + name
                if 'files' in item:
                    yield from visit(item, path + '/')
                else:
                    yield path, item

        for name, item in visit(tree):
            if not (name == 'package.json' or name.startswith('.vite/build/') and name.endswith('.js')):
                continue
            if item.get('unpacked') or 'link' in item:
                continue
            size, offset = item.get('size', 0), int(item.get('offset', -1))
            if not 0 <= size <= 16 * 1024 * 1024 or offset < 0:
                raise ValueError('Unsupported ASAR member size or offset')
            stream.seek(base + offset)
            content = stream.read(size)
            if len(content) != size:
                raise ValueError('Truncated ASAR member')
            yield name, content


def inspect(app, home):
    contents = app / 'Contents'
    archive = contents / 'Resources/app.asar'
    info = plistlib.loads((contents / 'Info.plist').read_bytes())
    findings, package = {}, {}
    for name, content in members(archive):
        if name == 'package.json':
            package = json.loads(content)
            continue
        source = content.decode('utf-8')
        rules = {
            'websocket_environment_override': 'CODEX_APP_SERVER_WS_URL' in source,
            'local_daemon_conditional': 'CODEX_APP_SERVER_USE_LOCAL_DAEMON' in source,
            'unix_websocket_client': 'ws+unix:' in source and 'socketPath' in source,
            'desktop_tools_configuration': 'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=' in source,
            'loopback_proxy_bypass': all(text in source for text in [
                'new URL(t).hostname', '"localhost"!==r', '"127.0.0.1"!==r']),
        }
        matched = [rule for rule, present in rules.items() if present]
        if matched:
            findings[name] = {'sha256': hashlib.sha256(content).hexdigest(),
                              'observed_literals': matched}
    flags = {item for value in findings.values() for item in value['observed_literals']}
    endpoint = home / 'app-server-control/app-server-control.sock'
    try:
        metadata = endpoint.lstat()
        socket_info = dict(exists=True, is_socket=stat.S_ISSOCK(metadata.st_mode),
                           is_symlink=stat.S_ISLNK(metadata.st_mode),
                           owned_by_current_user=metadata.st_uid == os.getuid(),
                           mode=oct(stat.S_IMODE(metadata.st_mode)))
        if stat.S_ISLNK(metadata.st_mode):
            socket_info['is_socket'] = None
            try:
                target = endpoint.stat()
                socket_info.update(is_socket=stat.S_ISSOCK(target.st_mode),
                                   target_owned_by_current_user=target.st_uid == os.getuid(),
                                   target_mode=oct(stat.S_IMODE(target.st_mode)))
            except OSError as error:
                socket_info.update(target_metadata_error=type(error).__name__,
                                   target_metadata_errno=error.errno)
    except FileNotFoundError:
        socket_info = {'exists': False}
    except OSError as error:
        socket_info = {'exists': None, 'metadata_error': type(error).__name__,
                       'errno': error.errno}
    raw_path = str(endpoint)
    # The shipped ws client splits the URL pathname on ':'. Percent-encoded
    # paths are not assumed to be decoded into Unix filesystem paths.
    path_compatible = not any(char in raw_path for char in ' :?#%\r\n\t')
    uri = 'ws+unix://localhost' + raw_path + ':/rpc' if path_compatible else None
    static_candidate = {'websocket_environment_override', 'unix_websocket_client',
                        'loopback_proxy_bypass'}.issubset(flags) and path_compatible
    executable = contents / 'MacOS' / info['CFBundleExecutable']
    digest = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return {
        'operation': 'read_only_candidate_plan',
        'application_version': info.get('CFBundleShortVersionString'),
        'application_build': info.get('CFBundleVersion'),
        'application_package_version': package.get('version'),
        'asar_sha256': digest.hexdigest(),
        'static_candidate_found': static_candidate,
        'control_socket': {'path': raw_path, **socket_info},
        'candidate_environment': {'CODEX_HOME': str(home), 'CODEX_APP_SERVER_WS_URL': uri},
        'conflicting_environment_if_inherited': [name for name in [
            'CODEX_APP_SERVER_FORCE_CLI', 'CODEX_CLI_PATH', 'CODEX_APP_SERVER_WS_URL']
            if os.environ.get(name)],
        'candidate_executable': str(executable),
        'observations': findings,
        'limitations': [
            'Literal presence and independent transport tests do not prove the desktop runtime takes this route.',
            'An already-running stdio process is not converted by changing environment variables.',
            'The daemon must be the intended owner and use compatible desktop tools and permissions.',
            'The simple local-daemon flag also requires empty configuration overrides; do not assume it is sufficient.',
            'No app process was started, attached, injected, stopped, or reconfigured by this tool.',
        ],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=pathlib.Path, default=pathlib.Path('/Applications/ChatGPT.app'))
    parser.add_argument('--codex-home', type=pathlib.Path,
                        default=pathlib.Path(os.environ.get('CODEX_HOME', pathlib.Path.home() / '.codex')))
    args = parser.parse_args()
    print(json.dumps(inspect(args.app.resolve(), args.codex_home.expanduser().resolve()),
                     ensure_ascii=False, indent=2))
