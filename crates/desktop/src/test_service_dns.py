"""Deterministically expose HTTPServer's bind-then-resolve dependency. No DNS IO."""
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer

bound = threading.Event()
resolving = threading.Event()
release = threading.Event()
constructed = threading.Event()
servers = []
errors = []
original_bind = TCPServer.server_bind


def observed_bind(server):
    original_bind(server)
    bound.set()


def blocked_resolver(host):
    assert host == '127.0.0.1'
    assert bound.is_set()
    resolving.set()
    release.wait()
    return 'fixture'


def construct():
    try:
        servers.append(ThreadingHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler))
        constructed.set()
    except BaseException as error:
        errors.append(type(error).__name__)


TCPServer.server_bind = observed_bind
socket.getfqdn = blocked_resolver
worker = threading.Thread(target=construct, daemon=True)
worker.start()
try:
    assert resolving.wait(2), 'stdlib did not reach the controlled resolver'
    assert bound.is_set()
    assert not constructed.is_set(), 'constructor returned before resolver release'
finally:
    release.set()
    worker.join(2)
    for server in servers:
        server.server_close()
assert not worker.is_alive()
assert not errors
assert constructed.is_set()
print('STDLIB_BOUND_WAITING_FOR_DNS')
