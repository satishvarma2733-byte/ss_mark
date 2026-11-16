import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Two projects keep business tests separate from database tests that need a running local stack.
// Integration tests read the git-ignored .env.local written by `pnpm env:local` (local Supabase only).
// loadEnv reads .env.local for every mode; "local" itself is a reserved mode name.
const localEnv = loadEnv("development", process.cwd(), "");

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/worker/src/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/mobile/lib/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          env: localEnv,
          // Files share one database and the outbox; run them one at a time. Tests inside a file still use
          // parallel connections where concurrency is the point (e.g. simultaneous holds).
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000
        }
      }
    ]
  }
});
