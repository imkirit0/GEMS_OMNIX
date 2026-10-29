import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { countryOptions, DEFAULT_NATIONALITY } from "@/server/details";
import { enrolPrefill, type Prefill } from "@/server/enquiry-form";
import { admitOptions } from "@/server/people";
import { pageRead } from "@/server/page-read";
import AdmitForm from "./form";

// Admit a learner (R-150; admission-screens design). No centre with student.admit: 404.
// ?enquiry=<id> enrols an enquiry (enquiry design DD-9): the form is pre-filled from it and the admission links back.
// Only the id is in the URL; an enquiry that may not be enrolled here is the same 404 (R19).
export default async function NewStudent({ searchParams }: { searchParams: Promise<{ enquiry?: string | string[] }> }) {
  const { enquiry } = await searchParams;
  if (Array.isArray(enquiry) || (enquiry !== undefined && !/^\d{1,18}$/.test(enquiry))) notFound();
  const { options, prefill } = await pageRead(async (s) => ({
    options: await admitOptions(s),
    prefill: enquiry ? await enrolPrefill(s, enquiry) : null as Prefill | null,
  }));
  return (
    <main>
      <p><a href="/students">All students</a>{enquiry && <> · <a href={`/enquiries/${enquiry}`}>Back to the enquiry</a></>}</p>
      <h1>{enquiry ? `Enrol enquiry ${enquiry}` : "Admit a learner"}</h1>
      {prefill && prefill.also.length > 0 && (
        <p>Also interested in: {prefill.also.map((c) => `${c.code} ${c.name}${c.offered ? "" : " (no longer offered)"}`).join(", ")}</p>
      )}
      {/* a fresh form id per page load (DD-10); the form keeps the posted one across round trips */}
      {/* nationality defaults to India here, in the initial state only (learner-details DD-12, R8) */}
      <AdmitForm options={options} countries={countryOptions()}
        initial={{ values: prefill?.values ?? { nationality: DEFAULT_NATIONALITY }, admissionId: randomUUID(), fieldErrors: {},
          ...(enquiry ? { enquiryId: enquiry } : {}) }} />
    </main>
  );
}
