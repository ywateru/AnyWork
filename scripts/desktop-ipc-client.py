#!/usr/bin/env python3
"""Candidate desktop-host IPC transport, reconstructed from static evidence.

This is an explicit-endpoint protocol client, not a production AnyWork backend.
It never launches a router or engine, scans sockets, resumes a thread, or retries
a mutation. The command-line entry point only discovers an owner and reads its
snapshot. Read-only original-desktop attachment and a single steer through the
Rust HTTP adapter passed on 2026-11-05; see docs/desktop-host-tests.md for scope.
"""
import argparse
import asyncio
import copy
import json
import os
import pathlib
import stat
import struct
import uuid

MAX_FRAME = 0x10000000
VERSIONS = {
    'initialize': 0,
    'thread-owner-discovery': 1,
    'thread-follower-start-turn': 2,
    'thread-follower-steer-turn': 1,
    'thread-follower-interrupt-turn': 4,
    'thread-follower-update-thread-settings': 2,
    'thread-follower-read-model-settings': 1,
    'thread-follower-command-approval-decision': 1,
    'thread-follower-file-approval-decision': 1,
    'thread-follower-permissions-request-approval-response': 1,
    'thread-follower-submit-user-input': 1,
    'thread-follower-submit-mcp-server-elicitation-response': 1,
    'thread-follower-load-complete-history': 1,
}


class ProtocolError(Exception):
    pass


class DeliveryUnknown(ProtocolError):
    """A dispatched request lost its reply; it must not be blindly replayed."""


class RemoteError(ProtocolError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def frame(message):
    payload = json.dumps(message, ensure_ascii=False, separators=(',', ':'),
                         allow_nan=False).encode('utf-8')
    if not 0 < len(payload) <= MAX_FRAME:
        raise ProtocolError('invalid-frame-length')
    return struct.pack('<I', len(payload)) + payload


async def read_frame(reader):
    length, = struct.unpack('<I', await reader.readexactly(4))
    if not 0 < length <= MAX_FRAME:
        raise ProtocolError('invalid-frame-length')
    try:
        message = json.loads((await reader.readexactly(length)).decode('utf-8'),
                             parse_constant=lambda value: (_ for _ in ()).throw(
                                 ValueError('non-finite-json')))
    except (UnicodeError, ValueError) as error:
        raise ProtocolError('invalid-json') from error
    if not isinstance(message, dict):
        raise ProtocolError('invalid-envelope')
    return message


def validate_socket(path):
    """Check an existing endpoint; never chmod, create, unlink or follow symlinks."""
    path = pathlib.Path(path)
    if not path.is_absolute():
        raise ProtocolError('socket-path-must-be-absolute')
    metadata, directory = path.lstat(), path.parent.lstat()
    if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise ProtocolError('socket-not-owned-by-current-user')
    if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid()
            or directory.st_mode & 0o022 or metadata.st_mode & 0o077):
        raise ProtocolError('unsafe-socket-permissions')
    return path


