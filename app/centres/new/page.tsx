import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { listGeography } from "@/server/centres";
import { AdminErrors } from "../../admin/catalogue/admin-errors";
import { CENTRE_FIELD_LABELS, CentreFields } from "../centre-form";

// New centre (centre onboarding DD-1): head office only (org.centre.manage); others get the same 404 as a missing page.
export default async function NewCentre({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string }> }) {
  const { error, detail } = await searchParams;
  const geo = await pageRead((s) => listGeography(s));
  if (!geo.canManage) notFound();
  return (
    <main>
      <p><a href="/centres">All centres</a></p>
      <h1>New centre</h1>
      <AdminErrors error={error} detail={detail} labels={CENTRE_FIELD_LABELS} />
      <p>A new centre starts inactive. Activate it once its class and GST details are set.</p>
      <form method="post" action="/centres/create">
        <label style={{ display: "block" }}>Code <input name="code" required maxLength={30} /></label>
        <CentreFields areas={geo.areas} />
        <button type="submit">Create centre</button>
      </form>
    </main>
  );
}
