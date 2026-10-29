import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/http";
import { currentUser } from "@/server/auth/session";
import { canAdminister } from "@/server/rbac";
import { listCentres } from "@/server/centres";

// Nothing is rendered without a valid session.
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [admin, centres] = await Promise.all([canAdminister(session), listCentres(session)]);
  return (
    <main>
      <h1>GEMS OMNIX</h1>
      <p>Signed in as {user.displayName} ({user.login}).</p>
      {centres.length > 0 && <p><a href="/centres">Centres</a> ({centres.length})</p>}
      <p><a href="/students">Students</a> · <a href="/tickets">Tickets</a> · <a href="/tickets/approvals">My approvals</a></p>
      {admin && <p><a href="/admin/users">User and role administration</a></p>}
      <form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>
    </main>
  );
}
