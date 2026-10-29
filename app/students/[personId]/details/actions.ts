"use server";
// The learner-details edit form's Server Action (learner-details design, "Edit Path"). Thin: the logic is submitDetails().
// Every export of this file is a public endpoint: export nothing else and use no inline "use server" closures.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { submitDetails, type DetailsFormState } from "@/server/admission-form";
import { pageRead } from "@/server/page-read";

export async function saveDetailsAction(_prev: DetailsFormState, formData: FormData): Promise<DetailsFormState> {
  const r = await pageRead(async (s) => submitDetails(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}
