import { describe, expect, it } from "vitest";
import {
  approvalPresentation,
  approvalReasonParts,
  questionResponse,
  requestQuestions,
} from "./requests";
import type { AgentEvent } from "./types";

const event = (
  method: string,
  params: Record<string, unknown>,
): AgentEvent => ({
  method,
  params,
  seq: 1,
  session_id: "local",
  request_id: 7,
  created_at: 0,
});

describe("remote request presentation", () => {
  it("shows the command once and keeps its reason and working directory separate", () => {
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        command: "npm test",
        cwd: "/work/project",
        reason: "Tests require local access",
      }),
    );
    expect(result.reason).toBe("Tests require local access");
    expect(result.details).toEqual([
      { label: "命令", value: "npm test", code: true },
      { label: "工作目录", value: "/work/project", code: true },
    ]);
  });

  it("preserves complete permission scopes even when a plugin adds unfamiliar fields", () => {
    const permissions = {
      network: { enabled: true },
      fileSystem: { read: ["/work/read"], write: ["/work/write"] },
      pluginScope: { key: "future capability" },
    };
    const result = approvalPresentation(
      event("item/permissions/requestApproval", { permissions }),
    );
    expect(result.title).toBe("允许授予这些权限？");
    expect(result.details.map((d) => d.value)).toEqual([
      "允许访问网络",
      "/work/read",
      "/work/write",
    ]);
    expect(JSON.parse(result.rawPermissions!)).toEqual(permissions);
    expect(result.actions.primary?.body).toEqual({
      result: { permissions, scope: "turn" },
    });
    expect(result.actions.scoped?.body).toEqual({
      result: { permissions, scope: "session" },
    });
    expect(result.actions.deny?.body).toEqual({
      result: { permissions: {}, scope: "turn" },
    });
  });

  it("shows entry-based read/write/deny permissions, patterns, special roots and additional permissions", () => {
    const entries = [
      { access: "read", path: { type: "path", path: "/work/both" } },
      { access: "write", path: { type: "path", path: "/work/both" } },
      {
        access: "read",
        path: { type: "glob_pattern", pattern: "/work/**/*.md" },
      },
      ...[
        [{ kind: "root" }, "/"],
        [{ kind: "minimal" }, ":minimal"],
        [{ kind: "project_roots", subpath: "docs" }, ":project_roots/docs"],
        [{ kind: "tmpdir" }, ":tmpdir"],
        [{ kind: "slash_tmp" }, "/tmp"],
        [
          { kind: "unknown", path: "/legacy", subpath: "nested" },
          "/legacy/nested",
        ],
      ].map(([value]) => ({
        access: "write",
        path: { type: "special", value },
      })),
      { access: "deny", path: { type: "path", path: "/work/private" } },
    ];
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        additionalPermissions: {
          network: { enabled: true },
          fileSystem: { entries },
        },
        networkApprovalContext: { host: "example.com", protocol: "https" },
      }),
    );
    expect(result.details).toContainEqual({
      label: "额外权限 · 读取和写入文件",
      value: "/work/both",
      code: true,
    });
    expect(result.details).toContainEqual({
      label: "额外权限 · 禁止访问文件",
      value: "/work/private",
      code: true,
    });
    expect(result.details).toContainEqual({
      label: "额外权限 · 读取文件",
      value: "/work/**/*.md",
      code: true,
    });
    expect(
      result.details
        .find((detail) => detail.label === "额外权限 · 写入文件")
        ?.value.split("\n"),
    ).toEqual([
      "/",
      ":minimal",
      ":project_roots/docs",
      ":tmpdir",
      "/tmp",
      "/legacy/nested",
    ]);
    expect(result.details).toContainEqual({
      label: "目标主机",
      value: "example.com",
      code: true,
    });
    expect(result.details).toContainEqual({
      label: "网络协议",
      value: "https",
      code: true,
    });
  });

  it("distinguishes process input from command execution without inventing stdin content", () => {
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        kind: "writeStdin",
        command: "python task.py",
      }),
    );
    expect(result.title).toBe("允许向此进程发送输入？");
    expect(result.details).toContainEqual({
      label: "操作",
      value: "向正在运行的进程写入标准输入",
    });
    expect(result.details).toContainEqual({
      label: "命令",
      value: "python task.py",
      code: true,
    });
  });

  it("treats an explicit empty or malformed decision list as authoritative", () => {
    for (const availableDecisions of [
      [],
      ["unknown"],
      [{ accept: true }],
      false,
    ]) {
      const result = approvalPresentation(
        event("item/commandExecution/requestApproval", {
          availableDecisions,
          proposedExecpolicyAmendment: ["npm", "test"],
          networkApprovalContext: { host: "example.com", protocol: "https" },
          proposedNetworkPolicyAmendments: [
            { host: "example.com", action: "allow" },
          ],
        }),
      );
      expect(result.actions).toEqual({
        primary: null,
        deny: null,
        scoped: null,
        leading: null,
      });
    }
  });

  it("uses scoped native decisions without synthesizing an unavailable once action", () => {
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        availableDecisions: ["acceptForSession", "decline"],
        proposedExecpolicyAmendment: ["npm", "test"],
      }),
    );
    expect(result.actions.primary).toBeNull();
    expect(result.actions.scoped?.label).toBe("允许此对话");
    expect(result.actions.scoped?.body).toEqual({
      result: { decision: "acceptForSession" },
    });
  });

  it("sends exact explicit exec amendments even without a duplicate proposed amendment", () => {
    const decision = {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ["npm", "run", "test suite"],
      },
    };
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        availableDecisions: [decision, "decline"],
      }),
    );
    expect(result.actions.primary).toBeNull();
    expect(result.actions.scoped?.label).toBe("允许类似命令");
    expect(result.actions.scoped?.body).toEqual({ result: { decision } });
    expect(result.actions.scoped?.description).toContain("test suite");
  });

  it("never exposes invalid multiline or expanded policy amendments", () => {
    const candidates = [
      {
        acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm\ntest"] },
      },
      {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ["npm"],
          extra: true,
        },
      },
      {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: {
            host: "example.com",
            action: "allow",
            extra: true,
          },
        },
      },
    ];
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        availableDecisions: candidates,
        networkApprovalContext: { host: "example.com" },
      }),
    );
    expect(result.actions.scoped).toBeNull();
    expect(result.actions.leading).toBeNull();
  });

  it("only offers the exact native allow network proposal and respects explicit denial-only decisions", () => {
    const params = {
      networkApprovalContext: { host: "example.com", protocol: "https" },
      proposedNetworkPolicyAmendments: [
        { host: "blocked.example", action: "deny" },
        { host: "example.com", action: "allow" },
      ],
    };
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", params),
    );
    expect(result.actions.leading?.body).toEqual({
      result: {
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { host: "example.com", action: "allow" },
          },
        },
      },
    });
    const denied = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        ...params,
        availableDecisions: ["decline"],
      }),
    );
    expect(denied.actions.leading).toBeNull();
    expect(denied.actions.primary).toBeNull();
    expect(denied.actions.scoped).toBeNull();
    expect(denied.actions.deny?.label).toBe("拒绝");
  });

  it("maps file edits to conversation approval and cancel-only to its actual decision", () => {
    expect(
      approvalPresentation(event("item/fileChange/requestApproval", {})).actions
        .scoped,
    ).toMatchObject({
      label: "允许所有修改",
      body: { result: { decision: "acceptForSession" } },
    });
    expect(
      approvalPresentation(
        event("item/commandExecution/requestApproval", {
          availableDecisions: ["cancel"],
        }),
      ).actions.deny,
    ).toMatchObject({
      label: "取消",
      body: { result: { decision: "cancel" } },
    });
  });

  it("matches file-change details by session, item and preceding sequence", () => {
    const request = {
      ...event("item/fileChange/requestApproval", { itemId: "patch-1" }),
      seq: 10,
    };
    const changed = (
      seq: number,
      session: string,
      id: string,
      diff: string,
    ): AgentEvent => ({
      ...event("item/started", {
        item: {
          type: "fileChange",
          id,
          changes: [
            {
              path: "src/app.ts",
              kind: { type: "update", move_path: "src/main.ts" },
              diff,
            },
          ],
        },
      }),
      seq,
      session_id: session,
    });
    const result = approvalPresentation(request, [
      changed(8, "local", "patch-1", "-old\n+new"),
      changed(9, "other", "patch-1", "wrong session"),
      changed(9, "local", "patch-2", "wrong item"),
      changed(11, "local", "patch-1", "future"),
    ]);
    expect(result.fileChanges).toEqual([
      {
        path: "src/app.ts",
        kind: "update",
        movePath: "src/main.ts",
        diff: "-old\n+new",
      },
    ]);
    expect(approvalPresentation(request).missingFileChanges).toBe(true);
  });

  it("only loads detail markers attached to the matched file item and preserves external turn queries", () => {
    const request = {
      ...event("item/fileChange/requestApproval", { itemId: "patch-1" }),
      seq: 10,
    };
    const source = (marker: unknown, extra = {}): AgentEvent => ({
      ...event("item/completed", {
        item: { id: "patch-1", type: "fileChange", history_detail: marker },
        ...extra,
      }),
      seq: 8,
    });
    expect(
      approvalPresentation(request, [source({ seq: 8 })]).detailQuery,
    ).toBe("seq=8");
    expect(
      approvalPresentation(request, [source({ seq: "8" })]).detailQuery,
    ).toBe("seq=8");
    expect(
      approvalPresentation(request, [
        source(
          { turn_id: "turn /1", item_id: "patch-1" },
          { history_turn_id: "turn /1" },
        ),
      ]).detailQuery,
    ).toBe("turn_id=turn+%2F1&item_id=patch-1");
    for (const marker of [
      { seq: 9 },
      { seq: 8, extra: true },
      { turn_id: "turn", item_id: "other" },
      { turn_id: "wrong", item_id: "patch-1" },
    ])
      expect(
        approvalPresentation(request, [
          source(marker, { history_turn_id: "turn" }),
        ]).detailQuery,
      ).toBeNull();
    const item = {
      id: "patch-1",
      type: "fileChange",
      changes: { "a.ts": { type: "update", unified_diff: "-old\n+new" } },
    };
    expect(
      approvalPresentation(request, [source({ seq: 8 })], item).fileChanges[0]
        .diff,
    ).toBe("-old\n+new");
    expect(
      approvalPresentation(request, [], { ...item, id: "other" }).fileChanges,
    ).toEqual([]);
    expect(
      approvalPresentation(request, [], { ...item, type: "commandExecution" })
        .fileChanges,
    ).toEqual([]);
  });

  it("quotes policy prefixes for display while preserving the original approval array", () => {
    const prefix = ["npm", "run", "test suite", "a'b", ""];
    const result = approvalPresentation(
      event("item/commandExecution/requestApproval", {
        proposedExecpolicyAmendment: prefix,
      }),
    );
    expect(result.actions.scoped?.description).toContain(
      "npm run 'test suite' 'a'\"'\"'b' ''",
    );
    expect(result.actions.scoped?.body).toEqual({
      result: {
        decision: {
          acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix },
        },
      },
    });
  });

  it("renders native change maps without claiming absent diffs mean no edits", () => {
    const result = approvalPresentation(
      event("item/fileChange/requestApproval", {
        changes: {
          "new.md": { type: "add", content: "hello" },
          "old.md": { type: "delete", content: "gone" },
          "large.ts": { type: "update" },
        },
      }),
    );
    expect(result.fileChanges.map((change) => change.diff)).toEqual([
      "+hello",
      "-gone",
      "",
    ]);
    expect(result.missingFileChanges).toBe(false);
  });

  it("leaves unsupported approvals unavailable and safely linkifies reasons", () => {
    expect(
      approvalPresentation(event("plugin/requestApproval", {})).actions.primary,
    ).toBeNull();
    expect(
      approvalReasonParts(
        "Read https://example.com/path). javascript:alert(1)",
      ),
    ).toEqual([
      { text: "Read " },
      { text: "https://example.com/path", href: "https://example.com/path" },
      { text: "). javascript:alert(1)" },
    ]);
  });

  it("normalizes plugin questions without crashing on malformed options or duplicate ids", () => {
    const questions = requestQuestions([
      null,
      {
        id: "q",
        header: "选择",
        question: "请选择",
        options: [null, {}, { label: "A", description: "First" }],
        multiSelect: true,
      },
      { id: "q", question: "Duplicate" },
      { id: "secret", question: "输入密码", isSecret: true },
    ]);
    expect(questions).toHaveLength(2);
    expect(questions[0].options).toEqual([
      { label: "A", description: "First" },
    ]);
    expect(questions[0].multiple).toBe(true);
    expect(questions[1].secret).toBe(true);
  });

  it("sends the selected answers under each original question id and excludes blank values", () => {
    const questions = requestQuestions([
      { id: "a", question: "First?" },
      { id: "b", question: "Second?" },
    ]);
    expect(
      questionResponse(questions, {
        a: ["Option A", "Option B"],
        b: [" ", "free text"],
        unrelated: ["ignore"],
      }),
    ).toEqual({
      answers: {
        a: { answers: ["Option A", "Option B"] },
        b: { answers: ["free text"] },
      },
    });
  });
});
