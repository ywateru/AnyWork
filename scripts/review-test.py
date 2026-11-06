#!/usr/bin/env python3
"""Read-only review API against temporary Git repositories and an isolated server."""
import importlib.util, json, os, pathlib, shutil, sqlite3, subprocess, unittest, urllib.error, urllib.parse
spec = importlib.util.spec_from_file_location("integration_fixture", pathlib.Path(__file__).with_name("integration-test.py"))
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)

class Review(unittest.TestCase):
    setUpClass = classmethod(fixture.Integration.setUpClass.__func__)
    tearDownClass = classmethod(fixture.Integration.tearDownClass.__func__)
    request = fixture.Integration.request
    create = fixture.Integration.create

    @classmethod
    def start(cls):
        # This service only starts the deterministic plugin, never a real Codex engine.
        previous = os.environ.get("CODEX_HOME")
        os.environ["CODEX_HOME"] = str(cls.base / "codex-home")
        try: fixture.Integration.start.__func__(cls)
        finally:
            if previous is None: os.environ.pop("CODEX_HOME", None)
            else: os.environ["CODEX_HOME"] = previous

    def git(self, root, *args):
        return subprocess.run(["git", "-C", str(root), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().strip()

    def repo(self, commit=True):
        root = self.workspace / self._testMethodName; root.mkdir()
        self.git(root, "init", "-b", "main")
        (root / "tracked.txt").write_text("original\n")
        if commit:
            self.git(root, "add", "."); self.git(root, "commit", "-m", "base")
        sid = self.create(cwd=str(root))["id"]
        return root, sid

    def review(self, sid, source="uncommitted", **params):
        return self.request(f"/sessions/{sid}/review?" + urllib.parse.urlencode({"source":source, **params}))

    def test_sources_and_empty_diff(self):
        root, sid = self.repo()
        self.assertEqual(self.review(sid)["diff"], "")
        (root/"tracked.txt").write_text("staged-version\n"); self.git(root,"add","tracked.txt")
        (root/"tracked.txt").write_text("working-version\n")
        (root/"new 文件.txt").write_text("untracked-content\n")
        staged = self.review(sid,"staged")["diff"]
        self.assertIn("+staged-version",staged); self.assertNotIn("working-version",staged); self.assertNotIn("untracked-content",staged)
        unstaged = self.review(sid,"unstaged")["diff"]
        self.assertIn("-staged-version",unstaged); self.assertIn("+working-version",unstaged); self.assertIn("+untracked-content",unstaged)
        combined = self.review(sid)["diff"]
        self.assertIn("-original",combined); self.assertNotIn("staged-version",combined); self.assertIn("+working-version",combined)

    def test_branch_uses_common_ancestor_and_cached_default(self):
        root, sid = self.repo()
        self.git(root,"checkout","-b","feature")
        (root/"tracked.txt").write_text("feature-change\n"); self.git(root,"commit","-am","feature")
        self.git(root,"checkout","main")
        (root/"main-only.txt").write_text("base branch only\n"); self.git(root,"add","."); self.git(root,"commit","-m","main advanced")
        self.git(root,"checkout","feature")
        missing = self.review(sid,"branch")
        self.assertEqual(missing["reason"],"default-branch-unavailable"); self.assertIn("main",missing["branches"])
        result = self.review(sid,"branch",base_branch="main")
        self.assertIn("+feature-change",result["diff"]); self.assertNotIn("main-only",result["diff"])
        self.git(root,"remote","add","origin","https://example.invalid/no-network")
        self.git(root,"update-ref","refs/remotes/origin/main","main")
        self.git(root,"symbolic-ref","refs/remotes/origin/HEAD","refs/remotes/origin/main")
        cached = self.review(sid,"branch")
        self.assertEqual(cached["base_branch"],"origin/main"); self.assertEqual(cached["diff"],result["diff"])
        self.assertEqual(self.review(sid,"branch",base_branch="does-not-exist")["reason"],"merge-base-unavailable")

    def test_unborn_binary_rename_modes_and_symlink(self):
        root, sid = self.repo(commit=False)
        self.assertIn("+original",self.review(sid)["diff"])
        self.git(root,"add","."); self.assertIn("+original",self.review(sid,"staged")["diff"])
        self.git(root,"commit","-m","initial")
        self.git(root,"mv","tracked.txt","renamed.txt")
        (root/"binary.bin").write_bytes(b"\x00\x01\x02")
        outside = self.base/"private-outside.txt"; outside.write_text("do-not-read-target\n")
        (root/"link").symlink_to(outside)
        diff = self.review(sid)["diff"]
        self.assertIn("rename from tracked.txt",diff); self.assertIn("Binary files",diff)
        self.assertIn("new file mode 120000",diff); self.assertNotIn("do-not-read-target",diff)

    def test_auth_scope_and_invalid_options(self):
        root, sid = self.repo()
        with self.assertRaises(urllib.error.HTTPError) as e: self.request(f"/sessions/{sid}/review",token="wrong")
        self.assertEqual(e.exception.code,401)
        with self.assertRaises(urllib.error.HTTPError) as e: self.review("missing")
        self.assertEqual(e.exception.code,404)
        for params in [{"base_branch":"--output=leak"},{"base_branch":"main\nHEAD"}]:
            with self.assertRaises(urllib.error.HTTPError): self.review(sid,"branch",**params)
        with self.assertRaises(urllib.error.HTTPError): self.review(sid,"commit")
        plain = self.create()["id"]
        self.assertEqual(self.review(plain)["reason"],"not-a-repository")
        # Reject a repository whose root is above the configured workspace.
        self.git(self.base,"init"); self.git(self.base,"add","workspace/"+root.name+"/tracked.txt")
        (self.workspace/"nested-in-parent").mkdir()
        parent = self.create(cwd=str(self.workspace/"nested-in-parent"))["id"]
        with self.assertRaises(urllib.error.HTTPError): self.review(parent)
        shutil.rmtree(self.base/".git")

    def test_whitespace_filter(self):
        root,sid=self.repo(); (root/"tracked.txt").write_text("  original  \n")
        self.assertIn("+  original",self.review(sid)["diff"])
        self.assertEqual(self.review(sid,hide_whitespace="true")["diff"],"")

    def commits(self, sid, **params):
        return self.request(f"/sessions/{sid}/review/commits?" + urllib.parse.urlencode(params))

    def test_commit_is_exact_snapshot_and_root_uses_empty_tree(self):
        root,sid=self.repo()
        initial=self.git(root,"rev-parse","HEAD")
        first=self.review(sid,"commit",commit=initial)
        self.assertIn("+original",first["diff"])
        self.assertEqual(first["commit"],initial)
        (root/"tracked.txt").write_text("committed value\n")
        self.git(root,"commit","-am","chosen commit")
        chosen=self.git(root,"rev-parse","HEAD")
        (root/"tracked.txt").write_text("index only\n");self.git(root,"add",".")
        (root/"tracked.txt").write_text("worktree only\n")
        (root/"untracked.txt").write_text("untracked only\n")
        diff=self.review(sid,"commit",commit=chosen[:12])["diff"]
        self.assertIn("-original",diff);self.assertIn("+committed value",diff)
        for text in ["index only","worktree only","untracked only"]:self.assertNotIn(text,diff)
        self.assertEqual(self.review(sid,"commit",commit=chosen.upper())["diff"],diff)
        self.assertEqual(self.git(root,"diff","--cached","--name-only"),"tracked.txt")

    def test_merge_commit_compares_first_parent_and_metadata(self):
        root,sid=self.repo()
        self.git(root,"checkout","-b","feature")
        (root/"feature.txt").write_text("already on first parent\n")
        self.git(root,"add",".");self.git(root,"commit","-m","feature")
        self.git(root,"checkout","-b","side","main")
        self.git(root,"mv","tracked.txt","renamed.txt")
        (root/"binary.bin").write_bytes(b"\x00\x01")
        (root/"removed.txt").write_text("will be deleted\n")
        self.git(root,"add",".");self.git(root,"commit","-m","side change")
        self.git(root,"checkout","feature");self.git(root,"merge","--no-ff","side","-m","merge side")
        sha=self.git(root,"rev-parse","HEAD")
        diff=self.review(sid,"commit",commit=sha)["diff"]
        self.assertNotIn("feature.txt",diff);self.assertIn("rename from tracked.txt",diff);self.assertIn("Binary files",diff)
        self.git(root,"rm","removed.txt");self.git(root,"commit","-m","delete")
        self.assertIn("deleted file mode",self.review(sid,"commit",commit=self.git(root,"rev-parse","HEAD"))["diff"])

    def test_branch_commit_list_is_bounded_relative_and_has_full_messages(self):
        root,sid=self.repo()
        base=self.git(root,"rev-parse","HEAD")
        self.git(root,"checkout","-b","feature")
        for i in range(105):self.git(root,"commit","--allow-empty","-m",f"subject {i}","-m",f"body {i}\nsecond line")
        self.git(root,"checkout","main");self.git(root,"commit","--allow-empty","-m","main-only")
        self.git(root,"checkout","feature")
        result=self.commits(sid,base_branch="main")
        self.assertEqual(result["type"],"success");self.assertEqual(len(result["commits"]),100)
        chosen=result["commits"][0]
        self.assertEqual(chosen["subject"],"subject 104");self.assertIn("body 104\nsecond line",chosen["message"])
        self.assertRegex(chosen["committed_at"],r"^\d{4}-\d{2}-\d{2}T")
        self.assertNotIn(base,[c["sha"] for c in result["commits"]])
        self.assertEqual(result["commits"][-1]["subject"],"subject 5")
        self.git(root,"remote","add","origin","https://example.invalid/no-network")
        self.git(root,"update-ref","refs/remotes/origin/main","main")
        self.git(root,"symbolic-ref","refs/remotes/origin/HEAD","refs/remotes/origin/main")
        self.assertEqual(self.commits(sid)["commits"],result["commits"])

    def test_commit_list_empty_default_unborn_and_scope(self):
        root,sid=self.repo()
        self.assertEqual(self.commits(sid)["reason"],"default-branch-unavailable")
        self.assertEqual(self.commits(sid,base_branch="main")["commits"],[])
        self.assertEqual(self.commits(sid,base_branch="missing")["reason"],"merge-base-unavailable")
        with self.assertRaises(urllib.error.HTTPError) as e:self.request(f"/sessions/{sid}/review/commits",token="wrong")
        self.assertEqual(e.exception.code,401)
        with self.assertRaises(urllib.error.HTTPError) as e:self.commits("missing")
        self.assertEqual(e.exception.code,404)
        (self.workspace/"no-repo-commits").mkdir()
        plain=self.create(cwd=str(self.workspace/"no-repo-commits"))["id"]
        self.assertEqual(self.commits(plain)["reason"],"not-a-repository")
        self.git(root,"checkout","--orphan","unborn")
        self.assertEqual(self.commits(sid,base_branch="main")["commits"],[])
        # The parent repo boundary applies to both read-only endpoints.
        self.git(self.base,"init")
        with self.assertRaises(urllib.error.HTTPError):self.commits(plain)
        shutil.rmtree(self.base/".git")

    def test_embedded_untracked_repository_is_omitted_without_breaking_file_diffs(self):
        root,sid=self.repo()
        nested=root/"nested-repo";nested.mkdir();self.git(nested,"init","-b","main")
        (nested/"inside.txt").write_text("nested content\n");self.git(nested,"add",".");self.git(nested,"commit","-m","nested")
        (root/"tracked.txt").write_text("working change\n")
        (root/"untracked.txt").write_text("new file\n")
        result=self.review(sid)
        self.assertIn("+working change",result["diff"]);self.assertIn("+new file",result["diff"])
        self.assertNotIn("nested content",result["diff"]);self.assertEqual(result["untracked_files_omitted"],1)

    def test_commit_rejects_revision_expressions_and_option_injection(self):
        root,sid=self.repo()
        for value in ["", "HEAD", "HEAD^", "main", "--output=leak", "a"*65, "012345\nHEAD", "0123456..HEAD", "deadbeef"]:
            with self.subTest(value=value),self.assertRaises(urllib.error.HTTPError):self.review(sid,"commit",commit=value)
        for value in ["--output=leak","main\nHEAD"]:
            with self.assertRaises(urllib.error.HTTPError):self.commits(sid,base_branch=value)

    def test_live_steer_keeps_the_current_aggregate_patch(self):
        root,sid=self.repo()
        self.request(f"/sessions/{sid}/messages",{"text":"slow"})
        fixture.Integration.wait_status(self,sid,"running")
        events=self.request(f"/sessions/{sid}/export")["events"]
        turn=next(e["params"]["turn"]["id"] for e in events if e["method"]=="turn/started")
        with sqlite3.connect(self.base/"data"/"remote-agent.sqlite") as db:
            db.execute("INSERT INTO events(session_id,data) VALUES(?,?)",(sid,json.dumps({"seq":0,"session_id":sid,"method":"turn/diff/updated","params":{"turnId":turn,"diff":"running aggregate"},"request_id":None,"created_at":1})))
        self.request(f"/sessions/{sid}/messages",{"text":"refine current approach","mode":"steer"})
        self.assertEqual(self.request(f"/sessions/{sid}")["session"]["status"],"running")
        current=self.review(sid,"last-turn")
        self.assertEqual((current["turn_id"],current["diff"]),(turn,"running aggregate"))
        echo=next(e for e in reversed(self.request(f"/sessions/{sid}/export")["events"]) if e["method"]=="user/message")
        self.assertEqual(echo["params"]["turnId"],turn)
        self.request(f"/sessions/{sid}/interrupt",{})

    def test_last_turn_is_not_a_git_comparison(self):
        root,sid=self.repo(); other=self.create(cwd=str(root))["id"]
        (root/"tracked.txt").write_text("unrelated working tree\n")
        self.assertIsNone(self.review(sid,"last-turn")["diff"])
        database = next((self.base/"data").glob("*.sqlite*"))
        with sqlite3.connect(database) as db:
            for method,params in [("turn/started",{"turn":{"id":"first"}}),("turn/diff/updated",{"turnId":"first","diff":"aggregate patch"})]:
                db.execute("INSERT INTO events(session_id,data) VALUES(?,?)",(sid,json.dumps({"seq":0,"session_id":sid,"method":method,"params":params,"request_id":None,"created_at":1})))
        self.assertEqual(self.review(sid,"last-turn")["diff"],"aggregate patch")
        self.assertIsNone(self.review(other,"last-turn")["diff"])
        with sqlite3.connect(database) as db:
            db.execute("INSERT INTO events(session_id,data) VALUES(?,?)",(sid,json.dumps({"seq":0,"session_id":sid,"method":"turn/started","params":{"turn":{"id":"second"}},"request_id":None,"created_at":2})))
        self.assertEqual((self.review(sid,"last-turn")["turn_id"],self.review(sid,"last-turn")["diff"]),("second",None))

if __name__ == "__main__": unittest.main()
