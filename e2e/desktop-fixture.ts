import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Options = {
  stage?: "intro" | "account" | "prepare" | "console";
  owned?: boolean;
  off?: boolean;
  failSave?: boolean;
  failOpen?: boolean;
  holdOpen?: boolean;
  signedIn?: boolean;
  enabled?: boolean;
  unsupported?: boolean;
  authorizing?: boolean;
  reauth?: boolean;
  failEnable?: boolean;
  failStart?: boolean;
  holdStart?: boolean;
  port?: number;
  unauthorized?: boolean;
  snapshotUnavailable?: boolean;
  portal?: string;
  remoteClients?: { id: string; kind: string; connectedAt: number }[];
};
// Production files, strict synthetic native boundary. No real service/account.
export async function manager(page: Page, options: Options = {}) {
  await page.route("http://anywork-desktop.test/**", async (route) => {
    const name = new URL(route.request().url()).pathname;
    const root = path.resolve("desktop/ui/dist");
    const file = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
    if (!file.startsWith(`${root}${path.sep}`)) return route.abort();
    await route.fulfill({
      contentType: file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
      body: await readFile(file),
    });
  });
  await page.addInitScript((opts) => {
    const scope = window as unknown as {
      __TAURI__: unknown;
      desktopCalls: string[];
      desktopFixture: unknown;
      accountFixture: unknown;
      finishOpen?: () => void;
      pendingStarts: (() => void)[];
      failStart: boolean;
      accountSnapshotFailure: boolean;
      desktopSnapshotFailure: boolean;
      holdNextAccountSnapshot: boolean;
      releaseAccountSnapshot?: () => void;
    };
    const calls: string[] = [];
    scope.desktopCalls = calls;
    scope.pendingStarts = [];
    scope.failStart = !!opts.failStart;
    scope.accountSnapshotFailure = false;
    scope.desktopSnapshotFailure = !!opts.snapshotUnavailable;
    scope.holdNextAccountSnapshot = false;
    const config = {
      workspace: "/workspace",
      dataDirectory: "/workspace/data",
      port: opts.port ?? 3210,
      allowLAN: false,
      serverBinary: "",
      cloudflaredBinary: "",
      tunwgBinary: "",
      publicURL: "",
      relayDomain: "",
      forceRelay: false,
      welcomed: true,
    };
    const snapshot = {
      config,
      service: opts.off ? "off" : "running",
      owned: !opts.off && !!opts.owned,
      external: !opts.off && !opts.owned,
      authorized: !opts.off && !opts.unauthorized,
      info: { local_service_control: true, local_browser_session: true },
      clients: [{ id: "historical-local-client-not-remote" }],
      error: "",
      notice: "",
    };
    const signedIn =
      opts.signedIn ??
      (!opts.stage || opts.stage === "console" || opts.stage === "prepare");
    const account = {
      authorizationStatus: opts.unsupported
        ? "unsupported"
        : opts.authorizing
          ? "authorizing"
          : opts.reauth
            ? "reauthRequired"
            : signedIn
              ? "signedIn"
              : "signedOut",
      transactionId: opts.authorizing ? "test-transaction" : null,
      signedIn:
        signedIn && !opts.unsupported && !opts.reauth && !opts.authorizing,
      subject: signedIn ? "synthetic-owner" : null,
      accountLabel: signedIn ? "Test Account" : null,
      enabled: !!opts.enabled,
      busy: false,
      error: null,
      gridDeviceId: null,
      installationId: opts.enabled ? "public-installation" : null,
      publicKey: opts.enabled ? "public-key" : null,
      accountPortalUrl: opts.portal ?? "https://devices.fixture.invalid/app/",
      remoteClients: opts.remoteClients ?? [],
    };
    scope.desktopFixture = snapshot;
    scope.accountFixture = account;
    scope.__TAURI__ = {
      core: {
        invoke: async (
          command: string,
          args?: { action?: { type: string; config?: typeof config } },
        ) => {
          if (command === "desktop_snapshot") {
            if (scope.desktopSnapshotFailure)
              throw new Error("Fixture status unavailable");
            return structuredClone(snapshot);
          }
          if (command === "account_snapshot") {
            const result = structuredClone(account);
            if (scope.holdNextAccountSnapshot) {
              scope.holdNextAccountSnapshot = false;
              await new Promise<void>(
                (resolve) => (scope.releaseAccountSnapshot = resolve),
              );
            }
            if (scope.accountSnapshotFailure)
              throw new Error("Fixture account unavailable");
            return result;
          }
          if (command === "desktop_update_snapshot")
            return {
              currentVersion: "0.1.16",
              version: "",
              phase: "idle",
              enabled: false,
              supported: true,
              showNotice: false,
              downloaded: 0,
              total: null,
              lastChecked: null,
              notes: "",
              error: "",
            };
          calls.push(
            command === "desktop_action"
              ? `desktop_action:${args?.action?.type}`
              : command,
          );
          if (command === "desktop_start") {
            if (account.authorizationStatus !== "signedIn" || !account.signedIn)
              throw "DESKTOP_SIGN_IN_REQUIRED";
            if (opts.holdStart)
              await new Promise<void>((resolve) =>
                scope.pendingStarts.push(resolve),
              );
            if (scope.failStart) throw "Fixture preparation failed";
            Object.assign(snapshot, { service: "running", authorized: true });
            return;
          }
          if (command === "desktop_open") {
            if (account.authorizationStatus !== "signedIn" || !account.signedIn)
              throw "DESKTOP_SIGN_IN_REQUIRED";
            if (opts.holdOpen)
              await new Promise<void>(
                (resolve) => (scope.finishOpen = resolve),
              );
            if (opts.failOpen) throw "无法建立本机浏览器会话，请重试。";
            return;
          }
          if (command === "desktop_account_portal") return;
          if (command === "desktop_action") {
            if (args?.action?.type === "stop_server") {
              Object.assign(snapshot, {
                service: "off",
                authorized: false,
                owned: false,
                external: false,
              });
              return;
            }
            if (
              ["save_service", "save_programs"].includes(
                args?.action?.type ?? "",
              )
            ) {
              if (opts.failSave) throw "保存失败，请检查配置后重试。";
              Object.assign(config, args?.action?.config);
              return;
            }
          }
          if (command === "account_enable" || command === "account_disable") {
            if (opts.failEnable && command === "account_enable")
              throw "REMOTE_ENABLE_GRID_CONFIG";
            Object.assign(account, {
              enabled: command === "account_enable",
              installationId: "public-installation",
              publicKey: "public-key",
            });
            if (command === "account_disable") account.remoteClients = [];
            return;
          }
          if (command === "account_logout" || command === "account_cancel") {
            Object.assign(account, {
              authorizationStatus: "signedOut",
              transactionId: null,
              signedIn: false,
              enabled: false,
              accountLabel: null,
              subject: null,
              remoteClients: [],
            });
            return;
          }
          if (command === "account_begin") throw "登录服务暂时不可用，请重试。";
          throw new Error(`Unexpected IPC: ${command}`);
        },
      },
    };
  }, options);
  await page.goto("http://anywork-desktop.test/");
  await expect(
    page.getByRole("region", { name: "AnyWork 功能介绍", exact: true }),
  ).toBeVisible();
  if (options.stage !== "intro")
    await page.getByRole("button", { name: "开始使用", exact: true }).click();
  if (!options.stage || options.stage === "console")
    await expect(
      page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
    ).toBeVisible();
}
export const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { desktopCalls: string[] }).desktopCalls,
  );
export async function signInFixture(page: Page, subject = "synthetic-owner") {
  await page.evaluate(
    (owner) =>
      Object.assign(
        (window as unknown as { accountFixture: object }).accountFixture,
        {
          authorizationStatus: "signedIn",
          signedIn: true,
          subject: owner,
          accountLabel: "Test Account",
          transactionId: null,
        },
      ),
    subject,
  );
}
