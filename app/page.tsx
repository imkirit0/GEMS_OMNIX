import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";

// Nothing is rendered without a valid session.
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <main>
      <h1>GEMS OMNIX</h1>
      <p>Signed in as {user.displayName} ({user.login}).</p>
      <form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>
    </main>
  );
}
