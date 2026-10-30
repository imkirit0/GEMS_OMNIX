import { canManageCatalogue } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";

// The catalogue index (catalogue-masters design): readable by every signed-in user (DD-4).
export default async function Catalogue() {
  await pageRead((s) => canManageCatalogue(s)); // requires a session
  return (
    <main>
      <p><a href="/">Home</a></p>
      <h1>Catalogue</h1>
      <ul>
        <li><a href="/admin/catalogue/courses">Courses</a></li>
        <li><a href="/admin/catalogue/masters/categories">Course categories</a></li>
        <li><a href="/admin/catalogue/masters/divisions">Course divisions</a></li>
        <li><a href="/admin/catalogue/masters/classes">Centre classes</a></li>
        <li><a href="/admin/catalogue/certifications">Certifications</a></li>
        <li><a href="/admin/catalogue/years">Academic years</a></li>
        <li><a href="/admin/catalogue/centres">Class per centre</a></li>
        <li><a href="/admin/catalogue/masters/enquiry-paths">Enquiry paths</a></li>
        <li><a href="/admin/catalogue/masters/enquiry-types">Enquiry types</a></li>
        <li><a href="/enquiries/statuses">Enquiry statuses</a></li>
        <li><a href="/admin/catalogue/masters/fee-categories">Fee categories</a></li>
        <li><a href="/admin/fees">Fees: types, instalments and plans</a></li>
      </ul>
    </main>
  );
}
