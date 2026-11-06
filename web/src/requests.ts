import type { AgentEvent } from "./types";

export interface RequestQuestion {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiple: boolean;
  secret: boolean;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const paths = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((path): path is string => typeof path === "string")
    : [];

export interface ApprovalAction {
  id: string;
  label: string;
  description?: string;
  body: { result: Record<string, unknown> };
}
export interface ApprovalFileChange {
  path: string;
  kind: string;
  movePath: string;
  diff: string;
}
type ApprovalDecision = string | Record<string, unknown>;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);
const execAmendment = (value: unknown): string[] | null =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((part) => typeof part === "string") &&
  !value.join(" ").match(/[\r\n]/u)
    ? value
    : null;
const networkAmendment = (value: unknown): Record<string, unknown> | null => {
  const amendment = record(value);
  return amendment &&
    exactKeys(amendment, ["host", "action"]) &&
    text(amendment.host).trim() &&
    ["allow", "deny"].includes(text(amendment.action))
    ? amendment
    : null;
};
function knownDecision(
  value: unknown,
  command: boolean,
): ApprovalDecision | null {
  if (typeof value === "string")
    return ["accept", "acceptForSession", "decline", "cancel"].includes(value)
      ? value
      : null;
  const decision = record(value);
  if (!command || !decision) return null;
  if (exactKeys(decision, ["acceptWithExecpolicyAmendment"])) {
    const body = record(decision.acceptWithExecpolicyAmendment);
    return body &&
      exactKeys(body, ["execpolicy_amendment"]) &&
      execAmendment(body.execpolicy_amendment)
      ? decision
      : null;
  }
  if (exactKeys(decision, ["applyNetworkPolicyAmendment"])) {
    const body = record(decision.applyNetworkPolicyAmendment);
    return body &&
      exactKeys(body, ["network_policy_amendment"]) &&
      networkAmendment(body.network_policy_amendment)
      ? decision
      : null;
  }
  return null;
}
function decisionAction(
  id: string,
  label: string,
  decision: ApprovalDecision,
  description?: string,
): ApprovalAction {
  return { id, label, description, body: { result: { decision } } };
}
function permissionPath(value: unknown): string {
  if (typeof value === "string") return value;
  const path = record(value);
  if (!path) return "";
  if (path.type === "path") return text(path.path);
  if (path.type === "glob_pattern") return text(path.pattern);
  if (path.type === "special") {
    const special = record(path.value);
    if (!special) return "";
    const base =
      (
        {
          root: "/",
          minimal: ":minimal",
          project_roots: ":project_roots",
          tmpdir: ":tmpdir",
          slash_tmp: "/tmp",
        } as Record<string, string>
      )[text(special.kind)] || text(special.path);
    return text(special.subpath)
      ? `${base.replace(/\/$/u, "")}/${special.subpath}`
      : base;
  }
  return JSON.stringify(path);
}
function permissionDetails(value: unknown, prefix = "") {
  const permissions = record(value),
    network = record(permissions?.network),
    fs = record(permissions?.fileSystem);
  const details: { label: string; value: string; code?: boolean }[] = [];
  if (network)
    details.push({
      label: `${prefix}网络`,
      value: network.enabled === false ? "禁止访问网络" : "允许访问网络",
    });
  const read = new Set(paths(fs?.read)),
    write = new Set(paths(fs?.write)),
    denied = new Set<string>();
  for (const value of Array.isArray(fs?.entries) ? fs.entries : []) {
    const entry = record(value);
    if (!entry) continue;
    const path = permissionPath(entry.path);
    if (!path) continue;
    if (entry.access === "read") read.add(path);
    else if (entry.access === "write") write.add(path);
    else if (entry.access === "deny") denied.add(path);
    else
      details.push({
        label: `${prefix}文件权限（${text(entry.access) || "未知访问模式"}）`,
        value: path,
        code: true,
      });
  }
  for (const [label, values] of [
    ["读取和写入文件", [...read].filter((path) => write.has(path))],
    ["读取文件", [...read].filter((path) => !write.has(path))],
    ["写入文件", [...write].filter((path) => !read.has(path))],
    ["禁止访问文件", [...denied]],
  ] as const)
    if (values.length)
      details.push({
        label: prefix + label,
        value: values.join("\n"),
        code: true,
      });
  return details;
}
function fileChangeSource(event: AgentEvent, relatedEvents: AgentEvent[]) {
  const itemId = event.params.itemId;
  const inline = record(event.params.item);
  if (inline?.type === "fileChange" && inline.id === itemId && text(itemId))
    return {
      item: inline,
      seq: event.seq,
      turnId: event.params.history_turn_id,
    };
  const source = relatedEvents
    .filter(
      (candidate) =>
        candidate.session_id === event.session_id &&
        candidate.seq <= event.seq &&
        text(itemId) &&
        candidate.params.item?.id === itemId &&
        candidate.params.item?.type === "fileChange",
    )
    .sort((a, b) => b.seq - a.seq)[0];
  return source
    ? {
        item: record(source.params.item)!,
        seq: source.seq,
        turnId: source.params.history_turn_id,
      }
    : null;
}
function fileDetailQuery(
  event: AgentEvent,
  source: ReturnType<typeof fileChangeSource>,
) {
  const marker = record(source?.item.history_detail);
  if (!source || !marker) return null;
  if (
    exactKeys(marker, ["seq"]) &&
    (typeof marker.seq === "number" || typeof marker.seq === "string") &&
    Number.isSafeInteger(Number(marker.seq)) &&
    Number(marker.seq) === source.seq
  )
    return new URLSearchParams({ seq: String(source.seq) }).toString();
  if (
    exactKeys(marker, ["turn_id", "item_id"]) &&
    text(marker.turn_id) &&
    marker.item_id === event.params.itemId &&
    (source.turnId == null || marker.turn_id === source.turnId)
  )
    return new URLSearchParams({
      turn_id: text(marker.turn_id),
      item_id: text(marker.item_id),
    }).toString();
  return null;
}
function requestFileChanges(
  event: AgentEvent,
  source: ReturnType<typeof fileChangeSource>,
  loadedFileItem?: Record<string, unknown> | null,
): ApprovalFileChange[] {
  const loaded =
    loadedFileItem?.id === event.params.itemId &&
    loadedFileItem?.type === "fileChange"
      ? loadedFileItem
      : null;
  const changes =
    loaded?.changes ?? event.params.changes ?? source?.item.changes;
  const entries = Array.isArray(changes)
    ? changes.map((change) => [record(change)?.path, change] as const)
    : Object.entries(record(changes) || {});
  return entries.flatMap(([path, value]) => {
    const change = record(value);
    if (!text(path) || !change) return [];
    const kindValue = record(change.kind);
    const kind =
      text(change.type) ||
      text(kindValue?.type) ||
      text(change.kind) ||
      "update";
    let diff = text(change.diff) || text(change.unified_diff);
    if (
      !diff &&
      typeof change.content === "string" &&
      ["add", "delete"].includes(kind)
    )
      diff = change.content
        .split("\n")
        .map((line) => `${kind === "add" ? "+" : "-"}${line}`)
        .join("\n");
    return [
      {
        path: text(path),
        kind,
        movePath: text(change.move_path) || text(kindValue?.move_path),
        diff,
      },
    ];
  });
}

