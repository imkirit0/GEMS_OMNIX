// The only way application code reaches the database (audit 06 §3 "Pooling").
// Every unit of work is one transaction that starts by binding a transaction-local session id;
// row-level security derives the scope from it. The raw client is deliberately not exported.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client";
import { requestContext } from "./request-context";

export type Tx = Prisma.TransactionClient;
export type Ctx = { userId: string };

export class ScopeError extends Error {
  override name = "ScopeError";
}

const cache = globalThis as unknown as { __gemsAppDb?: PrismaClient };

function appDb(): PrismaClient {
  if (!cache.__gemsAppDb) {
    const connectionString = process.env["APP_DATABASE_URL"];
    if (!connectionString) throw new Error("APP_DATABASE_URL is not set");
    // C-26 (E-030): Supabase's transaction pooler can drop a connection or silently stop answering under load.
    // Fail fast instead of hanging until the platform kills the request.
    cache.__gemsAppDb = new PrismaClient({ adapter: new PrismaPg({ connectionString, ...DB_POLICY }) });
  }
  return cache.__gemsAppDb;
}

// PMC (D-OPS-1). The query timeout is per query, so a streamed export's batches each stay well inside it.
export const DB_POLICY = {
  connectionTimeoutMillis: 10_000, // waiting for a pool connection or the pooler's handshake
  query_timeout: 60_000, // a query with no answer by then is treated as a lost connection
  keepAlive: true, // TCP keepalive notices a dead peer on an idle socket
  keepAliveInitialDelayMillis: 10_000,
} as const;

// P2034 = Prisma's write-conflict / deadlock error. Retries reuse the same callback, so callers must
// keep side effects inside the transaction (and use idempotency keys for anything external).
const RETRYABLE = "P2034";

// A lost connection, in any of the shapes the pg driver, the Prisma adapter or Postgres report it.
const LOST_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01", "57P02", "57P03", "08000", "08003", "08006"]);
const LOST_KINDS = new Set(["ConnectionClosed", "SocketTimeout"]);
const LOST_MESSAGES = /Connection terminated|connection error and is not queryable|Query read timeout|timeout exceeded when trying to connect/i;
export function isConnectionLost(e: unknown): boolean {
  for (let x = e as { code?: unknown; message?: unknown; cause?: unknown; meta?: { driverAdapterError?: { cause?: { kind?: string; originalCode?: string } } } } | undefined,
    depth = 0; x && depth < 5; x = x.cause as typeof x, depth++) {
    const cause = x.meta?.driverAdapterError?.cause;
    if (LOST_KINDS.has(cause?.kind ?? "") || LOST_CODES.has(cause?.originalCode ?? "")) return true;
    if (typeof x.code === "string" && LOST_CODES.has(x.code)) return true;
    if (typeof x.message === "string" && LOST_MESSAGES.test(x.message)) return true;
  }
  return false;
}

export async function withScope<T>(
  sessionToken: string | undefined,
  fn: (tx: Tx, ctx: Ctx) => Promise<T>,
  { retries = 3, timeoutMs }: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  if (!sessionToken) throw new ScopeError("missing session");
  for (let attempt = 0; ; attempt++) {
    // Set once fn has returned, i.e. Prisma is about to COMMIT. A connection lost before that point
    // committed nothing, so the attempt can safely be repeated; one lost during COMMIT has an unknown outcome.
    let committing = false;
    try {
      return await appDb().$transaction(async (tx) => {
        const rc = requestContext();
        // transaction-local: the session drives RLS; request id and ip are read by app.audit()
        await tx.$queryRaw`select set_config('app.session_id', ${sessionToken}, true),
          set_config('app.request_id', ${rc?.requestId ?? ""}, true), set_config('app.client_ip', ${rc?.ip ?? ""}, true)`;
        const [row] = await tx.$queryRaw<{ uid: string | null }[]>`select app.session_user_id()::text as uid`;
        // fail loudly rather than render an empty page (T-RLS-006/007)
        if (!row?.uid) throw new ScopeError("invalid, expired or revoked session");
        const result = await fn(tx, { userId: row.uid });
        committing = true;
        return result;
      }, timeoutMs ? { timeout: timeoutMs, maxWait: 10_000 } : undefined); // default 5 s; long exports pass more
    } catch (e) {
      const retryable = (e as { code?: string }).code === RETRYABLE || (!committing && isConnectionLost(e));
      if (attempt < retries && retryable) continue;
      throw e;
    }
  }
}
