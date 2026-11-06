#!/usr/bin/env python3
"""Goal editor HTTP and local objective boundary checks against the real server."""
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = "goal-editor-integration-test-token"
PREFIX = "Read the Codex goal objective file at "
SUFFIX = " before continuing."


class GoalEditorIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="anywork-goal-editor-")
        cls.base = pathlib.Path(cls.temp.name)
        cls.home = cls.base / "codex-home"
        cls.workspace = cls.base / "workspace"
        cls.workspace.mkdir()
        cls.plugins = cls.base / "plugins"
        cls.plugins.mkdir()
        (cls.plugins / "fixture.json").write_text(json.dumps({
            "id": "fixture", "name": "Fixture", "protocol_version": 1,
            "command": "python3", "args": [str(ROOT / "scripts/fake-agent.py")],
            "capabilities": ["chat", "resume", "models"],
        }))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.log = open(cls.base / "server.log", "w+")
        cls.process = subprocess.Popen([
            os.environ.get("ANYWORK_BINARY", str(ROOT / "target/debug/anywork")),
            "--codex-discovery", "false", "--bind", f"127.0.0.1:{cls.port}",
            "--workspace", str(cls.workspace), "--data-dir", str(cls.base / "data"),
            "--plugins-dir", str(cls.plugins), "--web-dir", str(ROOT / "web/dist"), "--token", TOKEN,
        ], env={**os.environ, "CODEX_HOME": str(cls.home), "FAKE_AGENT_STATE_DIR": str(cls.base / "fixture-state"), "FAKE_AGENT_CALLS": str(cls.base / "calls.jsonl")}, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/health", timeout=1)
                return
            except OSError:
                time.sleep(.05)
        cls.log.seek(0)
        raise RuntimeError(cls.log.read())

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()
        cls.temp.cleanup()

    def request(self, path, data=None, token=TOKEN):
        headers = {"Authorization": f"Bearer {token}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/api{path}", data=None if data is None else json.dumps(data).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def create(self):
        session = self.request("/sessions", {"cwd": str(self.workspace), "agent": "fixture"})["session"]
        return f"/sessions/{session['id']}/composer"

    def test_unicode_threshold_round_trip_and_native_reactivation(self):
        endpoint = self.create()
        inline = "😀" * 4000
        self.assertEqual(self.request(endpoint, {"action": "goal", "objective": f"  {inline}\n"})["goal"]["objective"], inline)
        self.request(endpoint, {"action": "goal_status", "status": "paused"})
        text = "# 目标\n\n" + "任何时间、任何地点完成任何工作。😀\n" * 300
        saved = self.request(endpoint, {"action": "goal", "objective": text})["goal"]
        self.assertEqual(saved["status"], "active")
        self.assertTrue(saved["objective"].startswith(PREFIX))
        path = pathlib.Path(saved["objective"][len(PREFIX):-len(SUFFIX)])
        self.assertEqual(path.parent.parent, (self.home / "attachments").resolve())
        self.assertEqual(str(uuid.UUID(path.parent.name)), path.parent.name)
        self.assertEqual(path.read_text(), text.strip())
        self.assertLessEqual(len(saved["objective"]), 4000)
        ordinary = self.request(endpoint)
        self.assertNotIn("goal_objective", ordinary)
        editor = self.request(endpoint + "?goal_editor=true")
        self.assertEqual(editor["goal_objective"], text.strip())
        self.assertNotIn("goal_objective_error", editor)
        revised = self.request(endpoint, {"action": "goal", "objective": "新" * 21000})["goal"]["objective"]
        self.assertNotEqual(revised, saved["objective"])
        self.assertEqual(self.request(endpoint + "?goal_editor=true")["goal_objective"], "新" * 21000)
        self.assertTrue(path.exists(), "An accepted older objective is never destructively removed")
        self.request(endpoint, {"action": "clear_goal"})
        self.assertIsNone(self.request(endpoint + "?goal_editor=true")["goal"])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(endpoint + "?goal_editor=true", token="wrong")
        self.assertEqual(error.exception.code, 401)

    def test_wrapped_arbitrary_paths_stay_literal_and_missing_owned_file_falls_back(self):
        endpoint = self.create()
        secret = self.base / "private.txt"
        secret.write_text("private contents must not be returned")
        cases = [
            f"{PREFIX}{secret}{SUFFIX}",
            f"{PREFIX}{self.home}/attachments/../private.txt{SUFFIX}",
            f"{PREFIX}{self.home}/attachments/not-a-uuid/goal-objective.md{SUFFIX}",
        ]
        for objective in cases:
            self.request(endpoint, {"action": "goal", "objective": objective})
            result = self.request(endpoint + "?goal_editor=true")
            self.assertEqual(result["goal_objective"], objective)
        missing = self.home / "attachments" / str(uuid.uuid4()) / "goal-objective.md"
        objective = f"{PREFIX}{missing}{SUFFIX}"
        self.request(endpoint, {"action": "goal", "objective": objective})
        result = self.request(endpoint + "?goal_editor=true")
        self.assertEqual(result["goal_objective"], objective)
        self.assertIn("无法读取目标正文", result["goal_objective_error"])
        # A failed objective read never suppresses the native goal itself.
        self.assertEqual(result["goal"]["objective"], objective)
        self.assertIsNone(result["goal_error"])

    @unittest.skipUnless(os.name == "posix", "symlink boundaries are a Unix fixture")
    def test_matching_uuid_symlink_file_is_rejected(self):
        endpoint = self.create()
        self.home.mkdir(exist_ok=True)
        directory = self.home / "attachments" / str(uuid.uuid4())
        directory.mkdir(parents=True)
        secret = self.base / "secret.txt"
        secret.write_text("must never leave private file")
        path = directory / "goal-objective.md"
        path.symlink_to(secret)
        objective = f"{PREFIX}{path}{SUFFIX}"
        self.request(endpoint, {"action": "goal", "objective": objective})
        result = self.request(endpoint + "?goal_editor=true")
        self.assertEqual(result["goal_objective"], objective)
        self.assertIn("目标文件无效", result["goal_objective_error"])


if __name__ == "__main__":
    unittest.main()
