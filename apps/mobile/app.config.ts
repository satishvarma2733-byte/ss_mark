// Per-variant identity: each build profile gets its own name, bundle/package ID and URL scheme (docs/02-TRD.md section 7),
// so development and preview builds can be installed side by side and never receive each other's deep links.
// Production identifiers are organisation-owned and are added at release preparation (M6); until then they fail closed.
import type { ConfigContext, ExpoConfig } from "expo/config";

const VARIANTS = {
  development: { nameSuffix: " (Dev)", id: "com.simplysit.customer.dev", scheme: "simplysit-dev" },
  preview: { nameSuffix: " (Preview)", id: "com.simplysit.customer.preview", scheme: "simplysit-preview" }
} as const;

type Variant = keyof typeof VARIANTS;

function resolveVariant(value: string | undefined): Variant {
  const variant = value ?? "development";
  if (variant in VARIANTS) return variant as Variant;
  throw new Error(`Unknown APP_VARIANT "${variant}". Supported: ${Object.keys(VARIANTS).join(", ")}.`);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant(process.env.APP_VARIANT);
  const identity = VARIANTS[variant];
  return {
    ...config,
    name: `Simply Sit${identity.nameSuffix}`,
    slug: config.slug ?? "simply-sit-customer",
    scheme: identity.scheme,
    ios: { ...config.ios, bundleIdentifier: identity.id },
    android: { ...config.android, package: identity.id },
    extra: { ...config.extra, appVariant: variant }
  };
};
