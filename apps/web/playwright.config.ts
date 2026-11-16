import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Local stack values (database, Auth, Mailpit) written by `pnpm env:local`. Never points at a hosted project.
const rootEnv = resolve(__dirname, "../../.env.local");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The e2e suite runs against a production build so it matches what a deployment would serve.
export default defineConfig({
  testDir: "./e2e",
  // Auth flows share the local Auth server's per-IP rate limits, so files run one at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 180_000,
    // The mock payment provider builds checkout/return URLs and delivers webhooks to this origin.
    // NATIVE_MIN_VERSION equals the current app version, so only an older native client is refused (release.spec.ts).
    env: { APP_ALLOWED_ORIGINS: "http://localhost:3100", NEXT_PUBLIC_APP_URL: "http://localhost:3100", NATIVE_MIN_VERSION: "0.1.0" }
  }
});
