import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Shipped UI with strict synthetic IPC. No cloud, user service or credentials.
export async function manager(
  page: Page,
  options: {
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
  } = {},
) {
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
    };
    const calls: string[] = [];
    scope.desktopCalls = calls;
    const config = {
      workspace: "/workspace",
      dataDirectory: "/workspace/data",
      port: 3210,
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
      authorized: !opts.off,
      info: { local_service_control: true, local_browser_session: true },
      clients: [],
      error: "",
      notice: "",
    };
    const account = {
      authorizationStatus: opts.unsupported
        ? "unsupported"
        : opts.authorizing
          ? "authorizing"
          : opts.reauth
            ? "reauthRequired"
            : opts.signedIn
              ? "signedIn"
              : "signedOut",
      transactionId: opts.authorizing ? "test-transaction" : null,
      signedIn: !!opts.signedIn,
      accountLabel: opts.signedIn ? "Test Account" : null,
      subject: null,
      enabled: !!opts.enabled,
      busy: false,
      error: null,
      gridDeviceId: null,
      installationId: opts.enabled ? "public-installation" : null,
      publicKey: opts.enabled ? "public-key" : null,
    };
    scope.desktopFixture = snapshot;
    scope.accountFixture = account;
    scope.__TAURI__ = {
      core: {
        invoke: async (
          command: string,
          args?: { action?: { type: string; config?: typeof config } },
        ) => {
          if (command === "desktop_snapshot") return structuredClone(snapshot);
          if (command === "account_snapshot") return structuredClone(account);
          if (command === "desktop_update_snapshot")
            return {
              currentVersion: "0.1.13",
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
          if (command === "desktop_open") {
            if (opts.holdOpen)
              await new Promise<void>((resolve) => {
                scope.finishOpen = resolve;
              });
            if (opts.failOpen) throw "无法建立本机浏览器会话，请重试。";
            Object.assign(snapshot, { service: "running", authorized: true });
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
            return;
          }
          if (command === "account_logout" || command === "account_cancel") {
            Object.assign(account, {
              authorizationStatus: "signedOut",
              transactionId: null,
              signedIn: false,
              enabled: false,
              accountLabel: null,
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
    page.getByRole("heading", { name: "这台电脑", exact: true }),
  ).toBeVisible();
}

export const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { desktopCalls: string[] }).desktopCalls,
  );
