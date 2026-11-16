// Server and worker environment validation. Fails fast with a readable message; never echoes variable values.
import { z } from "zod";

const mockOnly = (name: string) =>
  z
    .literal("mock", { error: `${name} must be "mock" in Milestone 1; live providers are not configured or authorised` })
    .default("mock");

export const serverEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_MODE: mockOnly("APP_MODE"),
  PAYMENT_PROVIDER: mockOnly("PAYMENT_PROVIDER"),
  EMAIL_PROVIDER: mockOnly("EMAIL_PROVIDER"),
  MAPS_PROVIDER: mockOnly("MAPS_PROVIDER"),
  // Oldest native app version allowed to start bookings or extensions (M6). Unset: every version. Raise it only through
  // an approved recovery plan (TRD); older apps keep bookings, receipts, cancellation and support.
  NATIVE_MIN_VERSION: z
    .string()
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, { error: "NATIVE_MIN_VERSION: must look like 1.2.3" })
    .optional()
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "EXPO_PUBLIC_"];
const SECRET_NAME = /SECRET|PRIVATE|PASSWORD|SERVICE_ROLE|WEBHOOK/i;
const SECRET_VALUE = [/^sb_secret_/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /^rzp_live_/];

// Public-prefixed variables are bundled into browsers and apps, so they must never carry a secret (docs/agent-context.md).
export function findSecretLikePublicVars(source: Record<string, string | undefined>): string[] {
  return Object.entries(source)
    .filter(([name]) => PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .filter(([name, value]) => SECRET_NAME.test(name) || (value !== undefined && SECRET_VALUE.some((pattern) => pattern.test(value))))
    .map(([name]) => name)
    .sort();
}

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

const secret = (name: string) =>
  z.string({ error: `${name}: required (run pnpm env:local)` }).min(32, { error: `${name}: must be at least 32 characters` });

const mockGatewaySchema = z.object({
  MOCK_GATEWAY_KEY_ID: z.string({ error: "MOCK_GATEWAY_KEY_ID: required (run pnpm env:local)" }).regex(/^mock_key_[A-Za-z0-9]{8,40}$/),
  MOCK_GATEWAY_KEY_SECRET: secret("MOCK_GATEWAY_KEY_SECRET"),
  MOCK_GATEWAY_WEBHOOK_SECRET: secret("MOCK_GATEWAY_WEBHOOK_SECRET"),
  NEXT_PUBLIC_APP_URL: z.url({ error: "NEXT_PUBLIC_APP_URL: required" })
});

// Mock gateway credentials (local, generated). Server-only; the key secret and webhook secret never reach a client.
export function loadMockGatewayConfig(source: Record<string, string | undefined> = process.env) {
  const parsed = mockGatewaySchema.safeParse({ ...source, NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL ?? source.APP_URL });
  if (!parsed.success) throw new EnvValidationError(parsed.error.issues.map((issue) => issue.message));
  return {
    keyId: parsed.data.MOCK_GATEWAY_KEY_ID,
    keySecret: parsed.data.MOCK_GATEWAY_KEY_SECRET,
    webhookSecret: parsed.data.MOCK_GATEWAY_WEBHOOK_SECRET,
    appUrl: parsed.data.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")
  };
}

// Secret for deriving arrival QR tokens and PINs (packages/domain arrival.ts). Server-only.
export function loadArrivalSecret(source: Record<string, string | undefined> = process.env): string {
  const parsed = secret("ARRIVAL_CODE_SECRET").safeParse(source.ARRIVAL_CODE_SECRET);
  if (!parsed.success) throw new EnvValidationError(parsed.error.issues.map((issue) => issue.message));
  return parsed.data;
}

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const problems: string[] = [];
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".")}: ${issue.message}`);
  }
  for (const name of findSecretLikePublicVars(source)) {
    problems.push(`${name}: public-prefixed variables are bundled into clients and must not hold a secret`);
  }
  if (problems.length > 0 || !parsed.success) throw new EnvValidationError(problems);
  return parsed.data;
}