class Client:
    def __init__(self, reader, writer, timeout=10):
        self.reader, self.writer, self.timeout = reader, writer, timeout
        self.client_id = None
        self.pending = {}
        self.broadcasts = asyncio.Queue(maxsize=64)
        self.write_lock = asyncio.Lock()
        self.closed = False
        self.failure = None
        self.reader_task = asyncio.create_task(self._receive())

    @classmethod
    async def connect(cls, socket_path, timeout=10):
        path = validate_socket(socket_path)
        reader, writer = await asyncio.wait_for(
            asyncio.open_unix_connection(str(path)), timeout)
        client = cls(reader, writer, timeout)
        try:
            result = await client.request('initialize', {'clientType': 'desktop'})
            assigned = result.get('result', {}).get('clientId')
            if not isinstance(assigned, str) or not assigned:
                raise ProtocolError('invalid-initialize-client-id')
            client.client_id = assigned
            return client
        except BaseException:
            await client.close()
            raise

    async def _write(self, message):
        encoded = frame(message)
        async with self.write_lock:
            if self.closed:
                raise ProtocolError('connection-closed')
            self.writer.write(encoded)
            await self.writer.drain()

    async def request(self, method, params, target=None):
        if method not in VERSIONS:
            raise ProtocolError('unsupported-method')
        if method != 'initialize' and not self.client_id:
            raise ProtocolError('not-initialized')
        version = VERSIONS[method]
        if method == 'thread-follower-interrupt-turn' and params.get('expectedTurnId') is None:
            version = 3
        rid = str(uuid.uuid4())
        message = {'type': 'request', 'requestId': rid, 'method': method,
                   'version': version, 'params': copy.deepcopy(params),
                   'timeoutMs': int(self.timeout * 1000)}
        if self.client_id:
            message['sourceClientId'] = self.client_id
        if target is not None:
            message['targetClientId'] = target
        # Local requests intentionally OMIT top-level hostId (version depends on it).
        future = asyncio.get_running_loop().create_future()
        self.pending[rid] = future
        dispatched = False
        try:
            dispatched = True  # Even a failed drain cannot establish non-delivery.
            await self._write(message)
            reply = await asyncio.wait_for(asyncio.shield(future), self.timeout)
            if reply.get('resultType') == 'error':
                code = reply.get('error', 'remote-error')
                if code in {'request-timeout', 'client-disconnected', 'server-closed'}:
                    raise DeliveryUnknown(code)
                raise RemoteError(code)
            if reply.get('resultType') != 'success' or reply.get('method') != method:
                raise DeliveryUnknown('invalid-operation-response')
            if target is not None and reply.get('handledByClientId') != target:
                raise DeliveryUnknown('unexpected-owner-response')
            return reply
        except (asyncio.TimeoutError, ConnectionError, asyncio.IncompleteReadError) as error:
            raise DeliveryUnknown('request-outcome-unknown') from error
        except ProtocolError as error:
            if dispatched and str(error) == 'connection-closed':
                raise DeliveryUnknown('connection-closed-after-dispatch') from error
            raise
        finally:
            self.pending.pop(rid, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()  # Consume a simultaneous close error.

    async def _receive(self):
        try:
            while not self.closed:
                message = await read_frame(self.reader)
                kind = message.get('type')
                if kind == 'response':
                    future = self.pending.get(message.get('requestId'))
                    if future and not future.done():
                        future.set_result(message)
                elif kind == 'broadcast':
                    targets = message.get('targetClientIds')
                    if targets is None or self.client_id in targets:
                        self.broadcasts.put_nowait(message)
                elif kind == 'client-discovery-request':
                    # A follower must never advertise itself as a thread owner.
                    await self._write({'type': 'client-discovery-response',
                                       'requestId': message['requestId'],
                                       'response': {'canHandle': False}})
                elif kind == 'request':
                    await self._write({'type': 'response', 'requestId': message['requestId'],
                                       'resultType': 'error', 'error': 'no-handler-for-request'})
        except asyncio.CancelledError:
            pass
        except Exception as error:
            self.failure = error
        finally:
            self.closed = True
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(DeliveryUnknown('connection-closed-after-dispatch'))
            self.writer.close()

    async def next_broadcast(self):
        if self.closed and self.broadcasts.empty():
            raise ProtocolError('connection-closed') from self.failure
        message_task = asyncio.create_task(self.broadcasts.get())
        try:
            done, _ = await asyncio.wait(
                {message_task, self.reader_task}, timeout=self.timeout,
                return_when=asyncio.FIRST_COMPLETED)
            if message_task in done:
                return message_task.result()
            if self.reader_task in done:
                raise ProtocolError('connection-closed') from self.failure
            raise ProtocolError('snapshot-timeout')
        finally:
            if not message_task.done():
                message_task.cancel()
                await asyncio.gather(message_task, return_exceptions=True)

    async def owner(self, conversation_id):
        reply = await self.request('thread-owner-discovery', {
            'conversationId': conversation_id, 'hostId': 'local'})
        owner = reply.get('handledByClientId')
        if not isinstance(owner, str) or not owner or owner == self.client_id:
            raise ProtocolError('invalid-owner-identity')
        return Owner(self, conversation_id, owner,
                     reply.get('result', {}).get('supportsUntrustedAppInput') is True)

    async def close(self):
        if not self.closed:
            self.closed = True
            self.writer.close()
        if not self.reader_task.done():
            self.reader_task.cancel()
        await asyncio.gather(self.reader_task, return_exceptions=True)
        try:
            await self.writer.wait_closed()
        except ConnectionError:
            pass


class Owner:
    """Owner/thread identity is bound to one connection; never reuse on reconnect."""
    def __init__(self, client, conversation_id, owner_id, supports_app_input):
        self.client, self.conversation_id, self.id = client, conversation_id, owner_id
        self.supports_app_input = supports_app_input
        self.revision, self.state = None, None

    async def request(self, method, params):
        if not method.startswith('thread-follower-'):
            raise ProtocolError('owner-operation-required')
        if 'conversationId' in params and params['conversationId'] != self.conversation_id:
            raise ProtocolError('conversation-identity-mismatch')
        reply = await self.client.request(method, {
            **params, 'conversationId': self.conversation_id}, target=self.id)
        return reply.get('result')

    async def follow(self, following=True):
        await self.client._write({
            'type': 'broadcast', 'method': 'thread-stream-following-changed',
            'version': 1, 'sourceClientId': self.client.client_id,
            'targetClientIds': [self.id], 'params': {
                'conversationId': self.conversation_id, 'hostId': 'local',
                'following': following}})

    async def snapshot(self):
        await self.follow()
        deadline = asyncio.get_running_loop().time() + self.client.timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise ProtocolError('snapshot-timeout')
            message = await asyncio.wait_for(self.client.next_broadcast(), remaining)
            if message.get('sourceClientId') != self.id:
                continue
            params = message.get('params', {})
            if params.get('conversationId') != self.conversation_id or params.get('hostId') != 'local':
                continue
            if message.get('method') != 'thread-stream-state-changed':
                continue
            if message.get('version') != 11:
                raise ProtocolError('unsupported-stream-version')
            change = params.get('change', {})
            # This prototype consumes complete snapshots only. It deliberately
            # does not apply partial patches/acceptedTextChanges to a native shape.
            if change.get('type') != 'snapshot':
                continue
            if not isinstance(change.get('conversationState'), dict):
                raise ProtocolError('invalid-conversation-snapshot')
            revision = change.get('revision')
            if type(revision) is not int or revision < 0:
                raise ProtocolError('invalid-snapshot-revision')
            self.revision, self.state = revision, copy.deepcopy(change['conversationState'])
            return copy.deepcopy(self.state)


async def inspect(args):
    client = await Client.connect(args.socket)
    try:
        owner = await client.owner(args.thread)
        state = await owner.snapshot()
        # Do not print private conversation content or pending request payloads.
        print(json.dumps({'owner_discovered': True, 'snapshot_received': True,
                          'revision': owner.revision, 'state_field_count': len(state),
                          'runtime_compatibility_verified': False,
                          'anywork_production_adapter': False}))
        await owner.follow(False)
    finally:
        await client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--socket', required=True, help='Explicit existing local IPC socket')
    parser.add_argument('--thread', required=True, help='Explicit fixture conversation ID')
    asyncio.run(inspect(parser.parse_args()))
