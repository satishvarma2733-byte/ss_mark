import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared workspace packages are consumed as TypeScript source, so Next must transpile them.
  transpilePackages: [
    "@simply-sit/api-client",
    "@simply-sit/contracts",
    "@simply-sit/db",
    "@simply-sit/design-tokens",
    "@simply-sit/domain",
    "@simply-sit/payments",
    "@simply-sit/providers",
    "@simply-sit/synthetic-data"
  ],
  // The Postgres driver is loaded by Node at runtime rather than bundled into server chunks.
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  reactStrictMode: true
};

export default nextConfig;
