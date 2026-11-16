import { NextResponse } from "next/server";
import type { Health } from "@simply-sit/contracts";
import { CURRENT_POLICY_VERSION } from "@simply-sit/domain";
import { getProviders, getServerEnv } from "../../../../lib/server-env";

export const dynamic = "force-dynamic";

export function GET() {
  const env = getServerEnv();
  const providers = getProviders();
  const body: Health = {
    status: "ok",
    service: "simply-sit-web",
    mode: env.APP_MODE,
    providers: { payment: "mock", email: providers.email.mode, maps: providers.maps.mode },
    policyVersion: CURRENT_POLICY_VERSION,
    checkedAt: new Date().toISOString()
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
