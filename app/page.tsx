import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/http";
import { currentUser } from "@/server/auth/session";
import { canAdminister } from "@/server/rbac";
import { listCentres } from "@/server/centres";
import { canManageCatalogue } from "@/server/catalogue";
import { canViewEnquiries } from "@/server/enquiry";
import { batchCentres } from "@/server/batches";
import { ledgerCentres } from "@/server/ledger";
import { holdCentres } from "@/server/holds";

// Nothing is rendered without a valid session.
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [admin, centres, catalogue, enquiries, batches, ledger, holds] = await Promise.all([canAdminister(session), listCentres(session), canManageCatalogue(session),
    canViewEnquiries(session), batchCentres(session), ledgerCentres(session), holdCentres(session)]);
  return (
    <main>
      <h1>GEMS OMNIX</h1>
      <p>Signed in as {user.displayName} ({user.login}).</p>
      {centres.length > 0 && <p><a href="/centres">Centres</a> ({centres.length})</p>}
      {enquiries && <p><a href="/enquiries">Enquiries</a> · <a href="/calls">Calls</a></p>}
      {batches.length > 0 && <p><a href="/batches">Batches</a></p>}
      {ledger.length > 0 && <p><a href="/ledger/day-book">Day book</a></p>}
      {holds.length > 0 && <p><a href="/fees/holds">Fee holds</a></p>}
      <p><a href="/students">Students</a> · <a href="/tickets">Tickets</a> · <a href="/tickets/approvals">My approvals</a></p>
      {admin && <p><a href="/admin/users">User and role administration</a></p>}
      {catalogue && <p><a href="/admin/catalogue">Catalogue</a></p>}
      <form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>
    </main>
  );
}
