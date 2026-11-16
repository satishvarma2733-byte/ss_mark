// SERVER-ONLY database access for the API and worker. Lint blocks imports from mobile and client packages.
// Every unit of work runs in one transaction under a request role, so RLS and auth.uid() apply to server reads too:
//   anon          - public catalogue
//   authenticated - claims from a token the server has already verified (never from client-supplied JSON)
//   simply_worker - background jobs, with grants only on app.* job functions
import postgres from "postgres";
import { DOMAIN_ERRORS, isDomainErrorCode, type DomainErrorCode } from "@simply-sit/contracts";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export type VerifiedClaims = {
  sub: string;
  role: "authenticated";
  aal: "aal1" | "aal2";
  amr?: { method: string; timestamp: number }[];
  session_id?: string;
};

export function createDb(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    // int8 values (paise, counters) stay exact: parse to number only when safely representable.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => value.toString(),
        parse: (value: string) => {
          const parsed = Number(value);
          if (!Number.isSafeInteger(parsed)) throw new Error("int8 value exceeds safe integer range");
          return parsed;
        }
      }
    }
  });
}

let shared: Sql | undefined;
export function getDb(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DomainError("DEPENDENCY_UNAVAILABLE", { reason: "database_not_configured" });
  shared ??= createDb(url);
  return shared;
}

async function inRole<T>(sql: Sql, role: "anon" | "authenticated" | "simply_worker", claims: object, work: (tx: Tx) => Promise<T>) {
  try {
    return (await sql.begin(async (tx) => {
      // Role names are fixed literals; claims are bound as a parameter.
      await tx.unsafe(`set local role ${role}`);
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      return work(tx);
    })) as T;
  } catch (error) {
    throw toDomainError(error) ?? error;
  }
}

export function asAnon<T>(sql: Sql, work: (tx: Tx) => Promise<T>) {
  return inRole(sql, "anon", { role: "anon" }, work);
}

export function asUser<T>(sql: Sql, claims: VerifiedClaims, work: (tx: Tx) => Promise<T>) {
  return inRole(sql, "authenticated", claims, work);
}

export function asWorker<T>(sql: Sql, work: (tx: Tx) => Promise<T>) {
  return inRole(sql, "simply_worker", { role: "simply_worker" }, work);
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: DomainErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return DOMAIN_ERRORS[this.code].status;
  }
}

function parseDetail(detail: unknown): Record<string, unknown> {
  if (typeof detail !== "string" || detail.length === 0) return {};
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Maps database errors to stable domain errors. Anything unrecognised is left for the caller to treat as 500.
export function toDomainError(error: unknown): DomainError | undefined {
  if (error instanceof DomainError) return error;
  if (!error || typeof error !== "object") return undefined;
  const pg = error as { code?: string; message?: string; detail?: string; errno?: string };
  if (pg.code === "P0001" && pg.message) {
    // A guard trigger firing means a code path tried to break an invariant: treat as an internal error.
    if (pg.message === "IMMUTABLE_RECORD") return new DomainError("INTERNAL_ERROR", { reason: "invariant_guard" });
    if (isDomainErrorCode(pg.message)) return new DomainError(pg.message, parseDetail(pg.detail));
  }
  if (pg.code === "23P01") return new DomainError("SLOT_UNAVAILABLE");
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") return new DomainError("OPERATION_IN_PROGRESS");
  if (pg.code === "ECONNREFUSED" || pg.code === "CONNECT_TIMEOUT" || pg.errno === "ECONNREFUSED") {
    return new DomainError("DEPENDENCY_UNAVAILABLE");
  }
  return undefined;
}

export * from "./domain";
export * from "./partner";
export * from "./extensions";
export * from "./support";
export * from "./finance";
export * from "./notifications";
export * from "./release";
