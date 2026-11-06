import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Exercise the shipped manager frontend with isolated Tauri IPC; never touch live services.
export async function manager(
  page: Page,
  options: {
    available?: boolean;
    failFirst?: boolean;
    hold?: boolean;
    supported?: boolean;
    reconnecting?: boolean;
    changed?: boolean;
    owned?: boolean;
    off?: boolean;
    unconfigured?: boolean;
    lan?: boolean;
    failSave?: boolean;
    legacyService?: boolean;
  } = {},
) {
  await page.route("http://anywork-desktop.test/**", async (route) => {
    const name = new URL(route.request().url()).pathname;
    const root = path.resolve("desktop/ui/dist");
    const file = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
    if (!file.startsWith(`${root}${path.sep}`)) return route.abort();
    const type = file.endsWith(".html")
      ? "text/html"
      : file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";
    await route.fulfill({ contentType: type, body: await readFile(file) });
  });
  await page.addInitScript((opts) => {
    const scope = window as unknown as {
      __TAURI__: unknown;
      desktopCalls: string[];
      desktopFixture: unknown;
      finishInstall?: () => void;
    };
    const calls: string[] = [];
    scope.desktopCalls = calls;
    let available = !!opts.available,
      attempts = 0;
    const config = {
      workspace: "/fixture",
      dataDirectory: "/fixture/data",
      port: 3210,
      allowLAN: !!opts.lan,
      serverBinary: "",
      cloudflaredBinary: "",
      tunwgBinary: "",
      publicURL: opts.unconfigured ? "" : "https://fixture.example.com",
      relayDomain: opts.unconfigured ? "" : "relay.example.com",
      forceRelay: false,
      welcomed: true,
    };
    const routes = [
      { phase: "off", url: "", error: "" },
      { phase: "off", url: "", error: "" },
      { phase: "running", url: "https://relay.example.com", error: "" },
    ];
    if (opts.off || opts.unconfigured)
      routes.forEach((route) =>
        Object.assign(route, { phase: "off", url: "" }),
      );
    if (opts.reconnecting || opts.changed)
      Object.assign(routes[0], {
        phase: opts.changed ? "running" : "reconnecting",
        url: "https://fixture.trycloudflare.com",
        error: opts.changed ? "" : "保留匿名隧道并等待网络恢复。",
        restart_attempts: 2,
        retry_in_seconds: opts.changed ? 0 : 4,
        address_changed: !!opts.changed,
      });
    const snapshot = {
      config,
      token: "fixture-access-key-00000000",
      secrets: opts.unconfigured
        ? ["", "", ""]
        : ["", "fixture-token", "fixture-relay"],
      secrets_loaded: true,
      service: opts.off ? "off" : "running",
      owned: !opts.off && !!opts.owned,
      external: !opts.off && !opts.owned,
      authorized: !opts.off,
      info: { local_service_control: !opts.legacyService },
      clients: [],
      routes,
      error: "",
      notice: "",
    };
    scope.desktopFixture = snapshot;
    scope.__TAURI__ = {
      core: {
        invoke: async (
          command: string,
          args?: {
            action?: {
              type: string;
              kind: string;
              config?: typeof config;
              token?: string;
              secret?: string;
            };
            kind?: string;
            value?: string;
          },
        ) => {
          if (command === "desktop_snapshot") return structuredClone(snapshot);
          if (command === "desktop_preview") return null;
          if (command === "desktop_lan") return "http://192.0.2.10:3210";
          // Status polling is read-only, like desktop_snapshot above. Keep the
          // operation log strict so an unintended install/start still fails.
          if (command === "desktop_update_snapshot")
            return {
              currentVersion: "0.1.2",
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
              ? `${args?.action?.type}:${args?.action?.kind}`
              : command,
          );
          if (command === "desktop_cloudflared_status")
            return {
              available,
              canDownload: opts.supported !== false,
              reason: "找不到 cloudflared，或程序位置已失效。",
            };
          if (command === "desktop_install_cloudflared") {
            attempts++;
            if (opts.hold)
              await new Promise<void>((resolve) => {
                scope.finishInstall = resolve;
              });
            if (opts.failFirst && attempts === 1)
              throw "无法获取 cloudflared 官方版本，请检查网络后重试。";
            available = true;
            config.cloudflaredBinary = "/fixture/AnyWork/bin/cloudflared";
            return config.cloudflaredBinary;
          }
          if (
            command === "desktop_action" &&
            args?.action?.type === "start_route"
          ) {
            routes[["quick", "named", "relay"].indexOf(args.action.kind)] = {
              phase: "starting",
              url: "",
              error: "",
            };
          }
          if (
            command === "desktop_action" &&
            args?.action?.type === "stop_route"
          )
            routes[["quick", "named", "relay"].indexOf(args.action.kind)] = {
              phase: "off",
              url: "",
              error: "",
            };
          if (
            command === "desktop_action" &&
            args?.action?.type === "stop_server"
          ) {
            Object.assign(snapshot, {
              service: "off",
              authorized: false,
              owned: false,
              external: false,
            });
            routes.forEach((route) =>
              Object.assign(route, { phase: "off", url: "" }),
            );
          }
          if (
            command === "desktop_action" &&
            args?.action?.type === "start_server"
          )
            Object.assign(snapshot, {
              service: "running",
              authorized: true,
              owned: true,
              external: false,
            });
          if (command === "desktop_pairing") {
            const url =
              routes[["quick", "named", "relay"].indexOf(args!.kind!)].url;
            return {
              url,
              link: "anywork://pair?fixture=1",
              svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
            };
          }
          if (
            command === "desktop_action" &&
            args?.action?.type.startsWith("save_")
          ) {
            if (opts.failSave) throw "保存失败，请检查配置后重试。";
            Object.assign(config, args.action.config);
            if (args.action.token) snapshot.token = args.action.token;
            if (args.action.kind && args.action.secret)
              snapshot.secrets[
                ["quick", "named", "relay"].indexOf(args.action.kind)
              ] = args.action.secret;
            snapshot.notice = "配置已保存";
          }
          return null;
        },
      },
    };
  }, options);
  await page.goto("http://anywork-desktop.test/");
  await expect(page.locator(".network-map")).toBeVisible();
}
