#!/usr/bin/env python3
"""Verify the candidate IPC client only against a temporary host fixture.

No original application, real account, or private conversation is used. Passing
these checks establishes transport behavior, not desktop runtime compatibility.
"""
import asyncio
import importlib.util
import json
import os
import pathlib
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'desktop_ipc', pathlib.Path(__file__).with_name('desktop-ipc-client.py'))
ipc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ipc)


class DesktopIPC(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aw-ipc-', dir='/tmp')
        self.socket = pathlib.Path(self.temp.name) / 'host.sock'
        self.frames, self.writers, self.tasks = [], [], set()
        self.owner_id = 'existing-desktop-owner'
        self.hold = False
        self.disconnect = False
        self.wrong_owner = False
        self.reject = None
        self.stream_version = 11
        self.revision = 7
        self.mutations = 0
        self.state = {'id': 'fixture-thread', 'activeTurnId': 'original-turn',
                      'requests': [{'requestId': 17, 'type': 'fixture-approval'}],
                      'unknownFutureField': {'保留': ['完整', '状态']}}
        self.server = await asyncio.start_unix_server(self.accept, str(self.socket))
        self.socket.chmod(0o600)
        self.clients = []

    async def asyncTearDown(self):
        for client in self.clients:
            await client.close()
        self.server.close()
        await self.server.wait_closed()
        for writer in self.writers:
            writer.close()
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.temp.cleanup()

    def accept(self, reader, writer):
        task = asyncio.create_task(self.handle(reader, writer))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def send(self, writer, value):
        # Split a Unicode frame across arbitrary header and body boundaries.
        encoded = ipc.frame(value)
        for start, end in [(0, 1), (1, 3), (3, 7), (7, len(encoded))]:
            writer.write(encoded[start:end])
            await writer.drain()
            await asyncio.sleep(0)

    async def handle(self, reader, writer):
        self.writers.append(writer)
        client_id = 'follower-' + str(len(self.writers))
        try:
            while True:
                message = await ipc.read_frame(reader)
                self.frames.append(message)
                if message['type'] == 'broadcast':
                    if message['params'].get('following'):
                        # Different owner and different thread cannot satisfy subscribe.
                        for owner, thread in [('unrelated-owner', 'fixture-thread'),
                                              (self.owner_id, 'other-thread'),
                                              (self.owner_id, 'fixture-thread')]:
                            await self.send(writer, {
                                'type': 'broadcast', 'method': 'thread-stream-state-changed',
                                'sourceClientId': owner, 'version': self.stream_version,
                                'targetClientIds': [client_id], 'params': {
                                    'conversationId': thread, 'hostId': 'local',
                                    'change': {'type': 'snapshot', 'revision': self.revision,
                                               'conversationState': self.state}}})
                    continue
                if message['type'] != 'request':
                    continue
                method = message['method']
                if method == 'initialize':
                    result, handled = {'clientId': client_id}, client_id
                elif method == 'thread-owner-discovery':
                    result, handled = {'supportsUntrustedAppInput': True}, self.owner_id
                else:
                    handled = 'wrong-owner' if self.wrong_owner else self.owner_id
                    if method == 'thread-follower-read-model-settings':
                        result = {'settings': {'model': 'fixture-model', 'reasoningEffort': 'high'}}
                    else:
                        self.mutations += 1
                        result = {'ok': True}
                        if method == 'thread-follower-update-thread-settings':
                            result = {'applied': True}
                        if self.disconnect:
                            writer.close()
                            return
                        if self.hold:
                            continue
                reply = {'type': 'response', 'requestId': message['requestId'],
                         'resultType': 'success', 'method': method,
                         'handledByClientId': handled, 'result': result}
                if self.reject and method.startswith('thread-follower-'):
                    reply = {'type': 'response', 'requestId': message['requestId'],
                             'resultType': 'error', 'error': self.reject}
                await self.send(writer, reply)
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    async def connect(self, timeout=1):
        client = await ipc.Client.connect(self.socket, timeout=timeout)
        self.clients.append(client)
        return client

    async def test_initialize_discover_pin_owner_and_preserve_full_snapshot(self):
        client = await self.connect()
        owner = await client.owner('fixture-thread')
        self.assertEqual(owner.id, self.owner_id)
        self.assertTrue(owner.supports_app_input)
        self.assertEqual(await owner.snapshot(), self.state)
        self.assertEqual(owner.revision, 7)
        result = await owner.request('thread-follower-read-model-settings', {})
        self.assertEqual(result['settings']['reasoningEffort'], 'high')
        request = self.frames[-1]
        self.assertEqual(request['targetClientId'], self.owner_id)
        self.assertEqual(request['sourceClientId'], client.client_id)
        self.assertEqual(request['params'], {'conversationId': 'fixture-thread'})
        self.assertNotIn('hostId', request)
        self.assertEqual(self.frames[1]['params']['hostId'], 'local')
        self.assertEqual(self.mutations, 0)

    async def test_opaque_steer_and_original_approval_id_are_preserved(self):
        owner = await (await self.connect()).owner('fixture-thread')
        restore = {'id': 'original-message', 'cwd': '/fixture',
                   'context': {'workspaceRoots': ['/fixture']}, 'future': {'opaque': True}}
        params = {'input': [{'type': 'text', 'text': '继续处理'}],
                  'restoreMessage': restore, 'clientUserMessageId': 'message-unique'}
        await owner.request('thread-follower-steer-turn', params)
        self.assertEqual(self.frames[-1]['params'], {**params, 'conversationId': 'fixture-thread'})
        await owner.request('thread-follower-command-approval-decision', {
            'requestId': 17, 'decision': 'decline'})
        self.assertEqual(self.frames[-1]['params']['requestId'], 17)
        self.assertIsInstance(self.frames[-1]['requestId'], str)
        self.assertEqual(self.mutations, 2)

    async def test_wrong_thread_and_wrong_owner_response_fail_without_retry(self):
        owner = await (await self.connect()).owner('fixture-thread')
        with self.assertRaisesRegex(ipc.ProtocolError, 'conversation-identity-mismatch'):
            await owner.request('thread-follower-steer-turn', {'conversationId': 'other'})
        self.assertEqual(self.mutations, 0)
        self.wrong_owner = True
        with self.assertRaisesRegex(ipc.DeliveryUnknown, 'unexpected-owner-response'):
            await owner.request('thread-follower-update-thread-settings', {'threadSettings': {'effort': 'high'}})
        self.assertEqual(self.mutations, 1)

    async def test_timeout_is_unknown_and_mutation_is_never_replayed(self):
        owner = await (await self.connect(timeout=.1)).owner('fixture-thread')
        self.hold = True
        with self.assertRaises(ipc.DeliveryUnknown):
            await owner.request('thread-follower-steer-turn', {'restoreMessage': {}})
        await asyncio.sleep(.02)
        self.assertEqual(self.mutations, 1)
        self.assertEqual(len(owner.client.pending), 0)

    async def test_disconnect_invalidates_owner_and_reconnect_has_new_identity(self):
        client = await self.connect()
        owner = await client.owner('fixture-thread')
        self.disconnect = True
        with self.assertRaises(ipc.DeliveryUnknown):
            await owner.request('thread-follower-command-approval-decision', {'requestId': '17', 'decision': 'decline'})
        self.assertTrue(client.closed)
        self.disconnect = False
        another = await self.connect()
        self.assertNotEqual(another.client_id, client.client_id)
        self.assertEqual((await another.owner('fixture-thread')).id, self.owner_id)
        self.assertEqual(self.mutations, 1)

    async def test_remote_rejection_and_interrupt_compatibility_versions(self):
        owner = await (await self.connect()).owner('fixture-thread')
        self.reject = 'request-version-mismatch'
        with self.assertRaisesRegex(ipc.RemoteError, 'request-version-mismatch'):
            await owner.request('thread-follower-interrupt-turn', {'mode': 'user-stop', 'expectedTurnId': 'original-turn'})
        self.assertEqual(self.frames[-1]['version'], 4)
        self.reject = None
        await owner.request('thread-follower-interrupt-turn', {'mode': 'system'})
        self.assertEqual(self.frames[-1]['version'], 3)

    async def test_router_timeout_or_owner_loss_is_unknown_without_replay(self):
        owner = await (await self.connect()).owner('fixture-thread')
        for index, code in enumerate(['request-timeout', 'client-disconnected', 'server-closed']):
            self.reject = code
            with self.assertRaisesRegex(ipc.DeliveryUnknown, code):
                await owner.request('thread-follower-steer-turn', {'restoreMessage': {}})
            self.assertEqual(self.mutations, index + 1)

    async def test_parallel_correlation_and_follower_never_advertises_owner(self):
        client = await self.connect()
        owner = await client.owner('fixture-thread')
        replies = await asyncio.gather(*[
            owner.request('thread-follower-read-model-settings', {}) for _ in range(4)])
        self.assertTrue(all(r['settings']['model'] == 'fixture-model' for r in replies))
        ids = [r['requestId'] for r in self.frames if r['type'] == 'request']
        self.assertEqual(len(ids), len(set(ids)))
        await self.send(self.writers[0], {'type': 'client-discovery-request',
                                        'requestId': 'owner-query', 'request': {}})
        for _ in range(100):
            if self.frames[-1].get('requestId') == 'owner-query':
                break
            await asyncio.sleep(.001)
        self.assertEqual(self.frames[-1]['response'], {'canHandle': False})

    async def test_bad_stream_version_is_not_treated_as_a_snapshot(self):
        owner = await (await self.connect()).owner('fixture-thread')
        self.stream_version = 12
        with self.assertRaisesRegex(ipc.ProtocolError, 'unsupported-stream-version'):
            await owner.snapshot()
        self.assertIsNone(owner.state)

    async def test_invalid_frames_and_envelopes_are_rejected(self):
        for data, reason in [(struct.pack('<I', 0), 'invalid-frame-length'),
                             (struct.pack('<I', ipc.MAX_FRAME + 1), 'invalid-frame-length'),
                             (struct.pack('<I', 1) + b'{', 'invalid-json'),
                             (struct.pack('<I', 2) + b'[]', 'invalid-envelope')]:
            reader = asyncio.StreamReader()
            reader.feed_data(data)
            reader.feed_eof()
            with self.assertRaisesRegex(ipc.ProtocolError, reason):
                await ipc.read_frame(reader)

    async def test_endpoint_checks_do_not_create_modify_or_follow_links(self):
        other = pathlib.Path(self.temp.name) / 'missing.sock'
        with self.assertRaises(FileNotFoundError):
            await ipc.Client.connect(other)
        self.assertFalse(other.exists())
        regular = pathlib.Path(self.temp.name) / 'file'
        regular.write_text('fixture')
        with self.assertRaises(ipc.ProtocolError):
            await ipc.Client.connect(regular)
        link = pathlib.Path(self.temp.name) / 'link.sock'
        link.symlink_to(self.socket)
        with self.assertRaises(ipc.ProtocolError):
            await ipc.Client.connect(link)
        self.socket.chmod(0o666)
        with self.assertRaisesRegex(ipc.ProtocolError, 'unsafe-socket-permissions'):
            await ipc.Client.connect(self.socket)
        self.assertEqual(self.socket.stat().st_mode & 0o777, 0o666)


if __name__ == '__main__':
    unittest.main(verbosity=2)
