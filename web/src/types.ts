export interface Session {
  id: string;
  thread_id: string | null;
  title: string;
  cwd: string;
  agent: string;
  model: string | null;
  policy: "manual" | "auto";
  status: string;
  archived: boolean;
  created_at: number;
  updated_at: number;
  external?: boolean;
  auxiliary?: boolean;
}
export interface WorkspaceInfo {
  path: string;
  name: string;
  root: boolean;
  sessions: number;
}
export interface Plugin {
  /** A configured entry can be attempted; this is not a host liveness probe. */
  available?: boolean;
  setup_hint?: string | null;
  id: string;
  name: string;
  capabilities: string[];
  protocol_version: number;
}
// The transport preserves plugin payloads to avoid losing new agent event fields.
export interface AgentEvent {
  seq: number;
  session_id: string;
  method: string;
  params: Record<string, any>;
  request_id?: string | number | null;
  created_at: number;
}
export interface ConversationTurn {
  id: string;
  messages: Message[];
  status: "unknown" | "inProgress" | "completed" | "interrupted" | "failed";
  startedAt?: number;
  completedAt?: number;
  finalStartedAt?: number;
  turnStartedAtMs?: number;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "reasoning" | "error";
  text: string;
  item?: Record<string, any>;
  startedAtMs?: number;
  createdAtMs?: number;
  attachments?: string[];
}
export interface Connection {
  url: string;
  token: string;
  scope?: string;
  transport?: import("./remoteTransport").BusinessTransport;
}
