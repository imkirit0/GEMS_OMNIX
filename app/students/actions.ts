"use server";
// The list page's search (admission-screens DD-13): the term travels only in this POST body, never in a URL.
// Every export of this file is a public endpoint: export nothing else and use no inline "use server" closures.
import type { SearchState } from "@/server/admission-form";
import { RateLimited } from "@/server/exports";
import { pageRead } from "@/server/page-read";
import { listAdmissions } from "@/server/people";

export async function searchAction(_prev: SearchState, formData: FormData): Promise<SearchState> {
  const q = String(formData.get("q") ?? "").trim();
  const centre = String(formData.get("centreId") ?? "");
  try {
    const rows = await pageRead((s) => listAdmissions(s, { q, ...(centre ? { centreId: Number(centre) } : {}) }));
    return { q, centreId: centre, rows };
  } catch (e) {
    if (e instanceof RateLimited) return { q, centreId: centre, rateLimited: true };
    throw e;
  }
}
