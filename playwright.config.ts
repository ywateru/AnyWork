import { defineConfig, devices } from "@playwright/test";
const baseURL = `http://127.0.0.1:${process.env.ANYWORK_E2E_PORT || "3219"}`;
export default defineConfig({
  testDir: "./e2e",
  // Bundled native-client fixtures require mobile.html and their own Vite server.
  testIgnore: [
    "**/e2e/mobile-native.spec.ts",
    "**/e2e/mobile-contrast.spec.ts",
  ],
  outputDir: process.env.ANYWORK_E2E_OUTPUT_DIR || "test-results",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { args: ["--no-sandbox"] },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "android-web", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "python3 scripts/e2e-server.py",
    url: `${baseURL}/api/health`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 15000,
  },
});
