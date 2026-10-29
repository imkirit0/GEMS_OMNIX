import { notFound } from "next/navigation";
import { countryOptions, DETAIL_KEYS } from "@/server/details";
import { pageRead } from "@/server/page-read";
import { getPerson } from "@/server/people";
import DetailsForm from "./form";

// Edit a learner's contact and family details (learner-details DD-3, DD-10). Needs student.view to see the learner
// and student.admit at a centre where they are admitted; anyone else gets the same 404 as a missing learner.
export default async function EditDetails({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const v = await pageRead((s) => getPerson(s, personId));
  if (v.editCentreId === null) notFound();
  const values = Object.fromEntries(DETAIL_KEYS.map((k) => [k, v.details?.[k] ?? ""]).filter(([, x]) => x !== ""));
  return (
    <main>
      <p><a href={`/students/${v.person.id}`}>Back to the learner</a></p>
      <h1>Details: {v.person.givenName} {v.person.familyName ?? ""}</h1>
      <DetailsForm countries={countryOptions()} initial={{ values, personId: v.person.id, centreId: String(v.editCentreId),
        version: String(v.detailsVersion), fieldErrors: {} }} />
    </main>
  );
}
