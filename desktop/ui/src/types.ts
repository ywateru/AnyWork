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
export type Snapshot = {
  config: Config;
  service: Phase;
  owned: boolean;
  external: boolean;
  authorized: boolean;
  info?: {
    workspace: string;
    local_service_control?: boolean;
    local_browser_session?: boolean;
  } | null;
  clients: { id: string }[];
  error: string;
  notice: string;
};
