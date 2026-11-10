#!/usr/bin/env python3
import json, os, pathlib, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
port=int(os.environ.get("ANYWORK_E2E_PORT", "3219"))
with tempfile.TemporaryDirectory(prefix="remote-agent-browser-") as tmp:
    base=pathlib.Path(tmp); workspace=base/"workspace"; workspace.mkdir()
    (workspace/"README.md").write_text("# Browser fixture\n")
    (workspace/"docs").mkdir()
    (workspace/"docs"/"guide.md").write_text("# 文档侧栏预览\n\n这是 **Markdown** 预览。\n\n[返回说明](../README.md)\n\n## 详细说明\n\n" + "保留对话和输入草稿。\n\n" * 30)
    (workspace/"src").mkdir()
    (workspace/"src"/"example.rs").write_text("fn main() {\n    let answer = 42;\n    println!(\"{}\", answer);\n}\n")
    for name in ["empty-project", "desktop-project", "android-web-project"]:
        (workspace/name).mkdir()
    subprocess.run(["git","init",str(workspace)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(["git","-C",str(workspace),"add","."],check=True)
    subprocess.run(["git","-C",str(workspace),"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-m","fixture"],check=True,stdout=subprocess.DEVNULL)
    plugins=base/"plugins";plugins.mkdir()
    codex_fixture=base/"codex-fixture"
    codex_fixture.write_text('#!/bin/sh\nexec python3 "'+str(root/"scripts/fake-agent.py")+'" "$@"\n')
    codex_fixture.chmod(0o755)
    (plugins/"fixture.json").write_text(json.dumps({"id":"fixture","name":"Fixture","protocol_version":1,"command":"python3","args":[str(root/"scripts/fake-agent.py")],"capabilities":["chat","resume","interrupt","approvals","questions","models"]}))
    web_dir=os.environ.get("ANYWORK_E2E_WEB_DIR",str(root/"web/dist"))
    process=subprocess.Popen([os.environ.get("ANYWORK_E2E_BINARY",str(root/"target/debug/anywork")),"--codex-discovery","false","--bind",f"127.0.0.1:{port}","--workspace",str(workspace),"--data-dir",str(base/"data"),"--plugins-dir",str(plugins),"--web-dir",web_dir,"--token","browser-integration-test-token"], env={**{key:value for key,value in os.environ.items() if not key.startswith(("ANYWORK_HARNESS_", "ANYWORK_WORKBUDDY_"))},"HOME":str(base/"home"),"USERPROFILE":str(base/"home"),"CODEX_BIN":str(codex_fixture),"CODEX_HOME":str(base/"codex-home"),"FAKE_AGENT_STATE_DIR":str(base/"fixture-state")})
    try:process.wait()
    finally:process.terminate()
