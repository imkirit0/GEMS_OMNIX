"use server";
// The enquiry record's actions (enquiry design R5). Thin: the logic is in src/server/enquiry-form.ts.
// Every export of this file is a public endpoint: export nothing else and use no inline "use server" closures.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { submitCounsellor, submitEnquiryEdit, submitEnquiryStatus, submitFollowUp, type EnquiryFormState, type RecordFormState } from "@/server/enquiry-form";
import { pageRead } from "@/server/page-read";

export async function saveEnquiryAction(_prev: EnquiryFormState, formData: FormData): Promise<EnquiryFormState> {
  const r = await pageRead(async (s) => submitEnquiryEdit(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}

export async function enquiryStatusAction(_prev: RecordFormState, formData: FormData): Promise<RecordFormState> {
  const r = await pageRead(async (s) => submitEnquiryStatus(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}

export async function counsellorAction(_prev: RecordFormState, formData: FormData): Promise<RecordFormState> {
  const r = await pageRead(async (s) => submitCounsellor(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}

export async function followUpAction(_prev: RecordFormState, formData: FormData): Promise<RecordFormState> {
  const r = await pageRead(async (s) => submitFollowUp(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}
