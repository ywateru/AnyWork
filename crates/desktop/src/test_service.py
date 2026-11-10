"""Disposable Native test service. No Agent integrations or user data access."""
import argparse
import json
import os
import pathlib
import socket
import sys
import threading
from socketserver import TCPServer
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--bind')
parser.add_argument('--data-dir')
parser.add_argument('--workspace')
parser.add_argument('--fixture-root', required=True)
parser.add_argument('--fixture-mode', required=True,
                    choices=['normal', 'startup-error', 'bind-conflict', 'unauthorized', 'dns-forbidden'])
args, _ = parser.parse_known_args()
root = pathlib.Path(args.fixture_root)
state = {'stage': 'starting', 'infoRequests': 0, 'authorizedInfoRequests': 0,
         'unauthorizedInfoRequests': 0, 'ticketRequests': 0}
lock = threading.RLock()


def record(**fields):
    with lock:
        state.update(fields)
        temporary = root / 'service-status.tmp'
        temporary.write_text(json.dumps(state))
        os.replace(temporary, root / 'service-status.json')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        valid = (self.path == '/api/health' or
                 (args.fixture_mode != 'unauthorized' and
                  self.headers.get('Authorization') == 'Bearer ' +
                  (pathlib.Path(args.data_dir) / 'access-token').read_text().strip()))
        if self.path == '/api/health':
            body, status = {'status': 'ok'}, 200
        elif self.path == '/api/info':
            with lock:
                state['infoRequests'] += 1
                state['authorizedInfoRequests' if valid else 'unauthorizedInfoRequests'] += 1
                record()
            body = {'product': 'AnyWork', 'hostname': 'fixture',
                    'workspace': args.workspace, 'local_browser_session': True} if valid else {}
            status = 200 if valid else 401
        else:
            body, status = ({'clients': []}, 200) if valid else ({}, 401)
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        with lock:
            state['ticketRequests'] += 1
            record()
        (pathlib.Path(args.data_dir) / 'unexpected-ticket').write_text('issued')
        self.send_response(500)
        self.end_headers()


class FixtureServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer otherwise calls getfqdn after bind, before listen. This
        # loopback fixture needs no resolved hostname; retain real TCP/reuse
        # behavior and the inherited ThreadingHTTPServer request lifecycle.
        TCPServer.server_bind(self)
        self.server_name = 'fixture'
        self.server_port = self.server_address[1]


def forbidden_dns(host):
    raise AssertionError('NATIVE_FIXTURE_DNS_FORBIDDEN')


record()
try:
    if args.fixture_mode == 'startup-error':
        record(stage='startup-error', exitCode=73)
        print('NATIVE_FIXTURE_STARTUP_ERROR', file=sys.stderr, flush=True)
        sys.exit(73)
    host, port = args.bind.rsplit(':', 1)
    collision = None
    if args.fixture_mode == 'bind-conflict':
        collision = socket.socket()
        collision.bind((host, int(port)))
        collision.listen()
    if args.fixture_mode == 'dns-forbidden':
        socket.getfqdn = forbidden_dns
    server = FixtureServer((host, int(port)), Handler)
    record(stage='ready')
    server.serve_forever()
except OSError as error:
    record(stage='bind-error', errorClass=type(error).__name__, errno=error.errno, exitCode=74)
    print('NATIVE_FIXTURE_BIND_ERROR', file=sys.stderr, flush=True)
    sys.exit(74)
