"use server";
// The admit form's Server Action (admission-screens DD-4). Kept thin: the logic is submitAdmission(), tested in vitest.
// Every export of this file is a public endpoint: export nothing else and use no inline "use server" closures.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { submitAdmission, type AdmitFormState } from "@/server/admission-form";
import { pageRead } from "@/server/page-read";

export async function admitAction(_prev: AdmitFormState, formData: FormData): Promise<AdmitFormState> {
  const r = await pageRead(async (s) => submitAdmission(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect); // post-redirect-get: a refresh never re-posts
  return r;
}
