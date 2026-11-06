#!/usr/bin/env python3
"""Deterministic protocol fixture. Never used by the production Codex adapter."""
import json, sys, uuid, os, pathlib, hashlib

cwd = None
thread_id = None
turn_id = None
pending = {}
goal = None
settings = {"model":"fixture","reasoningEffort":"medium","serviceTier":"fixture-standard","collaborationMode":{"mode":"default","settings":{"model":"fixture"}}}
turn_history = []
edit_rejections = set()
history_mode = "paginated"
wrapped_edit_prefix = "<page-comment-context>\nedit-wrapped-fixture\n</page-comment-context>\n## My request:\n"
expected_edit_prefix = None

def settings_path():
    directory=os.environ.get("FAKE_AGENT_STATE_DIR")
    return pathlib.Path(directory)/(hashlib.sha256(thread_id.encode()).hexdigest()+".json") if directory else None

def save_settings():
    path=settings_path()
    if path:
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(settings))

def history_path():
    path=settings_path()
    return path.with_suffix('.history.json') if path else None

def save_history():
    path=history_path()
    if path:
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps({"history_mode":history_mode,"turns":turn_history,"expected_edit_prefix":expected_edit_prefix}))

def send(value):
    print(json.dumps(value), flush=True)

def event(method, params):
    if method == "item/completed" and turn_history:
        item = params.get("item", {})
        turn_history[-1]["items"].append(item)
    elif method == "turn/completed" and turn_history:
        turn_history[-1]["status"] = params["turn"]["status"]
    if method in ("item/completed", "turn/completed", "thread/reverted"):
        save_history()
    send({"method": method, "params": params})

def finish(text="已完成测试任务。", status="completed"):
    item = {"id": "answer-" + turn_id, "type": "agentMessage", "text": text}
    event("item/started", {"item": {**item, "text": ""}, "threadId": thread_id})
    event("item/agentMessage/delta", {"itemId": item["id"], "delta": text, "threadId": thread_id})
    event("item/completed", {"item": item, "threadId": thread_id})
    event("turn/completed", {"turn": {"id": turn_id, "status": status}, "threadId": thread_id})

