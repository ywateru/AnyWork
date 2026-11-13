import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: ["mobile-native.spec.ts", "mobile-contrast.spec.ts"],
  workers: 1,
  timeout: 30000,
  outputDir:
    process.env.ANYWORK_MOBILE_E2E_OUTPUT || "/tmp/anywork-mobile-ui-e2e",
  reporter: "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://127.0.0.1:3248",
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command:
      "../node_modules/.bin/vite --config vite.mobile.config.ts --host 127.0.0.1 --port 3248 --strictPort",
    cwd: path.resolve(__dirname, "../web"),
    url: "http://127.0.0.1:3248/mobile.html",
    reuseExistingServer: false,
  },
});
