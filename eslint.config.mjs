// Flat ESLint config shared by every workspace. Next.js and Expo add framework rules in their own packages.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/.expo/**", "**/dist/**", "**/coverage/**", "**/playwright-report/**", "**/test-results/**", "apps/mobile/android/**", "apps/mobile/ios/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }]
    }
  },
  {
    // Client bundles must never include server-only domain logic or provider adapters (docs/02-TRD.md section 2).
    files: ["apps/mobile/**/*.{ts,tsx}", "packages/api-client/**/*.ts", "packages/contracts/**/*.ts", "packages/design-tokens/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@simply-sit/domain", message: "Server-only. Clients display server quotes; they never compute payable totals." },
            { name: "@simply-sit/providers", message: "Server-only. Provider adapters and credentials stay on the server." },
            { name: "@simply-sit/db", message: "Server-only. Clients reach data through the API, never a database connection." },
            { name: "@simply-sit/payments", message: "Server-only. Payment truth is decided on the server from provider fetches." }
          ]
        }
      ]
    }
  }
);
