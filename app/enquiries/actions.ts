"use server";
// The enquiry list and form actions (enquiry design R5). Thin: the logic is in src/server/enquiry-form.ts, tested in vitest.
// Every export of this file is a public endpoint: export nothing else and use no inline "use server" closures.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { searchEnquiries, submitBulk, submitEnquiry, type EnquiryFormState, type EnquirySearchState, type RecordFormState } from "@/server/enquiry-form";
import { pageRead } from "@/server/page-read";

const FILTERS = ["centreId", "statusId", "kind", "counsellorId", "from", "to", "due"] as const;

export async function searchEnquiriesAction(_prev: EnquirySearchState, formData: FormData): Promise<EnquirySearchState> {
  const filter = Object.fromEntries(FILTERS.map((k) => [k, String(formData.get(k) ?? "")]).filter(([, v]) => v !== ""));
  return pageRead((s) => searchEnquiries(s, formData, filter));
}

export async function createEnquiryAction(_prev: EnquiryFormState, formData: FormData): Promise<EnquiryFormState> {
  const r = await pageRead(async (s) => submitEnquiry(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect); // post-redirect-get
  return r;
}

export async function bulkEnquiriesAction(_prev: RecordFormState, formData: FormData): Promise<RecordFormState> {
  const r = await pageRead(async (s) => submitBulk(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}
