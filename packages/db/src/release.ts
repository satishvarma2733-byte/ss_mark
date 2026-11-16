// Release switches (M6). Enforcement is in the database guard triggers; these wrappers only read and change the rows.
import type postgres from "postgres";
import type { ReleaseSwitch, ServiceStatus } from "@simply-sit/contracts";

type Tx = postgres.TransactionSql;

async function callJson<T>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export function serviceStatus(tx: Tx) {
  return callJson<Pick<ServiceStatus, "bookings_open" | "extensions_open">>(tx`select app.service_status() as result`);
}

export function adminReleaseSwitches(tx: Tx) {
  return callJson<{ items: ReleaseSwitch[] }>(tx`select app.admin_release_switches() as result`);
}

export function adminSetReleaseSwitch(
  tx: Tx,
  input: { key: ReleaseSwitch["key"]; is_open: boolean; reason: string; expected_version: number },
  requestId: string | null = null
) {
  return callJson<ReleaseSwitch & { changed: boolean }>(tx`
    select app.admin_set_release_switch(${input.key}, ${input.is_open}, ${input.reason}, ${input.expected_version}::integer,
                                        ${requestId}::uuid) as result`);
}
