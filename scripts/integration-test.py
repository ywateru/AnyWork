#!/usr/bin/env python3
"""Exercise the real Rust HTTP server and external plugin process without API usage."""
import sqlite3, http.client, json, os, pathlib, socket, subprocess, tempfile, time, unittest, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = "integration-test-token-not-for-production"

class Integration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="remote-agent-integration-")
        cls.base = pathlib.Path(cls.temp.name)
        cls.workspace = cls.base / "workspace"; cls.workspace.mkdir()
        (cls.workspace / "README.md").write_text("# AnyWork\n")
        cls.plugins = cls.base / "plugins"; cls.plugins.mkdir()
        (cls.plugins / "fixture.json").write_text(json.dumps({"id":"fixture","name":"Fixture","protocol_version":1,"command":"python3","args":[str(ROOT / "scripts/fake-agent.py")],"capabilities":["chat","approvals","questions","resume","models"]}))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0)); cls.port = sock.getsockname()[1]
        cls.log = open(cls.base / "server.log", "w+")
        cls.start()

    @classmethod
    def start(cls):
        binary = os.environ.get("ANYWORK_BINARY", os.environ.get("REMOTE_AGENT_BINARY", str(ROOT / "target/debug/anywork")))
        cls.process = subprocess.Popen([binary,"--codex-discovery","false","--bind",f"127.0.0.1:{cls.port}","--workspace",str(cls.workspace),"--data-dir",str(cls.base/"data"),"--plugins-dir",str(cls.plugins),"--web-dir",str(ROOT/"web/dist"),"--token",TOKEN], env={**os.environ,"FAKE_AGENT_STATE_DIR":str(cls.base/"fixture-state"),"FAKE_AGENT_REQUIREMENTS":str(cls.base/"fixture-requirements.json"),"FAKE_AGENT_CALLS":str(cls.base/"fixture-calls.jsonl")}, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try: urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/health",timeout=1); return
            except OSError: time.sleep(.05)
        cls.log.seek(0); raise RuntimeError(cls.log.read())

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.wait(timeout=10); cls.log.close(); cls.temp.cleanup()

    def request(self, path, data=None, method=None, token=TOKEN):
        headers={"Authorization":f"Bearer {token}"}
        if data is not None: headers["Content-Type"]="application/json"
        req=urllib.request.Request(f"http://127.0.0.1:{self.port}/api"+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
        with urllib.request.urlopen(req,timeout=10) as response: return json.load(response)

    def create(self, **kwargs):
        return self.request("/sessions",{"cwd":str(self.workspace),"agent":"fixture",**kwargs})["session"]

    def wait_status(self, id, status):
        for _ in range(150):
            session=self.request(f"/sessions/{id}")["session"]
            if session["status"]==status: return session
            time.sleep(.02)
        self.fail(f"Status did not become {status}: {session}")

    def approval(self, text="approval", **kwargs):
        sid=self.create(**kwargs)["id"]
        self.request(f"/sessions/{sid}/messages",{"text":text});self.wait_status(sid,"waiting")
        event=next(e for e in reversed(self.request(f"/sessions/{sid}/export")["events"]) if e.get("request_id")==700)
        return sid,event

    def received_approval(self, sid):
        self.wait_status(sid,"idle")
        events=self.request(f"/sessions/{sid}/export")["events"]
        text=next(e["params"]["item"]["text"] for e in reversed(events) if e["method"]=="item/completed" and e["params"]["item"]["type"]=="agentMessage")
        return json.loads(text.split("\n",1)[1])

    def test_auth_and_plugin_discovery(self):
        with self.assertRaises(urllib.error.HTTPError) as result: self.request("/sessions",token="wrong")
        self.assertEqual(result.exception.code,401)
        self.assertIn("fixture",[p["id"] for p in self.request("/plugins")["plugins"]])
        self.assertFalse("command" in self.request("/plugins")["plugins"][0])

    def test_message_feedback_is_local_persistent_isolated_and_resettable(self):
        import urllib.parse
        sid=self.create()["id"];other=self.create()["id"]
        base=f"/sessions/{sid}/feedback"
        message="native/turn:42/assistant-回答"
        path=base+"/"+urllib.parse.quote(message,safe="")
        listing=self.request(base)
        self.assertEqual(listing["feedback"],[])
        self.assertEqual(listing["scope"],"local")
        self.assertEqual(listing["tags"],["incorrect-or-incomplete","not-what-i-asked-for","slow-or-buggy","style-or-tone","safety-or-legal-concern","other"])
        self.assertIsNone(self.request(path)["feedback"])
        before=self.request(f"/sessions/{sid}")["session"]
        events_before=self.request(f"/sessions/{sid}/export")["events"]
        first=self.request(path,{"rating":"bad","tags":["incorrect","other","incorrect"],"text":"  保留本地反馈  "},"PUT")["feedback"]
        self.assertEqual((first["session_id"],first["message_id"],first["rating"]),(sid,message,"bad"))
        self.assertEqual(first["tags"],["incorrect","other"])
        self.assertEqual(first["text"],"保留本地反馈")
        self.assertEqual(self.request(path)["feedback"],first)
        # Feedback does not invoke an agent, append a conversation event, or reorder the sidebar.
        self.assertEqual(self.request(f"/sessions/{sid}")["session"],before)
        self.assertEqual(self.request(f"/sessions/{sid}/export")["events"],events_before)
        time.sleep(.01)
        changed=self.request(path,{"rating":"good"},"PUT")["feedback"]
        self.assertEqual(changed["created_at"],first["created_at"])
        self.assertGreater(changed["updated_at"],first["updated_at"])
        self.assertEqual((changed["rating"],changed["tags"],changed["text"]),("good",[],None))
        self.assertEqual(self.request(base)["feedback"],[changed])
        self.assertEqual(self.request(f"/sessions/{sid}/export")["feedback"],[changed])
        other_path=f"/sessions/{other}/feedback/"+urllib.parse.quote(message,safe="")
        self.assertIsNone(self.request(other_path)["feedback"])
        self.request(other_path,{"rating":"bad","text":"independent"},"PUT")
        self.assertEqual(self.request(path)["feedback"],changed)
        for method,data in [("GET",None),("PUT",{"rating":"good"}),("DELETE",None)]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(path,data,method,token="bad")
            self.assertEqual(e.exception.code,401)
        with self.assertRaises(urllib.error.HTTPError) as e:self.request("/sessions/missing/feedback/message",{"rating":"good"},"PUT")
        self.assertEqual(e.exception.code,404)
        invalid=[{"rating":"positive"},{"rating":"bad","tags":["unknown"]},{"rating":"good","tags":["other"]*7},{"rating":"bad","text":"字"*4001}]
        for payload in invalid:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(path,payload,"PUT")
            self.assertEqual(e.exception.code,400)
        for message_id in [" " ,"x"*513,"control\ncharacter"]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(base+"/"+urllib.parse.quote(message_id,safe=""),{"rating":"good"},"PUT")
            self.assertEqual(e.exception.code,400)
        # Validation failures leave the previously saved feedback intact.
        self.assertEqual(self.request(path)["feedback"],changed)
        native_path=base+"/native-six-choices"
        for tag in listing["tags"]:
            saved=self.request(native_path,{"rating":"bad","tags":[tag]},"PUT")["feedback"]
            self.assertEqual(saved["tags"],[tag])
            self.assertEqual(self.request(native_path)["feedback"],saved)
        # Safety/legal is an ordinary local row and never invokes an agent or vendor report.
        self.request(native_path,{"rating":"bad","tags":["safety-or-legal-concern"]},"PUT")
        self.assertEqual(self.request(base)["scope"],"local")
        self.assertEqual(self.request(f"/sessions/{sid}/export")["events"],events_before)
        self.request(native_path,method="DELETE")
        for tag in ["incorrect","incomplete","unhelpful"]:
            self.assertEqual(self.request(native_path,{"rating":"bad","tags":[tag]},"PUT")["feedback"]["tags"],[tag])
        self.request(native_path,method="DELETE")
        boundary_path=base+"/unicode-boundary"
        boundary_text="😀"*4000
        self.assertEqual(self.request(boundary_path,{"rating":"bad","text":boundary_text},"PUT")["feedback"]["text"],boundary_text)
        self.request(boundary_path,method="DELETE")
        with self.assertRaises(urllib.error.HTTPError) as e:self.request(path,{"rating":"good","text":"a"*70000},"PUT")
        self.assertEqual(e.exception.code,413)
        self.assertEqual(self.request(path,method="DELETE"),{"ok":True})
        self.assertEqual(self.request(path,method="DELETE"),{"ok":True})
        self.assertIsNone(self.request(path)["feedback"])
        self.assertEqual(self.request(base)["feedback"],[])
        self.assertEqual(self.request(other_path)["feedback"]["text"],"independent")
        self.request(f"/sessions/{other}",method="DELETE")
        with sqlite3.connect(self.base/"data"/"remote-agent.sqlite") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM message_feedback WHERE session_id=?",(other,)).fetchone()[0],0)
        with self.assertRaises(urllib.error.HTTPError) as e:self.request(other_path)
        self.assertEqual(e.exception.code,404)

    def test_composer_native_modes_and_remote_file_boundaries(self):
        s=self.create();sid=s['id'];base=f'/sessions/{sid}'
        state=self.request(base+'/composer');self.assertFalse(state['plan']);self.assertIsNone(state['goal'])
        self.assertTrue(state['plan_available'])
        self.request(base+'/composer',{'action':'plan','enabled':True},'POST')
        self.assertTrue(self.request(base+'/composer')['plan'])
        self.request(base+'/composer',{'action':'goal','objective':'通过测试完成目标'},'POST')
        self.assertEqual(self.request(base+'/composer')['goal']['objective'],'通过测试完成目标')
        paused=self.request(base+'/composer',{'action':'goal_status','status':'paused'})['goal']
        self.assertEqual((paused['status'],paused['objective']),('paused','通过测试完成目标'))
        self.request(base+'/composer',{'action':'goal_status','status':'active'})
        self.assertEqual(self.request(base+'/composer')['goal']['status'],'active')
        self.request(base+'/composer',{'action':'clear_goal'},'POST')
        self.assertIsNone(self.request(base+'/composer')['goal'])
        self.request(base+'/composer',{'action':'plan','enabled':False},'POST')
        self.assertFalse(self.request(base+'/composer')['plan'])
        with self.assertRaises(urllib.error.HTTPError):self.request(base+'/composer',{'action':'goal','objective':'  '},'POST')
        remote=self.workspace/'README.md'
        self.request(base+'/messages',{'text':'read remote','attachments':[str(remote)]})
        self.wait_status(sid,'idle')
        # Remote files follow the session cwd, not the server-wide workspace.
        nested=self.workspace/'composer-nested';nested.mkdir(exist_ok=True)
        narrow=self.create(cwd=str(nested))
        with self.assertRaises(urllib.error.HTTPError):self.request('/sessions/'+narrow['id']+'/messages',{'text':'outside cwd','attachments':[str(remote)]})
        outside=self.base/'private.txt';outside.write_text('not allowed')
        link=self.workspace/'composer-link.txt';link.symlink_to(outside)
        for path in [outside,link]:
            with self.assertRaises(urllib.error.HTTPError):self.request(base+'/messages',{'text':'outside','attachments':[str(path)]})
        self.request(base,{'archived':True},'PATCH')
        with self.assertRaises(urllib.error.HTTPError):self.request(base+'/composer',{'action':'goal','objective':'archived'},'POST')

    def test_native_service_tiers_preserve_settings_and_validate_model_compatibility(self):
        sid=self.create()["id"];base=f"/sessions/{sid}"
        state=self.request(base+"/composer")
        self.assertEqual(state["service_tier"],"fixture-standard")
        self.assertTrue(state["service_tier_available"])
        self.assertEqual(state["service_tier_access"],{"fast":True,"ultrafast":True})
        model=next(row for row in state["models"] if row["model"]=="fixture")
        self.assertEqual(model["defaultServiceTier"],"fixture-standard")
        self.assertEqual(model["serviceTiers"][1],{"id":"fixture-priority","name":"fixture-priority","description":"Native fixture tier fixture-priority"})
        thread=self.request(base)["session"]["thread_id"]
        self.request(base+"/composer",{"action":"plan","enabled":True})
        selected=self.request(base+"/composer",{"action":"settings","service_tier":"fixture-priority"})
        self.assertEqual(selected["service_tier"],"fixture-priority")
        self.assertTrue(selected["plan"])
        self.request(base+"/composer",{"action":"settings","effort":"high"})
        self.assertEqual(self.request(base+"/composer")["service_tier"],"fixture-priority")
        self.request(base+"/messages",{"text":"inherit native tier"});self.wait_status(sid,"idle")
        current=self.request(base+"/composer")
        self.assertEqual((current["model"],current["effort"],current["service_tier"]),("fixture","high","fixture-priority"))
        self.assertEqual(self.request(base)["session"]["thread_id"],thread)
        self.assertEqual(self.request(base)["session"]["policy"],"manual")
        for tier in ["priority","default","","fixture-economy","fixture-policy-denied"]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(base+"/composer",{"action":"settings","service_tier":tier})
            self.assertEqual(e.exception.code,400)
            self.assertEqual(self.request(base+"/composer")["service_tier"],"fixture-priority")
        self.request(base+"/messages",{"text":"slow"});self.wait_status(sid,"running")
        for tier in [None,"fixture-standard"]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(base+"/composer",{"action":"settings","service_tier":tier})
            self.assertEqual(e.exception.code,409)
        self.request(base+"/interrupt",{});self.wait_status(sid,"idle")
        # A model change must explicitly address an incompatible inherited tier.
        with self.assertRaises(urllib.error.HTTPError):self.request(base+"/composer",{"action":"settings","model":"fixture-fast","effort":"low"})
        self.assertEqual(self.request(base+"/composer")["model"],"fixture")
        switched=self.request(base+"/composer",{"action":"settings","model":"fixture-fast","effort":"low","service_tier":"fixture-economy"})
        self.assertEqual((switched["model"],switched["service_tier"]),("fixture-fast","fixture-economy"))
        cleared=self.request(base+"/composer",{"action":"settings","service_tier":None})
        self.assertIsNone(cleared["service_tier"])
        self.assertEqual(next(row for row in cleared["models"] if row["model"]=="fixture-fast")["defaultServiceTier"],"fixture-economy")
        self.request(base+"/composer",{"action":"settings","effort":"medium"})
        self.assertIsNone(self.request(base+"/composer")["service_tier"])
        self.request(base+"/messages",{"text":"inherit cleared tier"});self.wait_status(sid,"idle")
        self.assertIsNone(self.request(base+"/composer")["service_tier"])
        legacy=self.request(base+"/composer",{"action":"settings","model":"fixture-legacy","effort":"low"})
        self.assertFalse(legacy["service_tier_available"])
        with self.assertRaises(urllib.error.HTTPError):self.request(base+"/composer",{"action":"settings","service_tier":"fixture-standard"})

    def test_service_tier_requirements_are_enforced_without_guessing_account_access(self):
        sid=self.create()["id"];base=f"/sessions/{sid}"
        requirements=self.base/"fixture-requirements.json"
        try:
            requirements.write_text(json.dumps({"requirements":{"featureRequirements":{"fast_mode":False,"ultrafast_mode":True}}}))
            state=self.request(base+"/composer")
            self.assertEqual(state["service_tier_access"],{"fast":False,"ultrafast":False})
            self.assertFalse(state["service_tier_available"])
            self.assertEqual(next(row for row in state["models"] if row["model"]=="fixture")["serviceTiers"],[])
            self.assertEqual([tier["id"] for row in state["models"] if row["model"]=="fixture-speed-matrix" for tier in row["serviceTiers"]],["default","flex"])
            for tier in ["fixture-standard","fixture-priority"]:
                with self.assertRaises(urllib.error.HTTPError):self.request(base+"/composer",{"action":"settings","service_tier":tier})
            self.assertIsNone(self.request(base+"/composer",{"action":"settings","service_tier":None})["service_tier"])
            requirements.write_text(json.dumps({"requirements":{"featureRequirements":{"fast_mode":False}},"supportsIndependentSpeedModes":True}))
            independent=self.request(base+"/composer")
            self.assertEqual(independent["service_tier_access"],{"fast":False,"ultrafast":True})
            self.assertEqual([tier["id"] for row in independent["models"] if row["model"]=="fixture-speed-matrix" for tier in row["serviceTiers"]],["default","flex","ultrafast"])
            requirements.write_text(json.dumps({"requirements":{"featureRequirements":{"fast_mode":True,"ultrafast_mode":False}},"supportsIndependentSpeedModes":True}))
            self.assertEqual(self.request(base+"/composer")["service_tier_access"],{"fast":True,"ultrafast":False})
            requirements.write_text(json.dumps({"_fixture_error":True}))
            unavailable=self.request(base+"/composer")
            self.assertIsNone(unavailable["service_tier_access"])
            self.assertFalse(unavailable["service_tier_available"])
            self.assertIn("unavailable",unavailable["service_tier_error"])
            self.assertEqual([tier["id"] for row in unavailable["models"] if row["model"]=="fixture-speed-matrix" for tier in row["serviceTiers"]],["default"])
            with self.assertRaises(urllib.error.HTTPError):self.request(base+"/composer",{"action":"settings","service_tier":"fixture-priority"})
            self.request(base+"/composer",{"action":"settings","service_tier":None})
            self.request(base+"/composer",{"action":"settings","effort":"high"})
        finally:
            requirements.unlink(missing_ok=True)

    def test_native_model_and_effort_changes_preserve_thread_and_allow_active_effort(self):
        s=self.create();sid=s['id'];base=f'/sessions/{sid}'
        state=self.request(base+'/composer')
        self.assertTrue(state['settings_available'])
        self.assertEqual((state['model'],state['effort']),('fixture','medium'))
        self.assertEqual(state['models'][0]['supportedReasoningEfforts'][2]['reasoningEffort'],'high')
        changed=self.request(base+'/composer',{'action':'settings','effort':'high'})
        self.assertEqual((changed['model'],changed['effort']),('fixture','high'))
        self.request(base+'/composer',{'action':'plan','enabled':True})
        self.assertEqual(self.request(base+'/composer')['effort'],'high')
        for settings in [{'model':'fixture-fast'}, {'model':'missing'}, {'effort':'unsupported'}, {}]:
            with self.assertRaises(urllib.error.HTTPError):self.request(base+'/composer',{'action':'settings',**settings})
        changed=self.request(base+'/composer',{'action':'settings','model':'fixture-fast','effort':'low','service_tier':None})
        self.assertEqual((changed['model'],changed['effort']),('fixture-fast','low'))
        self.assertTrue(changed['plan'])
        self.assertEqual(self.request(base)['session']['model'],'fixture-fast')
        before=self.request(base)['session']['thread_id']
        self.request(base+'/messages',{'text':'hello after model change'})
        self.wait_status(sid,'idle')
        self.assertEqual(self.request(base)['session']['thread_id'],before)
        self.assertEqual(self.request(base+'/composer')['effort'],'low')
        self.request(base+'/messages',{'text':'slow'})
        self.wait_status(sid,'running')
        self.assertEqual(self.request(base+'/composer',{'action':'settings','effort':'medium'})['effort'],'medium')
        self.assertEqual(self.request(base)['session']['status'],'running')
        for change in [{'action':'settings','model':'fixture'},{'action':'plan','enabled':False}]:
            with self.assertRaises(urllib.error.HTTPError) as denied:self.request(base+'/composer',change)
            self.assertEqual(denied.exception.code,409)
        self.request(base+'/interrupt',{})
        self.wait_status(sid,'idle')

    def test_streaming_and_sse_cursor(self):
        s=self.create(); sid=s["id"]
        self.request(f"/sessions/{sid}/messages",{"text":"hello"})
        self.wait_status(sid,"idle")
        events=self.request(f"/sessions/{sid}/export")["events"]
        self.assertIn("item/agentMessage/delta",[e["method"] for e in events])
        polled=self.request(f"/sessions/{sid}/events/poll?after={events[-2]['seq']}")["events"]
        self.assertEqual([e["seq"] for e in polled],[events[-1]["seq"]])
        self.assertEqual(self.request(f"/sessions/{sid}/events/poll?after={events[-1]['seq']}")["events"],[])
        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.request(f"/sessions/{sid}/events/poll",token="wrong")
        self.assertEqual(denied.exception.code,401)
        cursor=events[-2]["seq"]
        connection=http.client.HTTPConnection("127.0.0.1",self.port,timeout=5)
        connection.request("GET",f"/api/sessions/{sid}/events?after={cursor}",headers={"Authorization":f"Bearer {TOKEN}"})
        response=connection.getresponse();self.assertEqual(response.status,200)
        while True:
            line=response.readline().decode()
            if line.startswith("data:"):
                self.assertEqual(json.loads(line[5:])["seq"],events[-1]["seq"]);break
        connection.close()

    def test_history_latest_message_pages_preserve_pending_state_and_live_cursor(self):
        sid=self.create()["id"]
        for i in range(8):
            self.request(f"/sessions/{sid}/messages",{"text":f"history {i}"});self.wait_status(sid,"idle")
        latest=self.request(f"/sessions/{sid}/history?paged=true&limit=3")
        self.assertEqual([e["params"]["text"] for e in latest["events"] if e["method"]=="user/message"],["history 7"])
        live_cursor=latest["latest_seq"]
        self.request(f"/sessions/{sid}/messages",{"text":"approval"});self.wait_status(sid,"waiting")
        pending=self.request(f"/sessions/{sid}/history?paged=true&limit=1")
        self.assertTrue(any(e.get("request_id")==700 for e in pending["events"]))
        events=latest["events"];cursor=latest["next_cursor"];seen=set()
        while cursor:
            self.assertNotIn(cursor,seen);seen.add(cursor)
            page=self.request(f"/sessions/{sid}/history?paged=true&limit=3&cursor={cursor}")
            events=page["events"]+events;cursor=page["next_cursor"]
        events+=self.request(f"/sessions/{sid}/events/poll?after={live_cursor}")["events"]
        by_seq={e['seq']:e for e in events}
        raw=self.request(f"/sessions/{sid}/export")["events"]
        for event in raw:
            if event['method'] in ['user/message','item/completed'] and event['params'].get('item',{}).get('type')!='userMessage':
                self.assertEqual(by_seq[event['seq']],event)
        self.assertFalse(any(e['method'].endswith('/delta') for e in events))
        self.request(f"/sessions/{sid}/respond",{"request_id":700,"accept":True});self.wait_status(sid,"idle")

    def test_large_tool_results_load_on_demand_and_remain_session_scoped(self):
        sid=self.create()["id"]
        self.request(f"/sessions/{sid}/messages",{"text":"large"});self.wait_status(sid,"idle")
        raw=self.request(f"/sessions/{sid}/export")["events"]
        page=self.request(f"/sessions/{sid}/history?paged=true")
        self.assertLess(len(json.dumps(page)),len(json.dumps(raw))//5)
        tool=next(e for e in page['events'] if e['params'].get('item',{}).get('history_detail'))
        detail=self.request(f"/sessions/{sid}/history/item?seq={tool['seq']}")['item']
        self.assertEqual(detail,next(e['params']['item'] for e in raw if e['seq']==tool['seq']))
        other=self.create()['id']
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{other}/history/item?seq={tool['seq']}")

    def test_manual_auto_approval_and_stale_response(self):
        s=self.create();sid=s["id"]
        self.request(f"/sessions/{sid}/messages",{"text":"approval"});self.wait_status(sid,"waiting")
        self.request(f"/sessions/{sid}/respond",{"request_id":700,"accept":True});self.wait_status(sid,"idle")
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/respond",{"request_id":700,"accept":True})
        s=self.create(policy="auto");sid=s["id"]
        self.request(f"/sessions/{sid}/messages",{"text":"approval"});self.wait_status(sid,"idle")
        self.assertTrue(any(e["params"].get("automatic") for e in self.request(f"/sessions/{sid}/export")["events"]))

    def test_approval_scoped_decisions_forward_exact_results_and_reject_duplicates(self):
        for text in ["approval command","approval file"]:
            for decision in ["accept","acceptForSession","decline","cancel"]:
                sid,event=self.approval(text)
                result={"decision":decision}
                self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
                self.assertEqual(self.received_approval(sid),{"approvalResult":result,"approvalMethod":event["method"]})
                with self.assertRaises(urllib.error.HTTPError) as e:self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
                self.assertEqual(e.exception.code,409)
        for scope in ["turn","session"]:
            sid,event=self.approval("approval permissions")
            result={"permissions":event["params"]["permissions"],"scope":scope,"strictAutoReview":True}
            self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
            self.assertEqual(self.received_approval(sid)["approvalResult"],result)
        for scope in ["turn","session"]:
            sid,_=self.approval("approval permissions")
            result={"permissions":{},"scope":scope}
            self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
            self.assertEqual(self.received_approval(sid)["approvalResult"],result)
        # Competing browser clicks share the same transition, including before turn completion.
        import concurrent.futures, threading
        sid,_=self.approval();barrier=threading.Barrier(3)
        def submit():
            barrier.wait()
            try:
                self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"decision":"accept"}})
                return 200
            except urllib.error.HTTPError as e:return e.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            calls=[pool.submit(submit) for _ in range(2)];barrier.wait()
            self.assertEqual(sorted(call.result(timeout=10) for call in calls),[200,409])
        self.assertEqual(self.received_approval(sid)["approvalResult"],{"decision":"accept"})

    def test_approval_errors_do_not_consume_the_pending_request(self):
        sid,_=self.approval()
        base=f"/sessions/{sid}/respond"
        bodies=[
            {"request_id":700},
            {"request_id":700,"accept":None},
            {"request_id":700,"accept":"yes"},
            {"request_id":700,"result":None},
            {"request_id":700,"result":"accept"},
            {"request_id":700,"result":{"decision":"accept"},"accept":True},
            {"request_id":700,"result":{"decision":"accept"},"accept":None},
            {"request_id":700,"result":{"decision":"accept"},"unknown":True},
            {"request_id":700,"result":{"decision":"forever"}},
            {"request_id":700,"result":{"decision":"accept","scope":"session"}},
            {"request_id":700,"result":{"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["sh"]}}}},
        ]
        with self.assertRaises(urllib.error.HTTPError) as e:self.request(base,{"request_id":700,"accept":True},token="bad")
        self.assertEqual(e.exception.code,401)
        for body in bodies:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(base,body)
            self.assertEqual(e.exception.code,400)
            self.assertEqual(self.request(f"/sessions/{sid}")["session"]["status"],"waiting")
        events=self.request(f"/sessions/{sid}/export")["events"]
        self.assertFalse(any(e["method"]=="serverRequest/resolved" for e in events))
        self.request(base,{"request_id":700,"accept":False})
        self.assertEqual(self.received_approval(sid)["approvalResult"],{"decision":"decline"})
        sid,event=self.approval("approval permissions")
        requested=event["params"]["permissions"]
        for result in [{"permissions":{"network":{"enabled":True}},"scope":"session"},{"permissions":{"fileSystem":{"write":["/"]},"network":{"enabled":True}},"scope":"turn"},{"permissions":requested,"scope":"forever"},{"permissions":requested,"scope":None},{"permissions":requested,"strictAutoReview":"yes"},{"permissions":requested,"unknown":True}]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
            self.assertEqual(e.exception.code,400)
            self.assertEqual(self.request(f"/sessions/{sid}")["session"]["status"],"waiting")
        self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"permissions":requested}})
        self.assertEqual(self.received_approval(sid)["approvalResult"],{"permissions":requested,"scope":"turn"})

    def test_approval_proposals_and_authoritative_decision_lists(self):
        sid,event=self.approval("approval exec")
        for amendment in [["npm"],["npm","install","--global"]]:
            with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":amendment}}}})
        result={"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":event["params"]["proposedExecpolicyAmendment"]}}}
        self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
        self.assertEqual(self.received_approval(sid)["approvalResult"],result)
        for action in ["allow","deny"]:
            sid,event=self.approval("approval network")
            for amendment in [{"host":"other.com","action":action},{"host":"example.com","action":"allow","extra":True}]:
                with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"decision":{"applyNetworkPolicyAmendment":{"network_policy_amendment":amendment}}}})
            result={"decision":{"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"example.com","action":action}}}}
            self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
            self.assertEqual(self.received_approval(sid)["approvalResult"],result)
        sid,event=self.approval("approval whitelist")
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/respond",{"request_id":700,"accept":True})
        result={"decision":event["params"]["availableDecisions"][0]}
        self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":result})
        self.assertEqual(self.received_approval(sid)["approvalResult"],result)
        sid,_=self.approval("approval empty")
        for decision in ["accept","acceptForSession","decline","cancel"]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"decision":decision}})
            self.assertEqual(e.exception.code,400)
        self.assertEqual(self.request(f"/sessions/{sid}")["session"]["status"],"waiting")
        self.request(f"/sessions/{sid}/interrupt",{});self.wait_status(sid,"idle")

    def test_auto_approval_keeps_once_scope_and_waits_without_accept(self):
        for text in ["approval command","approval file","approval network","approval permissions","approval before response"]:
            sid=self.create(policy="auto")["id"]
            self.request(f"/sessions/{sid}/messages",{"text":text})
            received=self.received_approval(sid)
            expected={"decision":"accept"}
            if text=="approval permissions":
                event=next(e for e in self.request(f"/sessions/{sid}/export")["events"] if e.get("request_id")==700)
                expected={"permissions":event["params"]["permissions"],"scope":"turn"}
            self.assertEqual(received["approvalResult"],expected)
        sid,_=self.approval("approval restricted",policy="auto")
        events=self.request(f"/sessions/{sid}/export")["events"]
        self.assertFalse(any(e["params"].get("automatic") for e in events))
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/respond",{"request_id":700,"accept":True})
        self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"decision":"acceptForSession"}})
        self.assertEqual(self.received_approval(sid)["approvalResult"],{"decision":"acceptForSession"})
        sid,_=self.approval("approval unknown",policy="auto")
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/respond",{"request_id":700,"result":{"decision":"accept"}})
        self.assertEqual(self.request(f"/sessions/{sid}")["session"]["status"],"waiting")
        self.request(f"/sessions/{sid}/interrupt",{});self.wait_status(sid,"idle")

    def test_question_and_interrupt_and_busy(self):
        s=self.create();sid=s["id"]
        self.request(f"/sessions/{sid}/messages",{"text":"question"});self.wait_status(sid,"waiting")
        self.request(f"/sessions/{sid}/respond",{"request_id":701,"result":{"answers":{"color":{"answers":["深色"]}}}});self.wait_status(sid,"idle")
        self.request(f"/sessions/{sid}/messages",{"text":"slow"});self.wait_status(sid,"running")
        with self.assertRaises(urllib.error.HTTPError) as result:self.request(f"/sessions/{sid}/messages",{"text":"duplicate"})
        self.assertEqual(result.exception.code,409)
        with self.assertRaises(urllib.error.HTTPError) as result:self.request(f"/sessions/{sid}",{"model":"fixture"},"PATCH")
        self.assertEqual(result.exception.code,409)
        self.request(f"/sessions/{sid}/interrupt",{});self.wait_status(sid,"idle")
        self.request(f"/sessions/{sid}",{"model":"fixture"},"PATCH")
        self.assertEqual(self.request(f"/sessions/{sid}")["session"]["model"],"fixture")

    def test_queue_if_busy_uses_server_state_instead_of_stale_client_mode(self):
        sid = self.create()["id"]
        base = f"/sessions/{sid}"
        # A stale busy UI must not leave an idle agent's message waiting.
        result = self.request(base + "/messages", {"text": "idle delivery", "mode": "queue", "queue_if_busy": True})
        self.assertNotIn("queued", result)
        self.wait_status(sid, "idle")
        self.request(base + "/messages", {"text": "slow"})
        self.wait_status(sid, "running")
        # A stale idle UI must not steer an agent when queueing is enabled.
        result = self.request(base + "/messages", {"text": "queued by actual state", "mode": "steer", "queue_if_busy": True})
        self.assertTrue(result["queued"])
        self.assertEqual([item["text"] for item in result["items"]], ["queued by actual state"])
        self.request(base + "/messages", {"text": "finish current", "mode": "steer"})
        for _ in range(100):
            if not self.request(base + "/queue")["items"]: break
            time.sleep(.05)
        self.wait_status(sid, "idle")
        self.assertEqual(self.request(base + "/queue")["items"], [])

    def test_queue_fifo_edit_delete_steer_and_stop(self):
        sid=self.create()["id"]
        base=f"/sessions/{sid}"
        self.request(base+"/messages",{"text":"slow"});self.wait_status(sid,"running")
        for text in ("first", "second", "remove me"):
            self.request(base+"/messages",{"text":text,"mode":"queue"})
        items=self.request(base+"/queue")["items"]
        self.assertEqual([i["text"] for i in items],["first","second","remove me"])
        self.request(base+"/queue",{"action":"edit","id":items[0]["id"],"text":"edited"})
        self.request(base+"/queue",{"action":"delete","id":items[2]["id"]})
        self.request(base+"/messages",{"text":"finish current", "mode":"steer"})
        for _ in range(100):
            if not self.request(base+"/queue")["items"]:break
            time.sleep(.05)
        self.assertEqual(self.request(base+"/queue")["items"],[])
        self.wait_status(sid,"idle")
        events=self.request(base+"/export")["events"]
        texts=[e["params"].get("text") for e in events if e["method"]=="user/message"]
        self.assertLess(texts.index("edited"),texts.index("second"))
        self.request(base+"/messages",{"text":"slow"});self.wait_status(sid,"running")
        self.request(base+"/messages",{"text":"retained", "mode":"queue"})
        self.request(base+"/interrupt",{});self.wait_status(sid,"idle")
        time.sleep(1.2)
        queue=self.request(base+"/queue")
        self.assertTrue(queue["paused"]);self.assertEqual(len(queue["items"]),1)
        self.request(base+"/queue",{"action":"steer","id":queue["items"][0]["id"]})
        self.wait_status(sid,"idle")
        self.assertEqual(self.request(base+"/queue")["items"],[])
        with self.assertRaises(urllib.error.HTTPError):
            self.request(base+"/messages",{"text":"bad", "mode":"queue","attachments":["/etc/passwd"]})

    def test_queue_edit_moves_to_composer_and_preserves_position(self):
        sid=self.create()["id"]; base=f"/sessions/{sid}"
        other=self.create()["id"]
        self.request(base+"/messages",{"text":"slow"});self.wait_status(sid,"running")
        for text in ("first", "middle", "last"):
            self.request(base+"/messages",{"text":text,"mode":"queue"})
        before=self.request(base+"/queue")["items"]
        middle=before[1]
        moved=self.request(base+"/queue",{"action":"take","id":middle["id"]})
        self.assertEqual([item["text"] for item in moved["items"]],["first","last"])
        self.assertEqual(moved["editing"],middle)
        for path,data in ((base,{"action":"take","id":before[0]["id"]}),
                          (f"/sessions/{other}",{"action":"restore","id":middle["id"]}),
                          (base,{"action":"replace","id":middle["id"],"text":"","attachments":[]})):
            with self.assertRaises(urllib.error.HTTPError):self.request(path+"/queue",data)
        self.assertEqual(self.request(base+"/queue")["editing"],middle)
        restored=self.request(base+"/queue",{"action":"restore","id":middle["id"]})
        self.assertEqual(restored["items"],before)
        self.assertIsNone(restored["editing"])
        self.request(base+"/queue",{"action":"take","id":middle["id"]})
        revised=self.request(base+"/queue",{"action":"replace","id":middle["id"],"text":"revised middle","attachments":[]})
        self.assertEqual([item["id"] for item in revised["items"]],[item["id"] for item in before])
        self.assertEqual(revised["items"][1]["text"],"revised middle")
        self.assertIsNone(revised["editing"])
        self.assertEqual(self.request(base)["session"]["status"],"running")

    def test_unconfirmed_queue_message_cannot_be_edited_or_sent_again(self):
        sid=self.create()["id"];base=f"/sessions/{sid}"
        self.request(base+"/messages",{"text":"slow"});self.wait_status(sid,"running")
        self.request(base+"/messages",{"text":"queue-steer-rejected","mode":"queue"})
        item=self.request(base+"/queue")["items"][0]
        with self.assertRaises(urllib.error.HTTPError):
            self.request(base+"/queue",{"action":"steer","id":item["id"]})
        saved=self.request(base+"/queue")["items"][0]
        self.assertEqual(saved["status"],"uncertain")
        for action in ["steer","edit","take"]:
            with self.assertRaises(urllib.error.HTTPError):
                self.request(base+"/queue",{"action":action,"id":item["id"],"text":"do not replace the saved message"})
        self.assertEqual(self.request(base+"/queue")["items"],[saved])
        calls=[json.loads(line) for line in (self.base/"fixture-calls.jsonl").read_text().splitlines()]
        attempts=[call for call in calls if call.get("method")=="turn/steer" and any(part.get("text")=="queue-steer-rejected" for part in call["params"]["input"])]
        self.assertEqual(len(attempts),1)
        self.request(base+"/queue",{"action":"delete","id":item["id"]})
        self.assertEqual(self.request(base+"/queue")["items"],[])
        self.request(base+"/interrupt",{});self.wait_status(sid,"idle")

    def test_rich_composer_keeps_agent_text_separate_from_editable_document(self):
        sid=self.create()["id"];base=f"/sessions/{sid}"
        text="**literal**"
        composer={"markdown":r"\*\*literal\*\*", "document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}}
        self.request(base+"/messages",{"text":text,"composer":composer})
        self.wait_status(sid,"idle")
        events=self.request(base+"/export")["events"]
        echo=next(e["params"] for e in events if e["method"]=="user/message")
        self.assertEqual(echo["text"],text)
        self.assertEqual(echo["display_text"],text)
        self.assertEqual(echo["composer"],composer)
        self.request(base+"/messages",{"text":"slow"});self.wait_status(sid,"running")
        self.request(base+"/messages",{"text":text,"composer":composer,"mode":"queue"})
        item=self.request(base+"/queue")["items"][0]
        self.assertEqual(item["composer"],composer)
        taken=self.request(base+"/queue",{"action":"take","id":item["id"]})
        self.assertEqual(taken["editing"]["composer"],composer)
        self.assertEqual(taken["items"],[])
        restored=self.request(base+"/queue",{"action":"restore","id":item["id"]})
        self.assertEqual(restored["items"][0],item)
        self.request(base+"/queue",{"action":"take","id":item["id"]})
        formatted={"markdown":"**formatted**", "document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"formatted","marks":[{"type":"strong"}]}]}]}}
        revised=self.request(base+"/queue",{"action":"replace","id":item["id"],"text":"**formatted**","composer":formatted,"attachments":[]})
        self.assertEqual(revised["items"][0]["composer"],formatted)
        self.request(base+"/queue",{"action":"steer","id":item["id"]})
        self.request(base+"/interrupt",{})
        self.wait_status(sid,"idle")
        echo=next(e["params"] for e in reversed(self.request(base+"/export")["events"]) if e["method"]=="user/message")
        self.assertEqual(echo["composer"],formatted)
        self.assertEqual(echo["display_text"],"**formatted**")
        with self.assertRaises(urllib.error.HTTPError):
            self.request(base+"/messages",{"text":"invalid","composer":{"markdown":"invalid","document":{}}})

    def test_uploads_are_scoped_to_the_session(self):
        sid=self.create()["id"]; boundary="remote-agent-test-boundary"
        data=(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="../../note.txt"\r\nContent-Type: text/plain\r\n\r\nattachment content\r\n--{boundary}--\r\n').encode()
        req=urllib.request.Request(f"http://127.0.0.1:{self.port}/api/sessions/{sid}/uploads",data=data,headers={"Authorization":f"Bearer {TOKEN}","Content-Type":f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req,timeout=5) as response: uploaded=json.load(response)["files"][0]
        self.assertEqual(uploaded["name"],"note.txt")
        self.assertEqual(pathlib.Path(uploaded["path"]).read_text(),"attachment content")
        self.request(f"/sessions/{sid}/messages",{"text":"attachment","attachments":[uploaded["path"]]});self.wait_status(sid,"idle")
        other=self.create()["id"]
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{other}/messages",{"text":"attachment","attachments":[uploaded["path"]]})

    def test_raster_images_require_auth_and_session_boundaries(self):
        import base64, urllib.parse
        sid=self.create()["id"]; other=self.create()["id"]
        png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==")
        directory=self.base/"data"/"uploads"/sid; directory.mkdir(parents=True)
        image=directory/"image.png"; image.write_bytes(png)
        def read(session, path, token=TOKEN):
            url=f"http://127.0.0.1:{self.port}/api/sessions/{session}/image?"+urllib.parse.urlencode({"path":str(path)})
            return urllib.request.urlopen(urllib.request.Request(url,headers={"Authorization":f"Bearer {token}"}),timeout=10)
        with read(sid,image) as response:
            self.assertEqual(response.read(),png)
            self.assertEqual(response.headers["Content-Type"],"image/png")
            self.assertIn("no-store",response.headers["Cache-Control"])
        with self.assertRaises(urllib.error.HTTPError) as e: read(sid,image,"bad")
        self.assertEqual(e.exception.code,401)
        with self.assertRaises(urllib.error.HTTPError): read(other,image)
        fake=directory/"fake.png";fake.write_text("secret text")
        with self.assertRaises(urllib.error.HTTPError): read(sid,fake)
        outside=self.base/"outside.png";outside.write_bytes(png)
        link=self.workspace/"outside-image-link.png";link.symlink_to(outside)
        with self.assertRaises(urllib.error.HTTPError): read(sid,link)
        event={"seq":0,"session_id":sid,"method":"item/completed","params":{"item":{"id":"img-boundary","type":"imageView","path":str(outside)}},"request_id":None,"created_at":0}
        with sqlite3.connect(self.base/"data"/"remote-agent.sqlite") as db:
            db.execute("INSERT INTO events(session_id,data) VALUES(?,?)",(sid,json.dumps(event)))
        with read(sid,outside) as response:self.assertEqual(response.read(),png)
        with self.assertRaises(urllib.error.HTTPError): read(other,outside)

    def test_binary_documents_validate_formats_and_session_boundaries(self):
        import urllib.parse, zipfile
        sid=self.create()['id'];other=self.create()['id']
        pdf=b'%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n'
        document=self.workspace/'review-报告.pdf';document.write_bytes(pdf)
        def read(session,path,token=TOKEN):
            url=f'http://127.0.0.1:{self.port}/api/sessions/{session}/document?'+urllib.parse.urlencode({'path':str(path)})
            return urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':f'Bearer {token}'}),timeout=10)
        with read(sid,document) as response:
            self.assertEqual(response.read(),pdf)
            self.assertEqual(response.headers['Content-Type'],'application/pdf')
            self.assertTrue(response.headers['Content-Disposition'].startswith('inline;'))
            self.assertIn("filename*=UTF-8''",response.headers['Content-Disposition'])
            self.assertIn('no-store',response.headers['Cache-Control'])
            self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
        with self.assertRaises(urllib.error.HTTPError) as denied:read(sid,document,'wrong')
        self.assertEqual(denied.exception.code,401)
        upload=self.base/'data'/'uploads'/sid/'own.pdf';upload.parent.mkdir(parents=True,exist_ok=True);upload.write_bytes(pdf)
        with read(sid,upload) as response:self.assertEqual(response.read(),pdf)
        with self.assertRaises(urllib.error.HTTPError):read(other,upload)
        upload_link=self.workspace/'other-session-upload.pdf';upload_link.symlink_to(upload)
        with self.assertRaises(urllib.error.HTTPError):read(other,upload_link)
        stolen={'seq':0,'session_id':other,'method':'item/completed','params':{'item':{'id':'untrusted-reference','type':'agentMessage','text':'[upload]('+str(upload)+')'}},'request_id':None,'created_at':0}
        with sqlite3.connect(self.base/'data'/'remote-agent.sqlite') as db:db.execute('INSERT INTO events(session_id,data) VALUES(?,?)',(other,json.dumps(stolen)))
        with self.assertRaises(urllib.error.HTTPError):read(other,upload)
        outside=self.base/'outside (report).pdf';outside.write_bytes(pdf)
        with self.assertRaises(urllib.error.HTTPError):read(sid,outside)
        with self.assertRaises(urllib.error.HTTPError):read(sid,'../outside (report).pdf')
        link=self.workspace/'outside-document-link.pdf';link.symlink_to(outside)
        with self.assertRaises(urllib.error.HTTPError):read(sid,link)
        # Only an exact file reference in this conversation's own history grants access.
        event={'seq':0,'session_id':sid,'method':'item/completed','params':{'item':{'id':'document-boundary','type':'agentMessage','text':'[报告]('+urllib.parse.quote(str(outside))+')'}},'request_id':None,'created_at':0}
        with sqlite3.connect(self.base/'data'/'remote-agent.sqlite') as db:db.execute('INSERT INTO events(session_id,data) VALUES(?,?)',(sid,json.dumps(event)))
        with read(sid,outside) as response:self.assertEqual(response.read(),pdf)
        with self.assertRaises(urllib.error.HTTPError):read(other,outside)
        suffix=self.base/'outside (report).pdf-more.pdf';suffix.write_bytes(pdf)
        with self.assertRaises(urllib.error.HTTPError):read(sid,suffix)
        invalid=self.workspace/'invalid-document.pdf';invalid.write_bytes(b'<html>not a PDF</html>')
        with self.assertRaises(urllib.error.HTTPError):read(sid,invalid)
        huge=self.workspace/'oversized-document.pdf'
        with huge.open('wb') as f:f.write(pdf);f.truncate(20*1024*1024+1)
        with self.assertRaises(urllib.error.HTTPError):read(sid,huge)
        office=self.workspace/'report.docx'
        with zipfile.ZipFile(office,'w',zipfile.ZIP_DEFLATED) as archive:
            for name in ['[Content_Types].xml','_rels/.rels','word/document.xml']:archive.writestr(name,'<document/>')
        with read(sid,office) as response:
            self.assertEqual(response.read(),office.read_bytes())
            self.assertEqual(response.headers['Content-Type'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            self.assertTrue(response.headers['Content-Disposition'].startswith('attachment;'))
        invalid_office=self.workspace/'invalid.docx'
        with zipfile.ZipFile(invalid_office,'w') as archive:archive.writestr('unrelated.txt','not an office package')
        with self.assertRaises(urllib.error.HTTPError):read(sid,invalid_office)
        invalid_office.write_bytes(office.read_bytes()[:-10])
        with self.assertRaises(urllib.error.HTTPError):read(sid,invalid_office)

    def test_files_path_boundaries_and_lifecycle(self):
        s=self.create();sid=s["id"]
        listing=self.request(f"/sessions/{sid}/files")
        self.assertIn("README.md",[e["name"] for e in listing["entries"]])
        self.request(f"/sessions/{sid}/files",{"path":"new.txt","content":"updated","expected_revision":None},"PUT")
        self.assertEqual(self.request(f"/sessions/{sid}/files?path=new.txt")["content"],"updated")
        with self.assertRaises(urllib.error.HTTPError) as result:self.request(f"/sessions/{sid}/files?path=/etc/passwd")
        self.assertEqual(result.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/files",{"path":"../escape","content":"bad","expected_revision":None},"PUT")
        self.request(f"/sessions/{sid}",{"archived":True,"title":"renamed"},"PATCH")
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}/messages",{"text":"hello"})
        self.request(f"/sessions/{sid}",method="DELETE")
        with self.assertRaises(urllib.error.HTTPError):self.request(f"/sessions/{sid}")

    def test_z_restart_resumes_same_thread_and_keeps_history(self):
        s=self.create();sid=s["id"]
        self.request(f"/sessions/{sid}/composer",{"action":"settings","service_tier":"fixture-priority"})
        self.request(f"/sessions/{sid}/messages",{"text":"hello"});self.wait_status(sid,"idle")
        before=self.request(f"/sessions/{sid}/export")
        feedback=self.request(f"/sessions/{sid}/feedback/restart-message",{"rating":"bad","tags":["incomplete"],"text":"Saved before restart"},"PUT")["feedback"]
        self.request(f"/sessions/{sid}/messages",{"text":"paused pending","mode":"queue"})
        self.request(f"/sessions/{sid}/queue",{"action":"pause","paused":True})
        self.process.terminate();self.process.wait(timeout=10)
        with sqlite3.connect(self.base/"data"/"remote-agent.sqlite") as db:
            db.execute("INSERT INTO message_queue(session_id,data) VALUES(?,?)",(sid,json.dumps({"text":"uncertain delivery","attachments":[],"status":"sending"})))
        self.__class__.start()
        self.assertEqual(self.request(f"/sessions/{sid}/composer")["service_tier"],"fixture-priority")
        self.assertEqual(self.request(f"/sessions/{sid}/feedback/restart-message")["feedback"],feedback)
        queue=self.request(f"/sessions/{sid}/queue")
        self.assertTrue(queue["paused"])
        self.assertEqual([item["status"] for item in queue["items"]],["pending","uncertain"])

        self.request(f"/sessions/{sid}/messages",{"text":"hello again"});self.wait_status(sid,"idle")
        after=self.request(f"/sessions/{sid}/export")
        self.assertEqual(before["session"]["thread_id"],after["session"]["thread_id"])
        self.assertGreater(len(after["events"]),len(before["events"]))
        self.assertEqual(after["feedback"],[feedback])
        self.request(f"/sessions/{sid}/composer",{"action":"settings","service_tier":None})
        self.process.terminate();self.process.wait(timeout=10);self.__class__.start()
        self.assertIsNone(self.request(f"/sessions/{sid}/composer")["service_tier"])

if __name__=="__main__":unittest.main(verbosity=2)
