#!/usr/bin/env python3
"""Isolated HTTP checks for goals created through the ordinary message composer."""
import importlib.util
import json
import pathlib
import unittest
import urllib.error
import time

spec = importlib.util.spec_from_file_location("goal_editor_fixture", pathlib.Path(__file__).with_name("goal-editor-test.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class GoalModeIntegration(unittest.TestCase):
    setUpClass = classmethod(fixture.GoalEditorIntegration.setUpClass.__func__)
    tearDownClass = classmethod(fixture.GoalEditorIntegration.tearDownClass.__func__)
    request = fixture.GoalEditorIntegration.request
    create = fixture.GoalEditorIntegration.create

    def endpoints(self):
        composer = self.create()
        return composer[:-len('/composer')], composer

    def calls(self, base):
        session = self.request(base)['session']
        path = self.base / 'calls.jsonl'
        return [call for line in path.read_text().splitlines() if (call := json.loads(line)).get('params', {}).get('threadId') == session['thread_id']]

    def wait_idle(self, base):
        for _ in range(100):
            if self.request(base)['session']['status'] not in ['running', 'starting', 'waiting']:
                return
            time.sleep(.03)
        self.fail('fixture did not complete')

    def test_message_first_then_activation_and_original_display_metadata(self):
        base, composer = self.endpoints()
        result = self.request(base + '/messages', {'text': '**完成目标**', 'goal': True, 'composer': {'markdown': '**完成目标**', 'document': {'type': 'doc', 'content': []}}})
        self.assertEqual(result['goal']['objective'], '**完成目标**')
        self.assertEqual(self.request(composer)['goal']['status'], 'active')
        calls = self.calls(base)
        delivery = next(i for i, c in enumerate(calls) if c['method'] == 'turn/start')
        activation = next(i for i, c in enumerate(calls) if c['method'] == 'thread/goal/set')
        self.assertLess(delivery, activation)
        self.assertEqual(calls[delivery]['params']['input'][0]['text'], '/goal **完成目标**')
        self.assertEqual(calls[activation]['params']['origin'], 'user')
        events = self.request(base + '/export')['events']
        user = [e['params'] for e in events if e['method'] == 'item/completed' and e['params'].get('item', {}).get('type') == 'userMessage']
        self.assertTrue(any(e.get('display_text') == '**完成目标**' for e in user))

    def test_image_only_goal_copies_durable_image_and_sends_native_image(self):
        base, composer = self.endpoints()
        image = self.workspace / 'goal-image.png'
        image.write_bytes(b'fixture-image')
        result = self.request(base + '/messages', {'text': '', 'attachments': [str(image)], 'goal': True})
        objective = result['goal']['objective']
        self.assertTrue(objective.startswith('Referenced image files:\n- [Image #1]: '))
        copied = pathlib.Path(objective.split(': ', 1)[1])
        self.assertEqual(copied.parent.parent, (self.home / 'attachments').resolve())
        self.assertEqual(copied.read_bytes(), image.read_bytes())
        start = next(c for c in self.calls(base) if c['method'] == 'turn/start')
        self.assertIn({'type': 'localImage', 'path': str(image.resolve())}, start['params']['input'])
        self.assertEqual(start['params']['input'][0]['text'], '/goal ' + objective)
        self.assertEqual(self.request(composer)['goal']['objective'], objective)
        self.assertTrue(self.request(base)['session']['title'].strip())

    def test_rejected_delivery_does_not_set_goal_or_retry(self):
        base, composer = self.endpoints()
        with self.assertRaises(urllib.error.HTTPError):
            self.request(base + '/messages', {'text': 'edit-reject-once goal', 'goal': True})
        self.assertIsNone(self.request(composer)['goal'])
        methods = [c['method'] for c in self.calls(base)]
        self.assertEqual(methods.count('turn/start'), 1)
        self.assertNotIn('thread/goal/set', methods)

    def test_accepted_delivery_activation_error_warns_without_duplicate_send(self):
        base, composer = self.endpoints()
        self.request(composer, {'action': 'goal', 'objective': 'keep existing goal'})
        result = self.request(base + '/messages', {'text': 'goal-activation-rejected', 'goal': True})
        self.assertIn('无需重发消息', result['goal_error'])
        self.assertIn('turn', result)
        self.assertEqual(self.request(composer)['goal']['objective'], 'keep existing goal')
        self.assertEqual(sum(c['method'] == 'turn/start' for c in self.calls(base)), 1)

    def test_queue_goal_applies_only_on_delivery_and_edit_can_remove_mode(self):
        base, composer = self.endpoints()
        self.request(composer, {'action': 'goal', 'objective': 'original goal'})
        self.request(base + '/messages', {'text': 'slow'})
        queue = self.request(base + '/messages', {'text': 'queued goal', 'goal': True, 'mode': 'queue'})
        item = queue['items'][0]
        self.assertTrue(item['goal'])
        self.assertEqual(self.request(composer)['goal']['objective'], 'original goal')
        taken = self.request(base + '/queue', {'action': 'take', 'id': item['id']})
        self.assertTrue(taken['editing']['goal'])
        restored = self.request(base + '/queue', {'action': 'restore', 'id': item['id']})
        self.assertTrue(restored['items'][0]['goal'])
        self.request(base + '/queue', {'action': 'take', 'id': item['id']})
        ordinary = self.request(base + '/queue', {'action': 'replace', 'id': item['id'], 'text': 'ordinary', 'attachments': [], 'goal': False})
        self.assertFalse(ordinary['items'][0]['goal'])
        self.request(base + '/queue', {'action': 'take', 'id': item['id']})
        self.request(base + '/queue', {'action': 'replace', 'id': item['id'], 'text': 'queued goal', 'attachments': [], 'goal': True})
        self.request(base + '/queue', {'action': 'steer', 'id': item['id']})
        self.assertEqual(self.request(composer)['goal']['objective'], 'queued goal')
        steer = next(c for c in self.calls(base) if c['method'] == 'turn/steer')
        self.assertEqual(steer['params']['input'][0]['text'], '/goal queued goal')

    def test_attachment_boundary_rejected_before_goal_or_turn_mutation(self):
        base, composer = self.endpoints()
        private = self.base / 'outside.png'
        private.write_bytes(b'outside fixture')
        with self.assertRaises(urllib.error.HTTPError):
            self.request(base + '/messages', {'text': 'goal', 'attachments': [str(private)], 'goal': True})
        self.assertIsNone(self.request(composer)['goal'])
        self.assertFalse(any(c['method'] in ['turn/start', 'thread/goal/set'] for c in self.calls(base)))


if __name__ == '__main__':
    unittest.main()
