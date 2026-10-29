import { pageRead } from "@/server/page-read";
import { canManageCentres, listCentres } from "@/server/centres";
import { exportAllowed, RateLimited } from "@/server/exports";

type Params = { q?: string; region?: string | string[]; area?: string | string[]; centre?: string | string[] };
const ids = (v?: string | string[]) => (v === undefined ? undefined : [v].flat().map(Number).filter(Number.isSafeInteger));

// Centre master list (FR-022). Only centres in the viewer's scope; URL filters can only narrow the list.
export default async function Centres({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const [centres, canExport, canManage] = await pageRead((s) => Promise.all([
    // over the search limit: say so on the page (a page cannot answer 429 itself)
    listCentres(s, { q: p.q, regionIds: ids(p.region), areaIds: ids(p.area), centreIds: ids(p.centre) })
      .catch((e: unknown) => (e instanceof RateLimited ? null : Promise.reject(e))),
    exportAllowed(s, "centres"),
    canManageCentres(s),
  ]));
  return (
    <main>
      <p><a href="/">Home</a>{canManage && <> · <a href="/centres/new">New centre</a></>} · <a href="/centres/geography">Regions and areas</a></p>
      <h1>Centres</h1>
      <form method="get">
        <label>Search code or name <input name="q" defaultValue={p.q ?? ""} /></label>
        <button type="submit">Search</button>
      </form>
      {centres === null && <p role="alert">Too many searches. Wait a minute and try again.</p>}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Area</th><th>Region</th><th>Status</th></tr></thead>
        <tbody>
          {(centres ?? []).map((c) => (
            <tr key={c.id}>
              <td><a href={`/centres/${c.id}`}>{c.code}</a></td><td>{c.name}</td><td>{c.area}</td><td>{c.region}</td><td>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {centres?.length === 0 && <p>No centres to show.</p>}
      {canExport && (
        <form method="post" action="/export/centres">
          {p.q && <input type="hidden" name="q" value={p.q} />}
          {(ids(p.region) ?? []).map((v) => <input key={`r${v}`} type="hidden" name="region" value={v} />)}
          {(ids(p.area) ?? []).map((v) => <input key={`a${v}`} type="hidden" name="area" value={v} />)}
          {(ids(p.centre) ?? []).map((v) => <input key={`c${v}`} type="hidden" name="centre" value={v} />)}
          <button type="submit">Download CSV</button>
        </form>
      )}
    </main>
  );
}
