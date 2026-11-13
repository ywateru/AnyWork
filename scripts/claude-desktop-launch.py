#!/usr/bin/env python3
"""Claude Desktop's user-installed DevTools bridge (no CDP startup required).

Run this tool, review bridge-snippet.js, then run its contents once in the
normal Claude Code renderer's DevTools console. It neither starts/stops Claude
nor changes developer/organization settings. Tokens stay in private files and
WebSocket/HTTP message headers/bodies, never URLs or diagnostic output.
"""
import argparse
import base64
import hashlib
import hmac
import http.server
import json
import os
import pathlib
import plistlib
import secrets
import signal
import socket
import stat
import struct
import sys
import tempfile
import threading
import time
import uuid

ORIGINS = {'https://claude.ai', 'https://claude.com', 'app://localhost'}
MAX_MESSAGE = 32 * 1024 * 1024
REVIEWED = {'5.11492.0', '5.11492.2'}


class SetupError(Exception):
    pass


def no_symlinks(path):
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
        raise SetupError('Use an owner-only directory with mode 0700')
    return path


def read_regular(path, limit=65536):
    path = no_symlinks(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SetupError('Invalid desktop setup file')
        return file.read(limit + 1)


def bundle_info(app):
    app = no_symlinks(app)
    info = plistlib.loads(read_regular(app / 'Contents/Info.plist'))
    if info.get('CFBundleIdentifier') != 'com.anthropic.claudefordesktop' or info.get('CFBundleExecutable') != 'Claude':
        raise SetupError('Unexpected Claude application identity')
    version = info.get('CFBundleShortVersionString')
    if version not in REVIEWED:
        raise SetupError('Unreviewed Claude version; review the preload contract before use')
    asar = no_symlinks(app / 'Contents/Resources/app.asar')
    if not stat.S_ISREG(asar.lstat().st_mode):
        raise SetupError('Expected the original Claude ASAR')
    digest = hashlib.sha256()
    with asar.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return {'appPath': str(app), 'appVersion': version, 'asarSha256': digest.hexdigest()}


def publish_bytes(path, payload):
    parent = private_dir(path.parent)
    no_symlinks(path)
    fd, temporary = tempfile.mkstemp(prefix='.bridge-', dir=parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            os.fchmod(file.fileno(), 0o600)
            file.write(payload)
            file.flush()
            os.fsync(file.fileno())
        os.link(temporary, path, follow_symlinks=False)
        info = path.lstat()
        return info.st_dev, info.st_ino
    except FileExistsError as error:
        raise SetupError('Setup file already exists; stop its owner or choose another private directory') from error
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def publish(path, value):
    return publish_bytes(path, (json.dumps(value, separators=(',', ':')) + '\n').encode())


def cleanup(path, identity):
    try:
        info = path.lstat()
        if (info.st_dev, info.st_ino) == identity and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600:
            path.unlink()
    except OSError:
        pass


def snippet(port, token, source):
    # Source is shipped beside this launcher, never fetched from a network.
    # The token is sent only as a first-frame secret, not a URL subprotocol.
    return """/* Review this fixed local bridge before running in Claude Code DevTools.
Disconnect: globalThis[Symbol.for('anywork.claude.desktop.outgoing.v1')]?.close()
No account APIs, filesystem APIs, native process replacement or auto approvals. */
(() => {
'use strict';
const origin = location.origin;
if (!['https://claude.ai','https://claude.com','app://localhost'].includes(origin)) throw Error('Select the Claude Code renderer context');
if (!globalThis['claude.web']?.LocalSessions) throw Error('Claude Code preload unavailable in this context');
const key = Symbol.for('anywork.claude.desktop.outgoing.v1');
if (globalThis[key]) throw Error('A local bridge is already installed; disconnect it explicitly');
const dispatch = (SOURCE);
const ws = new WebSocket('ws://127.0.0.1:PORT/native');
let timer, chain = Promise.resolve(), closed = false;
const ids = new Set();
const close = () => { if (closed) return; closed = true; clearInterval(timer); ws.close(); for (const id of ids) dispatch({op:'close',id}); ids.clear(); delete globalThis[key]; };
globalThis[key] = {close};
ws.onopen = () => { ws.send(JSON.stringify({token:TOKEN,protocol:1})); timer = setInterval(() => { if (ws.readyState === 1) ws.send('{"heartbeat":true}'); }, 20000); };
ws.onmessage = event => { chain = chain.then(async () => {
 let req; try { req = JSON.parse(event.data); } catch { close(); return; }
 if (!req || typeof req.requestId !== 'string' || !req.command || typeof req.command !== 'object') { close(); return; }
 let result = await dispatch(req.command);
 if (req.command.op === 'open' && result.ok) ids.add(req.command.id);
 if (req.command.op === 'close') ids.delete(req.command.id);
 if (ws.readyState === 1) ws.send(JSON.stringify({requestId:req.requestId,result}));
}).catch(close); };
ws.onclose = close; ws.onerror = close;
return 'Local bridge installed; status is reported by the local connection tool';
})()
""".replace('SOURCE', source).replace('PORT', str(port)).replace('TOKEN', json.dumps(token))


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        part = stream.read(size - len(data))
        if not part:
            raise ConnectionError('Bridge disconnected')
        data.extend(part)
    return bytes(data)


def _read_frame(stream):
    a, b = read_exact(stream, 2)
    opcode, size = a & 15, b & 127
    if a & 0x70 or not b & 0x80:
        raise SetupError('Expected a masked WebSocket frame')
    if size == 126:
        size = struct.unpack('!H', read_exact(stream, 2))[0]
    elif size == 127:
        size = struct.unpack('!Q', read_exact(stream, 8))[0]
    if size > MAX_MESSAGE or opcode not in (0, 1, 8, 9, 10) or (opcode >= 8 and (size > 125 or not a & 0x80)):
        raise SetupError('Unsupported bridge frame')
    mask = read_exact(stream, 4)
    data = read_exact(stream, size)
    return opcode, bytes(v ^ mask[i % 4] for i, v in enumerate(data)), bool(a & 0x80)


def receive_frame(stream):
    opcode, data, final = _read_frame(stream)
    if not final or opcode == 0:
        raise SetupError('Expected one complete frame')
    return opcode, data


def receive_message(stream, pong):
    parts, size, started = [], 0, False
    while True:
        opcode, data, final = _read_frame(stream)
        if opcode == 8:
            return opcode, data
        if opcode == 9:
            pong(data)
            continue
        if opcode == 10:
            continue
        if (opcode == 1 and started) or (opcode == 0 and not started):
            raise SetupError('Invalid fragmented bridge message')
        started = True
        size += len(data)
        if size > MAX_MESSAGE:
            raise SetupError('Bridge message exceeds limit')
        parts.append(data)
        if final:
            return 1, b''.join(parts)


def send_frame(connection, data, opcode=1):
    size = len(data)
    if size > MAX_MESSAGE:
        raise SetupError('Bridge reply exceeds limit')
    header = bytes([0x80 | opcode])
    header += bytes([size]) if size < 126 else b'\x7e' + struct.pack('!H', size) if size < 65536 else b'\x7f' + struct.pack('!Q', size)
    connection.sendall(header + data)


class Broker:
    def __init__(self):
        self.native_token = secrets.token_urlsafe(32)
        self.client_token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.send_lock = threading.Lock()
        self.peer = None
        self.claimed = False
        self.pending = {}
        self.ready = threading.Event()

    def detach(self, peer):
        with self.lock:
            if self.peer is not peer:
                return
            self.peer = None
            for event, box in self.pending.values():
                box.append({'ok': False, 'error': 'Native bridge disconnected; delivery outcome unknown; do not replay'})
                event.set()
            self.pending.clear()
        try:
            peer.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def rpc(self, command):
        if not isinstance(command, dict) or command.get('op') not in ('open', 'invoke', 'poll', 'close'):
            return {'ok': False, 'error': 'Unsupported bridge operation'}
        request = str(uuid.uuid4())
        event, box = threading.Event(), []
        with self.lock:
            peer = self.peer
            if peer is None or len(self.pending) >= 16:
                return {'ok': False, 'error': 'Native bridge unavailable or busy'}
            self.pending[request] = event, box
        try:
            data = json.dumps({'requestId': request, 'command': command}, separators=(',', ':')).encode()
            with self.send_lock:
                send_frame(peer, data)
            if not event.wait(55):
                self.detach(peer)
                return {'ok': False, 'error': 'Native call timed out; delivery outcome unknown; do not replay'}
            return box[0]
        except (OSError, SetupError):
            self.detach(peer)
            return {'ok': False, 'error': 'Native bridge failed; delivery outcome unknown; do not replay'}
        finally:
            with self.lock:
                self.pending.pop(request, None)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass  # Never log headers, URLs, bodies, tokens, prompts or native output.

    def valid_host(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

    def reply(self, status, value):
        data = json.dumps(value, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def do_POST(self):
        self.connection.settimeout(5)
        broker = self.server.broker
        auth = self.headers.get('Authorization', '')
        if (not self.valid_host() or self.path != '/rpc' or self.headers.get('Origin') is not None or
                not hmac.compare_digest(auth, 'Bearer ' + broker.client_token)):
            self.reply(403, {'ok': False, 'error': 'Bridge request rejected'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_MESSAGE or self.headers.get('Transfer-Encoding'):
                raise ValueError()
            command = json.loads(read_exact(self.rfile, length))
            result = broker.rpc(command)
            self.reply(200, result)
        except (ValueError, OSError, ConnectionError):
            self.reply(400, {'ok': False, 'error': 'Invalid bridge request'})

    def pong(self, data):
        with self.server.broker.send_lock:
            send_frame(self.connection, data, 10)

    def do_GET(self):
        self.connection.settimeout(5)
        if (not self.valid_host() or self.path != '/native' or self.headers.get('Origin') not in ORIGINS or
                self.headers.get('Upgrade', '').lower() != 'websocket' or
                'upgrade' not in self.headers.get('Connection', '').lower() or self.headers.get('Sec-WebSocket-Version') != '13'):
            self.reply(403, {'ok': False, 'error': 'Native bridge request rejected'})
            return
        try:
            key = self.headers.get('Sec-WebSocket-Key', '')
            if len(base64.b64decode(key, validate=True)) != 16:
                raise ValueError()
        except ValueError:
            self.reply(400, {'ok': False, 'error': 'Invalid upgrade'})
            return
        self.send_response(101)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode())
        self.end_headers()
        broker, peer = self.server.broker, self.connection
        attached = False
        try:
            opcode, raw = receive_message(self.rfile, self.pong)
            auth = json.loads(raw) if opcode == 1 and len(raw) < 1024 else {}
            if not isinstance(auth, dict):
                return
            with broker.lock:
                if (broker.claimed or auth.get('protocol') != 1 or not isinstance(auth.get('token'), str) or
                        not hmac.compare_digest(auth['token'], broker.native_token)):
                    return
                broker.claimed = True
                broker.native_token = ''  # One attachment; explicit new setup after reload.
                broker.peer = peer
                attached = True
            broker.ready.set()
            self.connection.settimeout(65)
            while True:
                opcode, raw = receive_message(self.rfile, self.pong)
                if opcode == 8:
                    break
                if opcode == 9:
                    with broker.send_lock:
                        send_frame(peer, raw, 10)
                    continue
                if opcode == 10:
                    continue
                value = json.loads(raw)
                if not isinstance(value, dict):
                    break
                if value == {'heartbeat': True}:
                    continue
                request, result = value.get('requestId'), value.get('result')
                if not isinstance(request, str) or not isinstance(result, dict):
                    break
                with broker.lock:
                    pending = broker.pending.pop(request, None)
                    if pending:
                        pending[1].append(result)
                        pending[0].set()
        except (OSError, ValueError, ConnectionError, SetupError):
            pass
        finally:
            if attached:
                broker.detach(peer)
            self.close_connection = True


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = 16

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)

    def verify_request(self, *_args):
        return self.slots.acquire(blocking=False)

    def process_request_thread(self, *args):
        try:
            super().process_request_thread(*args)
        finally:
            self.slots.release()

    def handle_error(self, *_args):
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=pathlib.Path, default=pathlib.Path('/Applications/Claude.app'))
    parser.add_argument('--descriptor', type=pathlib.Path, default=pathlib.Path(os.environ.get('ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR', str(pathlib.Path.home() / '.anywork/claude-desktop/host.json'))))
    args = parser.parse_args(argv)
    identities = []
    server = None
    stop = threading.Event()
    try:
        identity = bundle_info(args.app)
        path = no_symlinks(args.descriptor)
        private_dir(path.parent)
        if path.exists():
            raise SetupError('Descriptor exists; stop its owner or use another private directory')
        source = read_regular(pathlib.Path(__file__).absolute().with_name('claude-desktop-carrier.js'), 100000).decode()
        server = Server(('127.0.0.1', 0), Handler)
        server.broker = Broker()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        port = server.server_port
        script = path.with_name('bridge-snippet.js')
        identities.append((script, publish_bytes(script, snippet(port, server.broker.native_token, source).encode())))
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stop.set())
        print(f'Review the private snippet: {script}', flush=True)
        print('Run it once in the normal Claude Code renderer DevTools console. No settings or app lifecycle are changed.', flush=True)
        while not stop.wait(.2):
            if server.broker.ready.is_set():
                break
        if stop.is_set():
            return 0
        # Genuine native calls are required before advertising readiness.
        probe = str(uuid.uuid4())
        result = server.broker.rpc({'op': 'open', 'id': probe})
        if result.get('ok') is not True:
            raise SetupError('Native preload/subscribe handshake failed; no descriptor published')
        native_list = server.broker.rpc({'op': 'invoke', 'id': probe, 'method': 'getSessionList', 'args': []})
        server.broker.rpc({'op': 'close', 'id': probe})
        if native_list.get('ok') is not True or not isinstance(native_list.get('value', {}).get('sessions'), list):
            raise SetupError('Native list handshake failed (login/policy/context may prevent it); no descriptor published')
        descriptor = {'version': 1, 'agent': 'claude-desktop', 'transport': 'devtools-loopback', 'url': f'http://127.0.0.1:{port}/', 'token': server.broker.client_token, 'instanceId': str(uuid.uuid4()), 'launcherPid': os.getpid(), **identity}
        identities.append((path, publish(path, descriptor)))
        print(f'Native preload, event subscriptions and session-list handshake succeeded. Private descriptor: {path}', flush=True)
        print('Ctrl-C disconnects this bridge only; native sessions remain owned by Claude.', flush=True)
        while not stop.wait(.5):
            with server.broker.lock:
                if server.broker.peer is None:
                    raise SetupError('Native renderer disconnected; run a fresh reviewed snippet to reconnect')
        return 0
    except (SetupError, OSError, ValueError) as error:
        print('Claude Desktop bridge: ' + (str(error) if isinstance(error, SetupError) else 'Local setup failed'), file=sys.stderr)
        return 1
    finally:
        if server:
            with server.broker.lock:
                peer = server.broker.peer
            if peer:
                server.broker.detach(peer)
            server.shutdown()
            server.server_close()
        for path, identity in reversed(identities):
            cleanup(path, identity)


if __name__ == '__main__':
    sys.exit(main())
