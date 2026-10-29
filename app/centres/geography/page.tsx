import { pageRead } from "@/server/page-read";
import { listGeography } from "@/server/centres";
import { AdminErrors } from "../../admin/catalogue/admin-errors";
import { CENTRE_FIELD_LABELS } from "../centre-form";

// Regions and areas (centre onboarding DD-4): everyone reads; org.centre.manage adds and renames. Areas never move.
export default async function Geography({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { regions, areas, canManage } = await pageRead((s) => listGeography(s));
  const save = "/centres/geography/save";
  const rename = (op: string, id: number, name: string, label: string) => (
    <form method="post" action={save}>
      <input type="hidden" name="op" value={op} /><input type="hidden" name="id" value={id} />
      <input name="name" required maxLength={100} defaultValue={name} aria-label={`Name of ${label}`} />{" "}
      <button type="submit">Rename</button>
    </form>
  );
  return (
    <main>
      <p><a href="/centres">All centres</a></p>
      <h1>Regions and areas</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={CENTRE_FIELD_LABELS} />
      {regions.map((r) => (
        <section key={r.id}>
          <h2>{r.code}: {r.name}</h2>
          {canManage && rename("region.update", r.id, r.name, r.code)}
          <ul>
            {areas.filter((a) => a.regionId === r.id).map((a) => (
              <li key={a.id}>{a.name}{canManage && rename("area.update", a.id, a.name, `${r.code} / ${a.name}`)}</li>
            ))}
          </ul>
          {canManage && (
            <form method="post" action={save}>
              <input type="hidden" name="op" value="area.create" /><input type="hidden" name="regionId" value={r.id} />
              <input name="name" required maxLength={100} aria-label={`New area in ${r.code}`} placeholder="New area" />{" "}
              <button type="submit">Add area</button>
            </form>
          )}
        </section>
      ))}
      {canManage && (
        <form method="post" action={save}>
          <h2>New region</h2>
          <input type="hidden" name="op" value="region.create" />
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={100} /></label>{" "}
          <button type="submit">Add region</button>
        </form>
      )}
    </main>
  );
}
