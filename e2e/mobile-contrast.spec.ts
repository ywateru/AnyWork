import { test, expect } from "@playwright/test";

// Public native boundary for the real MobileApp account screen; no real account.
for (const theme of [
  { mode: "light", background: null },
  { mode: "dark", background: null },
  { mode: "light", background: "#171717" },
  { mode: "dark", background: "#ffffff" },
])
  test(`mobile destructive contrast ${theme.mode} custom=${theme.background ?? "none"}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("ra.appearance-v1", JSON.stringify(theme));
      const snapshot = {
        protocolVersion: 1,
        epoch: 1,
        phase: "signedIn",
        account: {
          scopeId: "contrast-fixture",
          label: "合成账号",
          email: "fixture@example.invalid",
        },
        devices: [],
        directoryState: "ready",
        revision: 1,
        errorCode: null,
      };
      (window as any).__TAURI__ = {
        core: {
          invoke: async (command: string, args?: any) => {
            if (
              command === "mobile_account_snapshot" ||
              command === "mobile_account_refresh"
            ) {
              if (args !== undefined) throw Error("Unexpected account args");
              return snapshot;
            }
            if (command === "plugin:mobile-system|appearance_set")
              return { dark: args.request.dark };
            if (command === "plugin:mobile-system|insets_get")
              return {
                unit: "cssPx",
                revision: 1,
                systemBars: { top: 24, right: 0, bottom: 24, left: 0 },
                cutout: { top: 0, right: 0, bottom: 0, left: 0 },
                ime: { top: 0, right: 0, bottom: 0, left: 0 },
                imeVisible: false,
              };
            if (command === "plugin:mobile-system|back_set_state") return {};
            throw Error("Unexpected command " + command);
          },
        },
        event: { listen: async () => () => {} },
      };
    }, theme);
    await page.goto("/mobile.html");
    await page.getByRole("button", { name: "账户与设置", exact: true }).click();
    const result = await page
      .getByRole("button", { name: "退出账号", exact: true })
      .evaluate((el) => {
        const text = getComputedStyle(el).color;
        const base = getComputedStyle(
          document.querySelector(".mobile-client")!,
        ).backgroundColor;
        const sample = document.createElement("div");
        sample.style.background = "var(--mobile-surface)";
        document.body.append(sample);
        const surface = getComputedStyle(sample).backgroundColor;
        sample.remove();
        const luminance = (rgb: string) => {
          const c = rgb
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              const x = v / 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
          return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        };
        const ratio = (bg: string) => {
          const a = luminance(text),
            b = luminance(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        return {
          text,
          base,
          surface,
          baseRatio: ratio(base),
          surfaceRatio: ratio(surface),
          token: getComputedStyle(document.documentElement)
            .getPropertyValue("--mobile-destructive")
            .trim(),
        };
      });
    console.log(
      "mobile-destructive-contrast",
      JSON.stringify({ theme, ...result }),
    );
    expect(result.token.toLowerCase()).toBe(
      theme.mode === "dark" ? "#ff8a80" : "#b42318",
    );
    expect(result.baseRatio).toBeGreaterThanOrEqual(4.5);
    expect(result.surfaceRatio).toBeGreaterThanOrEqual(4.5);
    if (theme.mode === "dark" && theme.background)
      await page.screenshot({
        path: testInfo.outputPath("dark-destructive-custom-background.png"),
      });
  });
