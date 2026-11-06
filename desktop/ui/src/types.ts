export type Kind = "quick" | "named" | "relay";
export type Phase =
  | "off"
  | "checking"
  | "starting"
  | "validating"
  | "running"
  | "reconnecting"
  | "stopping"
  | "error";
export type Config = {
  workspace: string;
  dataDirectory: string;
  port: number;
  allowLAN: boolean;
  serverBinary: string;
  cloudflaredBinary: string;
  tunwgBinary: string;
  publicURL: string;
  relayDomain: string;
  forceRelay: boolean;
  welcomed: boolean;
};
export type Route = {
  phase: Phase;
  url: string;
  error: string;
  restart_attempts?: number;
  retry_in_seconds?: number;
  address_changed?: boolean;
};
export type Client = {
  id: string;
  address: string;
  user_agent: string;
  last_seen: number;
};
export type Snapshot = {
  config: Config;
  token: string;
  secrets: string[];
  secrets_loaded: boolean;
  service: Phase;
  owned: boolean;
  external: boolean;
  authorized: boolean;
  info?: { local_service_control?: boolean } | null;
  clients: Client[];
  routes: Route[];
  error: string;
  notice: string;
};