/** Match the native card's action roles and the server's exact decision whitelist. */
export function approvalPresentation(
  event: AgentEvent,
  relatedEvents: AgentEvent[] = [],
  loadedFileItem?: Record<string, unknown> | null,
) {
  const params = event.params;
  const permission = event.method === "item/permissions/requestApproval";
  const fileChange = event.method === "item/fileChange/requestApproval";
  const commandApproval =
    event.method === "item/commandExecution/requestApproval";
  const permissions = record(params.permissions);
  const network = record(params.networkApprovalContext);
  const hiddenDetails = params.threadDetailLevel === "STEPS_PROSE";
  const details: { label: string; value: string; code?: boolean }[] = [];
  const command =
    typeof params.command === "string"
      ? params.command
      : Array.isArray(params.command)
        ? params.command.map((part: unknown) => JSON.stringify(part)).join(" ")
        : "";
  const writeStdin =
    params.kind === "writeStdin" || record(params.kind)?.type === "writeStdin";
  if (writeStdin)
    details.push({ label: "操作", value: "向正在运行的进程写入标准输入" });
  if (command)
    details.push({
      label: "命令",
      value: command,
      code: true,
    });
  if (text(params.cwd))
    details.push({ label: "工作目录", value: params.cwd, code: true });
  if (text(params.grantRoot))
    details.push({ label: "允许访问", value: params.grantRoot, code: true });
  if (text(network?.host))
    details.push({ label: "目标主机", value: text(network?.host), code: true });
  if (text(network?.protocol))
    details.push({
      label: "网络协议",
      value: text(network?.protocol),
      code: true,
    });
  details.push(
    ...permissionDetails(permissions),
    ...permissionDetails(params.additionalPermissions, "额外权限 · "),
  );
  const source = fileChange ? fileChangeSource(event, relatedEvents) : null;
  const fileChanges = fileChange
    ? requestFileChanges(event, source, loadedFileItem)
    : [];
  let primary: ApprovalAction | null = null,
    deny: ApprovalAction | null = null,
    scoped: ApprovalAction | null = null,
    leading: ApprovalAction | null = null;
  if (permission) {
    if (permissions && Object.keys(permissions).length) {
      primary = {
        id: "turn",
        label: "允许一次",
        body: { result: { permissions, scope: "turn" } },
      };
      if (!hiddenDetails)
        scoped = {
          id: "session",
          label: "允许此对话",
          body: { result: { permissions, scope: "session" } },
        };
    }
    deny = {
      id: "decline",
      label: "拒绝",
      body: { result: { permissions: {}, scope: "turn" } },
    };
  } else if (commandApproval || fileChange) {
    const explicit = params.availableDecisions != null;
    const candidates: unknown[] = explicit
      ? Array.isArray(params.availableDecisions)
        ? params.availableDecisions
        : []
      : ["accept", "acceptForSession", "decline", "cancel"];
    if (!explicit && commandApproval) {
      if (execAmendment(params.proposedExecpolicyAmendment))
        candidates.push({
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: params.proposedExecpolicyAmendment,
          },
        });
      for (const proposal of Array.isArray(
        params.proposedNetworkPolicyAmendments,
      )
        ? params.proposedNetworkPolicyAmendments
        : [])
        if (networkAmendment(proposal))
          candidates.push({
            applyNetworkPolicyAmendment: { network_policy_amendment: proposal },
          });
    }
    const decisions = candidates.flatMap((value) => {
      const known = knownDecision(value, commandApproval);
      return known ? [known] : [];
    });
    if (decisions.includes("accept"))
      primary = decisionAction("accept", "允许一次", "accept");
    if (decisions.includes("decline"))
      deny = decisionAction("decline", "拒绝", "decline");
    else if (decisions.includes("cancel"))
      deny = decisionAction("cancel", "取消", "cancel");
    const exec = decisions.find(
      (decision) => record(decision)?.acceptWithExecpolicyAmendment,
    );
    const amendment = record(record(exec)?.acceptWithExecpolicyAmendment)
      ?.execpolicy_amendment as string[] | undefined;
    if (fileChange && decisions.includes("acceptForSession"))
      scoped = decisionAction(
        "session",
        "允许所有修改",
        "acceptForSession",
        "允许在此对话中进行本次及后续文件编辑，无需再次询问",
      );
    else if (network && decisions.includes("acceptForSession"))
      scoped = decisionAction("session", "允许此对话", "acceptForSession");
    else if (!hiddenDetails && commandApproval && exec && amendment)
      scoped = decisionAction(
        "execpolicy",
        "允许类似命令",
        exec,
        `允许在此对话中使用以 ${amendment.map((part) => (/^[a-zA-Z0-9_./:=@%+,\-]+$/u.test(part) ? part : "'" + part.replaceAll("'", "'\"'\"'") + "'")).join(" ")} 开头的命令`,
      );
    else if (
      !hiddenDetails &&
      commandApproval &&
      explicit &&
      decisions.includes("acceptForSession")
    )
      scoped = decisionAction("session", "允许此对话", "acceptForSession");
    if (network) {
      const allow = decisions.find(
        (decision) =>
          record(
            record(record(decision)?.applyNetworkPolicyAmendment)
              ?.network_policy_amendment,
          )?.action === "allow",
      );
      if (allow) leading = decisionAction("network", "始终允许", allow);
    }
  }
  const reason = text(params.reason) || text(params.message);
  const destination = ["http", "https"].includes(text(network?.protocol))
    ? `${network?.protocol}://${text(network?.host)}`
    : text(network?.host);
  return {
    scopeLabel: permission ? "本回合有效" : "仅批准本次请求",
    approveLabel: "允许一次",
    identity: fileChange
      ? "编辑文件"
      : network
        ? "互联网访问"
        : permission
          ? permissions?.network && !permissions?.fileSystem
            ? "互联网访问"
            : "权限"
          : hiddenDetails
            ? "请求权限"
            : "终端",
    title: fileChange
      ? "允许 AnyWork 编辑以下文件？"
      : permission
        ? "允许授予这些权限？"
        : writeStdin
          ? "允许向此进程发送输入？"
          : network
            ? `允许 AnyWork 与 ${destination} 建立连接？`
            : commandApproval
              ? reason || "允许 AnyWork 运行此命令？"
              : "此审批请求暂不受支持",
    subtitle: network
      ? `${text(network.host)} 不在当前网络允许列表中`
      : permission || fileChange
        ? reason
        : "",
    reason,
    details,
    fileChanges,
    missingFileChanges: fileChange && fileChanges.length === 0,
    detailQuery: fileChange ? fileDetailQuery(event, source) : null,
    actions: { primary, deny, scoped, leading },
    rawPermissions: permissions
      ? JSON.stringify(permissions, null, 2)
      : record(params.additionalPermissions)
        ? JSON.stringify(params.additionalPermissions, null, 2)
        : null,
  };
}

