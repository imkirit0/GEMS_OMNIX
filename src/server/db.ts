// The only way application code reaches the database (audit 06 §3 "Pooling").
// Every unit of work is one transaction that starts by binding a transaction-local session id;
// row-level security derives the scope from it. The raw client is deliberately not exported.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client";

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
    cache.__gemsAppDb = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return cache.__gemsAppDb;
}

// P2034 = Prisma's write-conflict / deadlock error. Retries reuse the same callback, so callers must
// keep side effects inside the transaction (and use idempotency keys for anything external).
const RETRYABLE = "P2034";

export async function withScope<T>(
  sessionToken: string | undefined,
  fn: (tx: Tx, ctx: Ctx) => Promise<T>,
  { retries = 3, timeoutMs }: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  if (!sessionToken) throw new ScopeError("missing session");
  for (let attempt = 0; ; attempt++) {
    try {
      return await appDb().$transaction(async (tx) => {
        await tx.$queryRaw`select set_config('app.session_id', ${sessionToken}, true)`;
        const [row] = await tx.$queryRaw<{ uid: string | null }[]>`select app.session_user_id()::text as uid`;
        // fail loudly rather than render an empty page (T-RLS-006/007)
        if (!row?.uid) throw new ScopeError("invalid, expired or revoked session");
        return fn(tx, { userId: row.uid });
      }, timeoutMs ? { timeout: timeoutMs, maxWait: 10_000 } : undefined); // default 5 s; long exports pass more
    } catch (e) {
      if (attempt < retries && (e as { code?: string }).code === RETRYABLE) continue;
      throw e;
    }
  }
}
