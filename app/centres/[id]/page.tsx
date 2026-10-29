import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { getCentre, listGeography } from "@/server/centres";
import { AdminErrors } from "../../admin/catalogue/admin-errors";
import { CENTRE_FIELD_LABELS, CentreFields } from "../centre-form";

const LABEL: Record<string, string> = { SCHOOL: "School", COLLEGE: "College", FRANCHISE: "Franchise", OWN: "Own",
  STATE: "Within the state", INTERSTATE: "Interstate" };

// Centre view (FR-022.02). Missing, out-of-scope and forbidden all render the same 404 (T-SEC-001). Head office
// (org.centre.manage) also edits it and activates or deactivates it (centre onboarding).
export default async function CentreView({ params, searchParams }: { params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, detail, saved } = await searchParams;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const [centre, geo] = await pageRead((s) => Promise.all([getCentre(s, Number(id)), listGeography(s)]));
  if (!centre) notFound();
  const v = (x: string | null) => (x === null ? "Not set" : LABEL[x] ?? x);
  const save = `/centres/${centre.id}/save`;
  return (
    <main>
      <p><a href="/centres">All centres</a></p>
      <h1>{centre.code}: {centre.name}</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={CENTRE_FIELD_LABELS} />
      <dl>
        <dt>Area</dt><dd>{centre.area}</dd>
        <dt>Region</dt><dd>{centre.region}</dd>
        <dt>Status</dt><dd>{centre.status}</dd>
        <dt>Class</dt><dd>{v(centre.classCode)}</dd>
        <dt>Email</dt><dd>{v(centre.email)}</dd>
        <dt>Phone</dt><dd>{v(centre.phone)}</dd>
        <dt>Address</dt><dd style={{ whiteSpace: "pre-line" }}>{v(centre.address)}</dd>
        <dt>Category</dt><dd>{v(centre.category)}</dd>
        <dt>Ownership</dt><dd>{v(centre.ownership)}</dd>
        <dt>GST</dt><dd>{centre.gstEnabled ? `Registered, ${v(centre.gstSupply)}, GSTIN ${v(centre.gstin)}` : "Not registered"}</dd>
        <dt>Agreement</dt><dd>{v(centre.agreementFrom)} to {v(centre.agreementTo)}</dd>
        <dt>Opened on</dt><dd>{v(centre.openedOn)}</dd>
      </dl>
      {centre.canManage && (
        <>
          <h2>Edit</h2>
          <form method="post" action={save}>
            <input type="hidden" name="op" value="details" />
            <CentreFields areas={geo.areas} c={centre} />
            <button type="submit">Save</button>
          </form>
          <h2>{centre.status === "ACTIVE" ? "Deactivate" : "Activate"}</h2>
          {centre.status !== "ACTIVE" && <p>Activation needs a class and, when GST registered, the supply and GSTIN.</p>}
          <form method="post" action={save}>
            <input type="hidden" name="op" value="active" />
            <input type="hidden" name="active" value={centre.status === "ACTIVE" ? "0" : "1"} />
            <input name="reason" required placeholder="Reason" aria-label="Reason" />{" "}
            <button type="submit">{centre.status === "ACTIVE" ? "Deactivate" : "Activate"}</button>
          </form>
          <p>
            <a href="/admin/catalogue/centres">Set the class</a> · <a href="/admin/users">Create a login</a>{" "}
            (staff can sign in once the centre is active)
          </p>
        </>
      )}
    </main>
  );
}