/** Plain text stays plain text; only valid HTTP(S) URLs become external links. */
export function approvalReasonParts(value: string) {
  const parts: { text: string; href?: string }[] = [];
  let cursor = 0;
  for (const match of value.matchAll(/\bhttps?:\/\/[^\s"'<>]+/giu)) {
    const href = match[0].replace(/[),.;:!?]+$/u, "");
    try {
      if (!["http:", "https:"].includes(new URL(href).protocol)) continue;
    } catch {
      continue;
    }
    if (match.index > cursor)
      parts.push({ text: value.slice(cursor, match.index) });
    parts.push({ text: href, href });
    cursor = match.index + href.length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}

export function requestQuestions(value: unknown): RequestQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const question = record(entry);
    const id = text(question?.id);
    if (!id || !text(question?.question) || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        header: text(question?.header),
        question: text(question?.question),
        multiple: question?.multiSelect === true,
        secret: question?.isSecret === true,
        options: Array.isArray(question?.options)
          ? question.options.flatMap((entry) => {
              const option = record(entry);
              const label = text(option?.label);
              return label
                ? [{ label, description: text(option?.description) }]
                : [];
            })
          : [],
      },
    ];
  });
}

export function questionResponse(
  questions: RequestQuestion[],
  answers: Record<string, string[]>,
) {
  return {
    answers: Object.fromEntries(
      questions.map((question) => [
        question.id,
        {
          answers: (answers[question.id] || []).filter((answer) =>
            answer.trim(),
          ),
        },
      ]),
    ),
  };
}