for line in sys.stdin:
    request = json.loads(line)
    if os.environ.get("FAKE_AGENT_CALLS"):
        with open(os.environ["FAKE_AGENT_CALLS"],"a") as calls:
            calls.write(json.dumps(request)+"\n")
    method, params = request.get("method"), request.get("params", {})
    rid = request.get("id")
    result = {}
    if method is None and rid in pending:
        kind = pending.pop(rid)
        event("serverRequest/resolved", {"requestId": rid})
        finish("审批已处理。\n"+json.dumps({"approvalResult":request.get("result"),"approvalMethod":kind["method"]},ensure_ascii=False) if isinstance(kind,dict) else "回答已收到。",status="interrupted" if request.get("result",{}).get("decision")=="cancel" else "completed")
        continue
    if method == "initialized":
        continue
    if method == "initialize":
        result = {"userAgent": "remote-agent-test-fixture"}
    elif method in ("thread/start", "thread/resume"):
        cwd = params["cwd"]
        thread_id = params.get("threadId", "test-" + str(uuid.uuid4()))
        if method == "thread/start":
            history_mode = params.get("historyMode", "paginated")
            turn_history = []
            expected_edit_prefix = None
        path=settings_path()
        if method=="thread/resume" and path and path.exists():settings=json.loads(path.read_text())
        history=history_path()
        if method=="thread/resume" and history and history.exists():
            saved=json.loads(history.read_text());turn_history=saved["turns"];history_mode=saved["history_mode"];expected_edit_prefix=saved.get("expected_edit_prefix")
        if "serviceTier" in params:settings["serviceTier"]=params["serviceTier"]
        save_settings()
        result = {"thread": {"id": thread_id}, **settings}
    elif method == "thread/list" and os.environ.get("FAKE_CODEX_CATALOG"):
        rows=json.loads(pathlib.Path(os.environ["FAKE_CODEX_CATALOG"]).read_text())
        if "appServer" not in params.get("sourceKinds",[]) or "exec" not in params.get("sourceKinds",[]) or params.get("modelProviders") != []:
            send({"id":rid,"error":{"code":-32602,"message":"Incomplete discovery filters"}});continue
        rows=[t for t in rows if t.get("archived",False)==params.get("archived",False)]
        start=int(params.get("cursor") or 0);page=rows[start:start+2]
        result={"data":page,"nextCursor":str(start+2) if start+2<len(rows) else None}
    elif method == "thread/items/list" and os.environ.get("FAKE_CODEX_CATALOG") and params.get("threadId")=="desktop-3":
        rows=[{"turnId":"timestamp-turn","item":{"id":f"timestamp-user-{i}","type":"userMessage","content":[{"type":"text","text":f"时间问题 {i}"}]}} for i in range(6)]
        rows[0].update(startedAtMs=1700000000123,completedAtMs=1700000000456)
        rows[2].update(startedAtMs=None,completedAtMs=None)
        rows[3].update(startedAtMs="1700000000123",completedAtMs="1700000000456")
        rows[4].update(startedAtMs=1700000000123.5,completedAtMs=1700000000456.5)
        rows[5].update(startedAtMs=9223372036854775808,completedAtMs=9223372036854775808)
        if params.get("sortDirection")=="desc":rows.reverse()
        start=int(params.get("cursor") or 0);limit=params.get("limit",8)
        result={"data":rows[start:start+limit],"nextCursor":str(start+limit) if start+limit<len(rows) else None}
    elif method == "thread/items/list" and os.environ.get("FAKE_CODEX_CATALOG") and params.get("threadId")=="desktop-2":
        rows=[{"turnId":f"item-turn-{i//2}","startedAtMs":100000+i*1000,"completedAtMs":100500+i*1000,"item":{"id":f"item-{i}","type":"agentMessage","text":f"条目回答 {i}"}} for i in range(25)]
        if params.get("sortDirection")=="desc":rows.reverse()
        start=int(params.get("cursor") or 0);limit=params.get("limit",8)
        result={"data":rows[start:start+limit],"nextCursor":str(start+limit) if start+limit<len(rows) else None}
    elif method == "thread/turns/list" and os.environ.get("FAKE_CODEX_CATALOG") and params.get("threadId")=="desktop-4":
        send({"id":rid,"error":{"code":-32601,"message":"Unsupported method"}});continue
    elif method == "thread/read" and os.environ.get("FAKE_CODEX_CATALOG") and params.get("threadId")=="desktop-4":
        result={"thread":{"id":"desktop-4","turns":[{"id":"legacy-timestamp-turn","status":"completed","startedAt":1700000000,"completedAt":1700000005,"items":[{"id":"legacy-user","type":"userMessage","content":[{"type":"text","text":"旧版无条目时间"}]}]}]}}
    elif method == "thread/turns/list" and os.environ.get("FAKE_CODEX_CATALOG"):
        order=[1,0] if params.get("sortDirection")=="desc" else [0,1]
        start=int(params.get("cursor") or 0);i=order[start]
        result={"data":[{"id":f"old-turn-{i}","status":"completed","startedAt":100+i*10,"completedAt":105+i*10,"items":[{"id":f"old-user-{i}","type":"userMessage","content":[{"type":"text","text":f"历史问题 {i}"}]+([{"type":"localImage","path":os.environ["FAKE_NATIVE_IMAGE"]}] if os.environ.get("FAKE_NATIVE_IMAGE") else [])},{"id":f"old-answer-{i}","type":"agentMessage","text":f"历史回答 {i}"+("\n[原生报告]("+os.environ["FAKE_NATIVE_DOCUMENT"]+")" if os.environ.get("FAKE_NATIVE_DOCUMENT") else "")}]}],"nextCursor":"1" if start==0 else None}
    elif method == "thread/fork" and os.environ.get("FAKE_CODEX_CATALOG"):
        result={"thread":{"id":"fork-"+str(uuid.uuid4())}}
    elif method == "thread/read" and params.get("threadId") == thread_id:
        result={"thread":{"id":thread_id,"cwd":cwd,"historyMode":history_mode,"ephemeral":False,"status":{"type":"active" if turn_history and turn_history[-1]["status"]=="inProgress" else "idle"},"turns":turn_history if params.get("includeTurns") else []}}
    elif method == "thread/turns/list" and params.get("threadId") == thread_id:
        rows=list(reversed(turn_history)) if params.get("sortDirection")=="desc" else list(turn_history)
        start=int(params.get("cursor") or 0);limit=params.get("limit",20)
        result={"data":rows[start:start+limit],"nextCursor":str(start+limit) if start+limit<len(rows) else None}
    elif method == "thread/revert" and params.get("threadId") == thread_id:
        target=next((i for i,turn in enumerate(turn_history) if turn["id"]==params.get("beforeTurnId")),None)
        if target is None or history_mode!="paginated" or any(turn["status"]=="inProgress" for turn in turn_history):
            send({"id":rid,"error":{"code":-32600,"message":"Cannot revert this fixture thread"}});continue
        turn_history=turn_history[:target]
        event("thread/reverted",{"threadId":thread_id})
        result={"thread":{"id":thread_id,"turns":[],"historyMode":history_mode,"ephemeral":False}}
    elif method == "thread/goal/get":
        result = {"goal":goal}
    elif method == "thread/goal/set":
        assert params["origin"] == "user"
        if "goal-activation-rejected" in params.get("objective", ""):
            send({"id":rid,"error":{"code":-32602,"message":"Fixture rejected goal activation"}});continue
        goal = {**(goal or {}), **{k:v for k,v in params.items() if k in ["objective","status","tokenBudget"]}, "threadId":thread_id}
        event("thread/goal/updated", {"threadId":thread_id,"goal":goal})
        result = {"goal":goal}
    elif method == "thread/goal/clear":
        assert params["origin"] == "user"
        goal = None
        result = {"cleared":True}
        event("thread/goal/cleared", {"threadId":thread_id})
    elif method == "thread/settings/update":
        assert set(params).issubset({"threadId","collaborationMode","model","effort","serviceTier"})
        if params.get("serviceTier")=="fixture-policy-denied":
            send({"id":rid,"error":{"code":-32602,"message":"Service tier denied by native policy"}});continue
        if "collaborationMode" in params:
            mode=params["collaborationMode"]
            assert mode["settings"]["model"]==settings["model"]
            assert mode["settings"]["reasoning_effort"]==settings["reasoningEffort"]
            settings["collaborationMode"] = mode
        if "model" in params:
            settings["model"] = params["model"]
            settings["collaborationMode"]["settings"]["model"] = params["model"]
        if "effort" in params:
            settings["reasoningEffort"] = params["effort"]
            settings["collaborationMode"]["settings"]["reasoning_effort"] = params["effort"]
        if "serviceTier" in params:settings["serviceTier"]=params["serviceTier"]
        save_settings()
        event("thread/settings/updated", {"threadId":thread_id,"threadSettings":settings})
        result = {}
    elif method == "model/list":
        if os.environ.get("FAKE_AGENT_MODEL_GATE"):
            import time
            gate = pathlib.Path(os.environ["FAKE_AGENT_MODEL_GATE"])
            deadline = time.monotonic() + 8
            while gate.exists() and time.monotonic() < deadline:
                time.sleep(.01)
        result = {"data": [
            {"id":"fixture","model":"fixture","displayName":"Fixture","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":v,"description":v} for v in ["low","medium","high"]],"defaultServiceTier":"fixture-standard","serviceTiers":[{"id":v,"name":v,"description":"Native fixture tier "+v} for v in ["fixture-standard","fixture-priority","fixture-policy-denied"]]},
            {"id":"fixture-fast","model":"fixture-fast","displayName":"Fixture Fast","defaultReasoningEffort":"low","supportedReasoningEfforts":[{"reasoningEffort":v,"description":v} for v in ["low","medium"]],"defaultServiceTier":"fixture-economy","serviceTiers":[{"id":"fixture-economy","name":"Economy","description":"Fast model native tier"}]},
            {"id":"fixture-legacy","model":"fixture-legacy","displayName":"Legacy Fixture","defaultReasoningEffort":"low","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"low"}]},
            {"id":"fixture-speed-matrix","model":"fixture-speed-matrix","displayName":"Speed Matrix","defaultReasoningEffort":"low","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"low"}],"serviceTiers":[{"id":v,"name":v,"description":v} for v in ["default","flex","fast","priority","ultrafast","opaque-speed"]]}
        ]}
    elif method == "configRequirements/read":
        path=pathlib.Path(os.environ.get("FAKE_AGENT_REQUIREMENTS", "/nonexistent-anywork-fixture-requirements"))
        result=json.loads(path.read_text()) if path.exists() else {"requirements":None,"supportsIndependentSpeedModes":True}
        if result.get("_fixture_error"):
            send({"id":rid,"error":{"code":-32601,"message":"Fixture requirements unavailable"}});continue
    elif method == "turn/start":
        assert "serviceTier" not in params and "serviceTierForTurn" not in params
        primary=next((part.get("text","") for part in params["input"] if part.get("type")=="text"),"")
        if not params.get("clientUserMessageId") and primary.startswith(wrapped_edit_prefix):expected_edit_prefix=wrapped_edit_prefix
        if params.get("clientUserMessageId") and expected_edit_prefix:
            assert primary.startswith(expected_edit_prefix), "Edited input lost its opaque native context prefix"
        if "edit-reject-once" in primary and primary not in edit_rejections:
            edit_rejections.add(primary)
            send({"id":rid,"error":{"code":-32602,"message":"Fixture rejected this edit once"}});continue
        disconnect_before_commit = "edit-disconnect-before-commit" in primary and params.get("clientUserMessageId")
        disconnect_after_commit = "edit-disconnect-after-commit" in primary and params.get("clientUserMessageId")
        if disconnect_before_commit:sys.exit(0)
        turn_id = str(uuid.uuid4())
        turn_history.append({"id":turn_id,"status":"inProgress","items":[]})
        result = {"turn": {"id": turn_id, "status": "inProgress"}}
        text = " ".join(x.get("text", "") for x in params["input"])
        before_response = text == "approval before response"
        if not before_response and not disconnect_after_commit:send({"id": rid, "result": result})
        event("turn/started", result)
        native_input=params["input"]
        if primary=="edit-rich-input" and not params.get("clientUserMessageId"):
            native_input=[*native_input,{"type":"skill","name":"fixture-skill","path":"/fixture/skill"},{"type":"mention","name":"fixture-mention","path":"app://fixture/source"},{"type":"image","fileId":"fixture-file-id","detail":"high"},{"type":"text","text":"保留的第二段文本","text_elements":[{"fixture":"span"}]}]
        if primary=="https://fixture.anywork.test/library" and not params.get("clientUserMessageId"):
            native_input=[{**native_input[0],"text_elements":[{"byteRange":{"start":0,"end":len(primary.encode())},"placeholder":"[Library file](chatgpt-library-file://fixture?asUrl=1&sourceUrl=https%3A%2F%2Ffixture.anywork.test%2Flibrary)"}]},*native_input[1:]]
        if primary=="Respond to the user input in the context of our conversation." and not params.get("clientUserMessageId"):
            app={"version":1,"message":{"source":"visualization","sourceId":"fixture","text":"Restored native app message"}}
            native_input=[{**native_input[0],"text_elements":[{"byteRange":{"start":0,"end":len(primary.encode())},"placeholder":"codex-untrusted-app-input:"+json.dumps(app)}]},*native_input[1:]]
        event("item/completed",{"threadId":thread_id,"turnId":turn_id,"item":{"id":"user-"+turn_id,"type":"userMessage","content":native_input,**({"clientId":params["clientUserMessageId"]} if params.get("clientUserMessageId") else {})}})
        if disconnect_after_commit:
            finish("Replacement committed before connection loss.");sys.exit(0)
        elif "approval" in text:
            approval_method="item/commandExecution/requestApproval"
            approval_params={"threadId":thread_id,"turnId":turn_id,"itemId":"fixture-approval","startedAtMs":0,"command":"echo integration-test","reason":"Test approval","cwd":cwd}
            if text=="approval file":
                approval_method="item/fileChange/requestApproval"
                approval_params={"threadId":thread_id,"turnId":turn_id,"itemId":"fixture-file-approval","startedAtMs":0,"reason":"Test file approval","grantRoot":cwd}
                event("item/started", {"threadId":thread_id,"item":{"id":"fixture-file-approval","type":"fileChange","changes":[{"path":str(pathlib.Path(cwd)/"README.md"),"kind":{"type":"update","move_path":None},"diff":"@@ -1 +1 @@\n-# Browser fixture\n+# Approved edit\n"}]}})
            elif text=="approval permissions":
                approval_method="item/permissions/requestApproval"
                approval_params={"threadId":thread_id,"turnId":turn_id,"itemId":"fixture-permissions-approval","permissions":{"network":{"enabled":True},"fileSystem":{"write":[str(pathlib.Path(cwd)/"approved")]}}}
            elif text=="approval network":
                approval_params.update({"command":"curl https://example.com","networkApprovalContext":{"host":"example.com","protocol":"https"},"proposedNetworkPolicyAmendments":[{"host":"example.com","action":action} for action in ["allow","deny"]]})
            elif text=="approval exec":approval_params["proposedExecpolicyAmendment"]=["npm","install"]
            elif text=="approval restricted":approval_params["availableDecisions"]=["acceptForSession","decline","cancel"]
            elif text=="approval empty":approval_params["availableDecisions"]=[]
            elif text=="approval whitelist":approval_params["availableDecisions"]=[{"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"listed.example","action":"deny"}}}]
            elif text=="approval unknown":approval_method="item/unknown/requestApproval"
            pending[700]={"method":approval_method}
            send({"id":700,"method":approval_method,"params":approval_params})
        elif "question" in text:
            pending[701] = "question"
            send({"id": 701, "method": "item/tool/requestUserInput", "params": {"questions": [{"id": "color", "header": "主题", "question": "选择一个主题？", "options": [{"label": "深色", "description": "适合夜间"}, {"label": "浅色", "description": "适合白天"}]}]}})
        elif "activity-layout" in text:
            event("item/completed", {"item":{"id":"comment-"+turn_id,"type":"agentMessage","phase":"commentary","text":"先检查文件，再运行验证。"}})
            event("item/completed", {"item":{"id":"read-"+turn_id,"type":"commandExecution","command":"cat README.md","commandActions":[{"type":"read","path":"README.md"}],"status":"completed"}})
            event("item/completed", {"item":{"id":"thought-"+turn_id,"type":"reasoning","summary":["思考内容不显示"],"content":[]}})
            event("item/completed", {"item":{"id":"cmd-"+turn_id,"type":"commandExecution","command":"echo verify","aggregatedOutput":"verify","status":"completed"}})
            event("item/completed", {"item":{"id":"progress-"+turn_id,"type":"agentMessage","phase":"commentary","text":"检查已完成，继续下一步。"}})
            event("item/completed", {"item":{"id":"last-"+turn_id,"type":"commandExecution","command":"echo done","status":"completed"}})
            finish("活动布局已核对。")
        elif "document-preview" in text:
            event("item/completed", {"item":{"id":"comment-"+turn_id,"type":"agentMessage","phase":"commentary","text":"我先读取文档并核对结构。"}})
            event("item/completed", {"item":{"id":"read-"+turn_id,"type":"commandExecution","command":"cat docs/guide.md","commandActions":[{"type":"read","path":"docs/guide.md","name":"guide.md"}],"aggregatedOutput":"# 文档侧栏预览","status":"completed"}})
            finish("文档已准备好：[设计说明](" + cwd + "/docs/guide.md)。\n\n[代码定位](" + cwd + "/src/example.rs:3) · [网页](https://example.com) · [无法读取的文档](/outside-workspace/missing.md)")
        elif "viewimage" in text:
            images=[x["path"] for x in params["input"] if x.get("type")=="localImage"] or [""]
            for index,image in enumerate(images):
                event("item/completed", {"item":{"id":f"img-{turn_id}-{index}","type":"imageView","path":image,"status":"completed"}})
            finish("图片已查看。")
        elif "slow" in text:
            pass
        elif "crash" in text:
            sys.exit(0)
        else:
            event("item/started", {"item": {"id": "cmd-" + turn_id, "type": "commandExecution", "command": "echo integration-test", "status": "inProgress"}})
            event("item/completed", {"item": {"id": "cmd-" + turn_id, "type": "commandExecution", "command": "echo integration-test", "aggregatedOutput": ("large-tool-result\n" * 10000 if "large" in text else "integration-test\n"), "status": "completed"}})
            finish("## 已完成\n\n你的远程工作空间已连接，**实时消息**与工具输出正常。")
        if before_response:send({"id":rid,"result":result})
        continue
    elif method == "turn/steer":
        if params.get("expectedTurnId") != turn_id:
            send({"id":rid,"error":{"code":-32602,"message":"Wrong turn"}});continue
        if any(x.get("text")=="queue-steer-rejected" for x in params["input"]):
            send({"id":rid,"error":{"code":-32602,"message":"Fixture rejected queued steer"}});continue
        send({"id":rid,"result":{"turnId":turn_id}})
        text=" ".join(x.get("text", "") for x in params["input"])
        if "finish" in text: finish("引导已完成。")
        continue
    elif method == "turn/interrupt":
        send({"id": rid, "result": {}})
        finish("任务已中断。", "interrupted")
        continue
    else:
        send({"id": rid, "error": {"code": -32601, "message": "Method not found"}})
        continue
    send({"id": rid, "result": result})
