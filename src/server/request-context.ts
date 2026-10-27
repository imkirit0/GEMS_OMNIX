// Per-request context (request id, client ip) for audit rows (T-AUD-001). Set by safeRoute for route handlers
// and by pageRead for pages; read by withScope, which hands it to the database as transaction-local settings.
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = { requestId: string; ip: string };
const store = new AsyncLocalStorage<RequestContext>();

export const requestContext = () => store.getStore();
export const withRequestContext = <T>(ctx: RequestContext, fn: () => T): T => store.run(ctx, fn);
