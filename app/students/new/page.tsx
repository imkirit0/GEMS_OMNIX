import { randomUUID } from "node:crypto";
import { admitOptions } from "@/server/people";
import { pageRead } from "@/server/page-read";
import AdmitForm from "./form";

// Admit a learner (R-150; admission-screens design). No centre with student.admit: 404.
export default async function NewStudent() {
  const options = await pageRead((s) => admitOptions(s));
  return (
    <main>
      <p><a href="/students">All students</a></p>
      <h1>Admit a learner</h1>
      {/* a fresh form id per page load (DD-10); the form keeps the posted one across round trips */}
      <AdmitForm options={options} initial={{ values: {}, admissionId: randomUUID(), fieldErrors: {} }} />
    </main>
  );
}
