#!/usr/bin/env python3
"""Real isolated HTTP contract for conditional text saves; no native Agent tasks."""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = "file-consistency-isolated-token"


def revision(content):
    return "sha256:" + hashlib.sha256(content).hexdigest()


class FileConsistency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="anywork-file-http-")
        cls.base = pathlib.Path(cls.tmp.name)
        cls.workspace = cls.base / "workspace"
        cls.workspace.mkdir()
        plugins = cls.base / "plugins"
        plugins.mkdir()
        (plugins / "fixture.json").write_text(json.dumps({"id": "fixture", "name": "Fixture", "protocol_version": 1, "command": "python3", "args": [str(ROOT / "scripts/fake-agent.py")], "capabilities": ["chat"]}))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.log = open(cls.base / "server.log", "w+")
        binary = os.environ.get("ANYWORK_BINARY", str(ROOT / "target/debug/anywork"))
        env = {k: v for k, v in os.environ.items() if not k.startswith(("ANYWORK_HARNESS_", "ANYWORK_WORKBUDDY_"))}
        env.update(HOME=str(cls.base / "home"), USERPROFILE=str(cls.base / "home"), CODEX_HOME=str(cls.base / "codex"))
        cls.process = subprocess.Popen([binary, "--codex-discovery", "false", "--bind", f"127.0.0.1:{cls.port}", "--workspace", str(cls.workspace), "--data-dir", str(cls.base / "data"), "--plugins-dir", str(plugins), "--web-dir", str(cls.base / "empty-web"), "--token", TOKEN], env=env, stdout=cls.log, stderr=cls.log)
        try:
            for _ in range(150):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/health", timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                if cls.process.poll() is not None:
                    raise RuntimeError("Isolated server exited")
                time.sleep(.05)
            else:
                raise RuntimeError("Isolated server startup timed out")
            cls.sid = cls.request("/sessions", {"agent": "fixture", "cwd": str(cls.workspace)})[1]["session"]["id"]
            cls.other = cls.request("/sessions", {"agent": "fixture", "cwd": str(cls.workspace)})[1]["session"]["id"]
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()
        cls.tmp.cleanup()

    @classmethod
    def request(cls, path, body=None, method=None, token=TOKEN):
        request = urllib.request.Request(f"http://127.0.0.1:{cls.port}/api{path}", data=None if body is None else json.dumps(body).encode(), method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read().decode()
            return response.status, json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else {"error": raw}

    def read(self, name, sid=None):
        return self.request(f"/sessions/{sid or self.sid}/files?path={urllib.parse.quote(name)}")

    def write(self, name, content, expected, sid=None):
        return self.request(f"/sessions/{sid or self.sid}/files", {"path": name, "content": content, "expected_revision": expected}, "PUT")

    def test_exact_bytes_and_stale_deleted_conflicts(self):
        target = self.workspace / "exact.txt"
        original = "中文\r\nline\n".encode()
        target.write_bytes(original)
        code, data = self.read(target.name)
        self.assertEqual((code, data), (200, {"content": original.decode(), "revision": revision(original)}))
        code, saved = self.write(target.name, "draft", data["revision"])
        self.assertEqual((code, saved), (200, {"ok": True, "revision": revision(b"draft")}))
        code, error = self.write(target.name, "stale", data["revision"])
        self.assertEqual((code, error["code"], error["delivery_state"]), (409, "file_revision_conflict", "not_written"))
        self.assertEqual(target.read_bytes(), b"draft")
        target.unlink()
        self.assertEqual(self.write(target.name, "old", saved["revision"])[0], 409)
        self.assertFalse(target.exists())

    def test_missing_invalid_and_create_only(self):
        name = "create.txt"
        route = f"/sessions/{self.sid}/files"
        code, error = self.request(route, {"path": name, "content": "unsafe"}, "PUT")
        self.assertEqual((code, error["code"]), (428, "file_revision_required"))
        self.assertFalse((self.workspace / name).exists())
        self.assertEqual(self.write(name, "bad", "sha256:bad")[0], 400)
        self.assertEqual(self.write(name, "first", None)[0], 200)
        self.assertEqual(self.write(name, "clobber", None)[0], 409)
        self.assertEqual((self.workspace / name).read_text(), "first")
        self.assertEqual(self.request(route, {"path": name, "content": "bad", "expected_revision": None, "force": True}, "PUT")[0], 422)
        self.assertEqual(self.request(route, {"path": name, "content": "bad", "expected_revision": 42}, "PUT")[0], 422)

    def test_concurrent_sessions_and_parent_alias_share_destination(self):
        target = self.workspace / "race.txt"
        target.write_text("baseline")
        alias = self.workspace / "alias"
        alias.symlink_to(self.workspace, target_is_directory=True)
        expected = self.read(target.name)[1]["revision"]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(self.write, name, text, expected, sid) for name, text, sid in [(target.name, "one", self.sid), ("alias/race.txt", "two", self.other)]]
            results = [future.result() for future in futures]
        self.assertEqual(sorted(code for code, _ in results), [200, 409])
        self.assertIn(target.read_text(), ["one", "two"])
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(self.write, "new-race.txt", text, None, sid) for text, sid in [("new one", self.sid), ("new two", self.other)]]
            created = [future.result() for future in futures]
        self.assertEqual(sorted(code for code, _ in created), [200, 409])
        self.assertIn((self.workspace / "new-race.txt").read_text(), ["new one", "new two"])
        self.assertEqual(list(self.workspace.glob(".anywork-save-*")), [])

    def test_boundaries_permissions_and_unsupported_targets(self):
        outside = self.base / "outside.txt"
        outside.write_text("outside")
        self.assertEqual(self.write("../outside.txt", "bad", None)[0], 403)
        link = self.workspace / "link.txt"
        link.symlink_to(outside)
        self.assertEqual(self.write(link.name, "bad", None)[0], 400)
        self.assertEqual(outside.read_text(), "outside")
        directory = self.workspace / "folder"
        directory.mkdir()
        self.assertEqual(self.write(directory.name, "bad", None)[0], 400)
        target = self.workspace / "mode.txt"
        target.write_text("mode")
        target.chmod(0o640)
        expected = self.read(target.name)[1]["revision"]
        self.assertEqual(self.write(target.name, "changed", expected)[0], 200)
        if os.name == "posix":
            self.assertEqual(target.stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.write("large.txt", "x" * (2 * 1024 * 1024 + 1), None)[0], 400)
        self.assertFalse((self.workspace / "large.txt").exists())
        self.assertEqual(self.request(f"/sessions/{self.sid}/files", {"path": "auth.txt", "content": "bad", "expected_revision": None}, "PUT", token="wrong")[0], 401)
        self.assertEqual(list(self.workspace.glob(".anywork-save-*")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
