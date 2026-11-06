#!/usr/bin/env python3
"""Verify durable message editing through the real Rust HTTP server, without model calls."""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import shlex
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = "isolated-editing-test-token"
PAGE_PREFIX = "<page-comment-context>\nedit-wrapped-fixture\n</page-comment-context>\n## My request:\n"


class Editing(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="anywork-editing-")
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.workspace = self.base / "workspace"
        self.workspace.mkdir()
        self.plugins = self.base / "plugins"
        self.plugins.mkdir()
        self.state = self.base / "fixture-state"
        self.calls_file = self.base / "calls.jsonl"
        self.image = self.workspace / "original.png"
        self.image.write_bytes(bytes.fromhex("89504e470d0a1a0a") + b"editing image fixture")
        self.document = self.workspace / "original.pdf"
        self.document.write_bytes(b"%PDF-1.7\nediting document fixture\n%%EOF\n")
        self.cli = self.base / "codex-fixture"
        self.cli.write_text("#!/bin/sh\nexec python3 " + shlex.quote(str(ROOT / "scripts/fake-agent.py")) + ' "$@"\n')
        self.cli.chmod(0o700)
        self.log = open(self.base / "server.log", "w+")
        self.addCleanup(self.log.close)
        self.process = None
        self.addCleanup(self.stop)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.start()

    def start(self):
        binary = os.environ.get("ANYWORK_BINARY", os.environ.get("REMOTE_AGENT_BINARY", str(ROOT / "target/debug/anywork")))
        env = {**os.environ, "CODEX_BIN": str(self.cli), "CODEX_HOME": str(self.base / "codex-home"),
               "FAKE_AGENT_STATE_DIR": str(self.state), "FAKE_AGENT_CALLS": str(self.calls_file)}
        env.pop("FAKE_CODEX_CATALOG", None)
        self.process = subprocess.Popen([binary, "--codex-discovery", "false", "--bind", f"127.0.0.1:{self.port}",
                                         "--workspace", str(self.workspace), "--data-dir", str(self.base / "data"),
                                         "--plugins-dir", str(self.plugins), "--token", TOKEN],
                                        cwd=ROOT, env=env, stdout=self.log, stderr=self.log)
        for _ in range(150):
            if self.process.poll() is not None:
                break
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/health", timeout=1)
                return
            except OSError:
                time.sleep(.03)
        self.log.flush()
        self.log.seek(0)
        raise RuntimeError(self.log.read())

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)

    def restart(self):
        self.stop()
        self.start()

    def request(self, path, data=None, method=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api" + path,
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
                                     method=method)
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)

    def create(self):
        session = self.request("/sessions", {"cwd": str(self.workspace), "agent": "codex", "model": "fixture"})["session"]
        self.assertEqual(session["status"], "idle")
        return session

    def wait_idle(self, sid):
        for _ in range(150):
            session = self.request(f"/sessions/{sid}")["session"]
            if session["status"] == "idle":
                return session
            time.sleep(.02)
        self.fail("Session did not become idle: " + repr(session))

    def send(self, sid, text, attachments=None):
        self.request(f"/sessions/{sid}/messages", {"text": text, "attachments": attachments or []})
        self.wait_idle(sid)

    def events(self, sid):
        return self.request(f"/sessions/{sid}/export")["events"]

    def descriptor(self, sid):
        event = next(event for event in reversed(self.events(sid)) if event["method"] == "user/message")
        key = event["params"].get("history_id", event["seq"])
        return self.request(f"/sessions/{sid}/edit?" + urllib.parse.urlencode({"message_id": "user-" + str(key)}))

    def body(self, descriptor, text, operation_id=None, retry=False):
        return {"message_id": descriptor["message_id"], "text": text, "expected_fingerprint": descriptor["fingerprint"],
                "operation_id": operation_id or str(uuid.uuid4()), "retry": retry}

    def calls(self, method=None, thread=None):
        calls = [json.loads(line) for line in self.calls_file.read_text().splitlines()] if self.calls_file.exists() else []
        return [call for call in calls if (method is None or call.get("method") == method)
                and (thread is None or call.get("params", {}).get("threadId") == thread)]

    def native(self, thread):
        path = self.state / (hashlib.sha256(thread.encode()).hexdigest() + ".history.json")
        return json.loads(path.read_text())["turns"]

    def assert_http_error(self, code, path, data=None, method=None):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(path, data, method)
        self.assertEqual(caught.exception.code, code)
        return json.load(caught.exception)

    def test_same_thread_edit_preserves_native_input_files_and_monotonic_events(self):
        plugins = self.request("/plugins")["plugins"]
        self.assertEqual(sum(plugin["id"] == "codex" for plugin in plugins), 1)
        self.assertIn("message-edit", next(plugin for plugin in plugins if plugin["id"] == "codex")["capabilities"])
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, "retained prefix")
        retained = self.native(thread)[0]
        attachments = [str(self.image), str(self.document)]
        self.send(sid, "edit-rich-input", attachments)
        original_input = self.native(thread)[-1]["items"][0]["content"]
        before = self.events(sid)
        descriptor = self.descriptor(sid)
        self.assertRegex(descriptor["fingerprint"], r"^native-edit-v1-[0-9a-f]{16}$")
        self.assertNotIn("fixture-file-id", descriptor["fingerprint"])
        payload = self.body(descriptor, "edited original message")
        result = self.request(f"/sessions/{sid}/edit", payload)
        self.assertEqual(result["operation"]["phase"], "completed")
        self.assertTrue(result["history_changed"])
        self.wait_idle(sid)
        self.assertEqual(self.request(f"/sessions/{sid}")["session"]["thread_id"], thread)
        native = self.native(thread)
        self.assertEqual(len(native), 2)
        self.assertEqual(native[0], retained)
        updated = native[-1]["items"][0]["content"]
        self.assertEqual(updated[0], {"type": "text", "text": payload["text"], "text_elements": []})
        self.assertEqual(updated[1:], original_input[1:])
        sent = next(call["params"] for call in self.calls("turn/start", thread)
                    if call["params"].get("clientUserMessageId") == payload["operation_id"])
        self.assertEqual(set(sent), {"threadId", "input", "clientUserMessageId"})
        after = self.events(sid)
        self.assertEqual([event["params"]["text"] for event in after if event["method"] == "user/message"],
                         ["retained prefix", payload["text"]])
        self.assertEqual(next(event for event in reversed(after) if event["method"] == "user/message")["params"]["attachments"], attachments)
        marker = next(event for event in after if event["method"] == "history/reset")
        self.assertGreater(marker["seq"], max(event["seq"] for event in before))
        self.assertEqual(self.request(f"/sessions/{sid}/events/poll?after={max(event['seq'] for event in before)}")["events"][0]["method"], "history/reset")
        self.assertTrue(self.image.read_bytes().endswith(b"editing image fixture"))
        self.assertIn(b"editing document fixture", self.document.read_bytes())
        self.assertIsNone(self.request(f"/sessions/{sid}/edit")["operation"])

    def test_native_library_and_app_metadata_edit_uses_native_callback_without_composer_reserialization(self):
        cases = [
            ("https://fixture.anywork.test/library", "[Library file](chatgpt-library-file://fixture?asUrl=1&sourceUrl=https%3A%2F%2Ffixture.anywork.test%2Flibrary)"),
            ("Respond to the user input in the context of our conversation.", "Restored native app message"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                session = self.create(); sid = session["id"]; thread = session["thread_id"]
                attachments = [str(self.image), str(self.document)]
                self.send(sid, raw, attachments)
                events = self.events(sid)
                echo = next(e for e in events if e["method"] == "user/message")
                self.assertEqual(echo["params"]["text"], raw)
                native = next(e for e in events if e["method"] == "item/completed" and e["params"]["item"]["type"] == "userMessage")
                self.assertEqual(native["params"]["display_text"], expected)
                original_input = self.native(thread)[-1]["items"][0]["content"]
                self.assertEqual(original_input[0]["text"], raw)
                descriptor = self.descriptor(sid)
                self.assertEqual(descriptor["text"], expected)
                self.assertEqual(descriptor["attachments"], attachments)
                self.assert_http_error(409, f"/sessions/{sid}/edit", {"message_id":descriptor["message_id"],"text":"stale rewrite","operation_id":str(uuid.uuid4()),"expected_fingerprint":"native-edit-v1-0000000000000000"})
                self.assertEqual(self.calls("thread/revert", thread), [])
                self.assertEqual(self.native(thread)[-1]["items"][0]["content"], original_input)
                # jun consumes the editor's callback directly via Ooe. It does
                # not run the ordinary composer YEe/rDe conversion afterwards.
                edited = expected + " edited 中🙂"
                result = self.request(f"/sessions/{sid}/edit", self.body(descriptor, edited))
                self.assertEqual(result["operation"]["phase"], "completed")
                self.wait_idle(sid)
                updated = self.native(thread)[-1]["items"][0]["content"]
                self.assertEqual(updated[0], {**original_input[0], "text":edited, "text_elements":[]})
                self.assertEqual(updated[1:], original_input[1:])
                self.assertEqual(len(self.calls("thread/revert", thread)), 1)
                self.assertEqual(self.descriptor(sid)["text"], edited)
                # A second edit remains a normal same-thread edit after the
                # original metadata was cleared by the native edit contract.
                again = edited + " again"
                self.request(f"/sessions/{sid}/edit", self.body(self.descriptor(sid), again))
                self.wait_idle(sid)
                self.assertEqual(self.native(thread)[-1]["items"][0]["content"][0]["text"], again)
                self.assertEqual(self.native(thread)[-1]["items"][0]["content"][1:], original_input[1:])

    def test_codex_composer_serializes_library_mentions_but_preserves_draft_display_and_attachments(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        source = "https://docs.example.test/文件?version=2&format=pdf"
        href = "chatgpt-library-file://file-id?asUrl=1&sourceUrl=" + urllib.parse.quote(source, safe="")
        mention = f"[**原文档**]({href})"
        prefix = "中文🙂 before "
        suffix = f" after `[{source}]({href})`"
        submitted = prefix + mention + suffix
        wire_text = prefix + source + suffix
        attachments = [str(self.image), str(self.document)]
        self.send(sid, submitted, attachments)
        sent = self.calls("turn/start", thread)[-1]["params"]["input"]
        expected_part = {"type":"text", "text":wire_text, "text_elements":[{
            "byteRange":{"start":len(prefix.encode()), "end":len((prefix + source).encode())},
            "placeholder":mention,
        }]}
        self.assertEqual(sent[0], expected_part)
        self.assertEqual(sent[1:], [{"type":"localImage", "path":str(self.image.resolve())},
                                   {"type":"text", "text":"Attached local file: " + str(self.document.resolve())}])
        echo = next(e for e in self.events(sid) if e["method"] == "user/message")
        self.assertEqual(echo["params"]["text"], wire_text)
        self.assertEqual(echo["params"]["submitted_text"], submitted)
        self.assertEqual(echo["params"]["display_text"], submitted)
        self.assertEqual(echo["params"]["attachments"], attachments)
        self.assertEqual(self.native(thread)[-1]["items"][0]["content"], sent)

        # Queue storage keeps the authored draft; conversion happens once when
        # the pending message actually reaches the native delivery path.
        queued = submitted.replace("before", "queued")
        self.request(f"/sessions/{sid}/messages", {"text":queued,"mode":"queue"})
        for _ in range(150):
            calls = self.calls("turn/start", thread)
            if len(calls) >= 2:
                break
            time.sleep(.02)
        else:
            self.fail("Queued library message was not delivered")
        self.wait_idle(sid)
        queued_part = self.calls("turn/start", thread)[-1]["params"]["input"][0]
        self.assertEqual(queued_part["text"], wire_text.replace("before", "queued"))
        self.assertEqual(queued_part["text_elements"][0]["placeholder"], mention)
        echoes = [e["params"] for e in self.events(sid) if e["method"] == "user/message"]
        self.assertEqual(echoes[-1]["submitted_text"], queued)
        self.assertEqual(echoes[-1]["display_text"], queued)

    def test_reverted_draft_survives_restart_and_retry_updates_text_without_reverting_again(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        attachments = [str(self.image), str(self.document)]
        self.send(sid, "original", attachments)
        descriptor = self.descriptor(sid)
        payload = self.body(descriptor, "edit-reject-once")
        first = self.request(f"/sessions/{sid}/edit", payload)
        self.assertEqual(first["operation"]["phase"], "reverted")
        self.assertTrue(first["operation"]["retryable"])
        self.assertEqual(first["operation"]["attachments"], attachments)
        self.assertFalse(any(event["method"] == "user/message" for event in self.events(sid)))
        self.assert_http_error(409, f"/sessions/{sid}/messages", {"text": "must wait"})
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)
        self.restart()
        recovery = self.request(f"/sessions/{sid}/edit")["operation"]
        self.assertEqual((recovery["id"], recovery["text"], recovery["phase"]),
                         (payload["operation_id"], payload["text"], "reverted"))
        self.assertEqual(recovery["attachments"], attachments)
        payload.update(text="corrected draft after restart", retry=True)
        result = self.request(f"/sessions/{sid}/edit", payload)
        self.assertEqual(result["operation"]["phase"], "completed")
        self.wait_idle(sid)
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)
        self.assertEqual(len(self.native(thread)), 1)
        self.assertEqual(self.native(thread)[0]["items"][0]["content"][0]["text"], payload["text"])
        self.assertEqual(self.request(f"/sessions/{sid}/queue")["paused"], True)

    def test_concurrent_same_operation_is_idempotent(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, "original")
        payload = self.body(self.descriptor(sid), "concurrent replacement")
        barrier = threading.Barrier(2)
        def submit():
            barrier.wait()
            return self.request(f"/sessions/{sid}/edit", payload)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: submit(), range(2)))
        self.assertEqual([result["operation"]["phase"] for result in results], ["completed", "completed"])
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)
        self.assertEqual(sum(call["params"].get("clientUserMessageId") == payload["operation_id"]
                             for call in self.calls("turn/start", thread)), 1)

    def test_stale_descriptor_is_rejected_without_mutating_native_history(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, "original")
        stale = self.descriptor(sid)
        self.send(sid, "newer turn from another client")
        before = self.native(thread)
        self.assert_http_error(409, f"/sessions/{sid}/edit", self.body(stale, "stale replacement"))
        self.assertEqual(self.native(thread), before)
        self.assertEqual(len(self.calls("thread/revert", thread)), 0)

    def test_cancel_reverted_draft_only_abandons_journal_and_unblocks_new_message(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, "original")
        payload = self.body(self.descriptor(sid), "edit-reject-once")
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "reverted")
        before_calls = len(self.calls())
        path = f"/sessions/{sid}/edit/{payload['operation_id']}"
        result = self.request(path, method="DELETE")
        self.assertEqual(result["operation"]["phase"], "cancelled")
        self.assertEqual(len(self.calls()), before_calls)
        self.assertEqual(self.native(thread), [])
        self.assertIsNone(self.request(f"/sessions/{sid}/edit")["operation"])
        self.assertTrue(self.request(path, method="DELETE")["ok"])
        self.assertTrue(self.request(f"/sessions/{sid}/edit/{uuid.uuid4()}", method="DELETE")["ok"])
        self.send(sid, "new message after abandoning edit")
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)

    def test_unknown_send_after_native_commit_is_observed_without_resending(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, "original")
        payload = self.body(self.descriptor(sid), "edit-disconnect-after-commit")
        result = self.request(f"/sessions/{sid}/edit", payload)
        self.assertEqual(result["operation"]["phase"], "uncertain")
        self.assertFalse(result["operation"]["retryable"])
        self.restart()
        self.assertEqual(self.request(f"/sessions/{sid}/edit")["operation"]["phase"], "uncertain")
        payload["retry"] = True
        observed = self.request(f"/sessions/{sid}/edit", payload)
        self.assertEqual(observed["operation"]["phase"], "completed")
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)
        self.assertEqual(sum(call["params"].get("clientUserMessageId") == payload["operation_id"]
                             for call in self.calls("turn/start", thread)), 1)

    def test_unknown_send_before_commit_is_not_blindly_retried(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, "original")
        payload = self.body(self.descriptor(sid), "edit-disconnect-before-commit")
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "uncertain")
        payload["retry"] = True
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "uncertain")
        self.assertEqual(self.native(thread), [])
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)
        self.assertEqual(sum(call["params"].get("clientUserMessageId") == payload["operation_id"]
                             for call in self.calls("turn/start", thread)), 1)

    def test_empty_text_preserves_original_attachment_and_empty_only_edit_is_rejected(self):
        session = self.create(); sid = session["id"]
        self.send(sid, "original with document", [str(self.document)])
        result = self.request(f"/sessions/{sid}/edit", self.body(self.descriptor(sid), ""))
        self.assertEqual(result["operation"]["phase"], "completed")
        self.wait_idle(sid)
        other = self.create(); self.send(other["id"], "text only")
        self.assert_http_error(400, f"/sessions/{other['id']}/edit", self.body(self.descriptor(other["id"]), "  "))

    def test_page_context_is_hidden_preserved_and_second_edit_resolves_raw_input(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, PAGE_PREFIX + "outer ## My request:  initial body  ", [str(self.document)])
        descriptor = self.descriptor(sid)
        self.assertEqual(descriptor["text"], "initial body")
        payload = self.body(descriptor, "edited page body")
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "completed")
        self.wait_idle(sid)
        raw = PAGE_PREFIX + payload["text"] + "\n"
        self.assertEqual(self.native(thread)[0]["items"][0]["content"][0]["text"], raw)
        echo = next(event for event in reversed(self.events(sid)) if event["method"] == "user/message")
        self.assertEqual(echo["params"]["text"], raw)
        second = self.descriptor(sid)
        self.assertEqual(second["text"], payload["text"])
        second_payload = self.body(second, "second body ## My request: visible leaf")
        self.assertEqual(self.request(f"/sessions/{sid}/edit", second_payload)["operation"]["phase"], "completed")
        self.wait_idle(sid)
        self.assertEqual(self.native(thread)[0]["items"][0]["content"][0]["text"], PAGE_PREFIX + second_payload["text"] + "\n")
        self.assertEqual(self.descriptor(sid)["text"], "visible leaf")
        self.assertEqual(len(self.calls("thread/revert", thread)), 2)

    def test_wrapped_legacy_reverted_draft_uses_original_input_after_restart(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, PAGE_PREFIX + "original body")
        payload = self.body(self.descriptor(sid), "edit-reject-once")
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "reverted")
        self.stop()
        # Emulate a journal written by the older editor that stripped the first
        # input wrapper. Its original_input remains the authoritative template.
        with sqlite3.connect(self.base / "data" / "remote-agent.sqlite") as db:
            saved = json.loads(db.execute("SELECT data FROM message_edits WHERE operation_id=?", (payload["operation_id"],)).fetchone()[0])
            self.assertEqual(saved["original_input"][0]["text"], PAGE_PREFIX + "original body")
            saved["input"][0]["text"] = "legacy stripped draft"
            db.execute("UPDATE message_edits SET data=? WHERE operation_id=?", (json.dumps(saved), payload["operation_id"]))
        self.start()
        recovered = self.request(f"/sessions/{sid}/edit")["operation"]
        self.assertEqual(recovered["text"], "edit-reject-once")
        self.assertEqual(recovered["phase"], "reverted")
        payload.update(text="corrected wrapped body after restart", retry=True)
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "completed")
        self.wait_idle(sid)
        self.assertEqual(self.native(thread)[0]["items"][0]["content"][0]["text"], PAGE_PREFIX + payload["text"] + "\n")
        self.assertEqual(self.descriptor(sid)["text"], payload["text"])
        self.assertEqual(len(self.calls("thread/revert", thread)), 1)

    def test_ordinary_context_uses_last_marker_and_normalizes_only_its_separator(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        prefix = "context ## My request: earlier body\ninline context  \t"
        self.send(sid, prefix + "## My request for Codex:  original body  ")
        descriptor = self.descriptor(sid)
        self.assertEqual(descriptor["text"], "original body")
        payload = self.body(descriptor, "  edited ordinary body  ")
        self.assertEqual(self.request(f"/sessions/{sid}/edit", payload)["operation"]["phase"], "completed")
        self.wait_idle(sid)
        expected = prefix.rstrip() + "\n## My request:\n" + payload["text"] + "\n"
        self.assertEqual(self.native(thread)[0]["items"][0]["content"][0]["text"], expected)
        self.assertEqual(self.descriptor(sid)["text"], payload["text"].strip())

    def test_hidden_context_does_not_make_an_empty_edited_body_valid(self):
        session = self.create(); sid = session["id"]; thread = session["thread_id"]
        self.send(sid, PAGE_PREFIX + "original body")
        before = self.native(thread)
        self.assert_http_error(400, f"/sessions/{sid}/edit", self.body(self.descriptor(sid), " \n "))
        self.assertEqual(self.native(thread), before)
        self.assertEqual(len(self.calls("thread/revert", thread)), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
