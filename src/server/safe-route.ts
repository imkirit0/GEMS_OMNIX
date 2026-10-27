// T-SEC-012: an unexpected error never reaches the client. The response carries a reference id only;
// the details go to the server log under the same id (legacy GEMS leaks raw SQL, FR-005.01).
import { randomUUID } from "node:crypto";

type Handler<A extends unknown[]> = (req: Request, ...rest: A) => Promise<Response>;

export function safeRoute<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      const ref = randomUUID();
      console.error(JSON.stringify({ level: "error", ref, path: new URL(req.url).pathname, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
      return new Response(`Something went wrong. Reference: ${ref}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-request-id": ref },
      });
    }
  };
}
