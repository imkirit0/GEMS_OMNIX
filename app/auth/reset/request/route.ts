import { auth, forbidden, form, sameOrigin, seeOther } from "@/server/auth/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const { login = "" } = await form(req);
  await auth().requestReset(login); // same answer whether or not the account exists (T-AUTH-008)
  return seeOther(req, "/reset?sent=1");
}
