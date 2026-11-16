// Release switches and native compatibility for pages and routes (M6). The database enforces the switches; this only
// lets pages explain a paused state up front and lets booking-creating routes refuse a native app that is too old.
import { CLIENT_VERSION_HEADER, isOlderVersion, type ServiceStatus } from "@simply-sit/contracts";
import { asAnon, DomainError, getDb, serviceStatus } from "@simply-sit/db";
import { getServerEnv } from "./server-env";

export async function loadServiceStatus(): Promise<ServiceStatus> {
  const switches = await asAnon(getDb(), (tx) => serviceStatus(tx));
  return { ...switches, native_min_version: getServerEnv().NATIVE_MIN_VERSION ?? null };
}

// Native apps send "android/1.2.3" or "ios/1.2.3"; the web client sends nothing and is always current.
export function assertSupportedClient(request: Request) {
  const minimum = getServerEnv().NATIVE_MIN_VERSION;
  const header = request.headers.get(CLIENT_VERSION_HEADER);
  if (!minimum || header === null) return;
  const version = header.split("/")[1] ?? "";
  if (isOlderVersion(version, minimum)) throw new DomainError("UPDATE_REQUIRED", { minimum_version: minimum });
}
