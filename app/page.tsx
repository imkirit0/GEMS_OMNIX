import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/http";
import { currentUser } from "@/server/auth/session";
import { canAdminister } from "@/server/rbac";

// Nothing is rendered without a valid session.
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const admin = await canAdminister((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <main>
      <h1>GEMS OMNIX</h1>
      <p>Signed in as {user.displayName} ({user.login}).</p>
      {admin && <p><a href="/admin/users">User and role administration</a></p>}
      <form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>
    </main>
  );
}
