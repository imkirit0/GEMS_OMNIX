import { Forbidden } from "@/server/action";
import { forbidden, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "@/server/auth/http";
import { ScopeError } from "@/server/db";
import { exportCsv, RateLimited } from "@/server/exports";
import { safeRoute } from "@/server/safe-route";

const ids = (v: FormDataEntryValue[]) => v.map(Number).filter(Number.isSafeInteger);

// Downloads are same-origin POSTs (a cross-site GET could otherwise spend the victim's export quota).
async function handle(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const session = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!session) return seeOther(req, "/login");
  const { dataset } = await params;
  const form = await req.formData();
  const q = form.get("q");
  try {
    const { filename, stream } = await exportCsv(session, dataset, {
      regionIds: ids(form.getAll("region")), areaIds: ids(form.getAll("area")), centreIds: ids(form.getAll("centre")),
      q: typeof q === "string" ? q : undefined,
    });
    return new Response(stream, { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    } });
  } catch (e) {
    if (e instanceof RateLimited) return new Response("Too many exports. Try again later.", { status: 429, headers: { "retry-after": String(e.retryAfterSeconds) } });
    if (e instanceof Forbidden) return new Response("Not found", { status: 404 }); // same as an unknown dataset
    if (e instanceof ScopeError) return seeOther(req, "/login?error=expired");
    throw e;
  }
}

export const POST = safeRoute(handle);
