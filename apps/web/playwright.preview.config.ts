// TEMPORARY design-preview config (delete after use): runs e2e/zz-design-preview.spec.ts against the dev server on :3000.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const rootEnv = resolve(__dirname, "../../.env.local");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /zz-(design-preview|mock-bookings)\.preview\.ts/,
  workers: 1,
  timeout: 300_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", viewport: { width: 1440, height: 1024 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1024 } } }]
});
