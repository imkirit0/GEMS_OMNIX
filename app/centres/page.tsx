import { pageRead } from "@/server/page-read";
import { listCentres } from "@/server/centres";

type Params = { q?: string; region?: string | string[]; area?: string | string[]; centre?: string | string[] };
const ids = (v?: string | string[]) => (v === undefined ? undefined : [v].flat().map(Number).filter(Number.isSafeInteger));

// Centre master list (FR-022). Only centres in the viewer's scope; URL filters can only narrow the list.
export default async function Centres({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const centres = await pageRead((s) => listCentres(s, { q: p.q, regionIds: ids(p.region), areaIds: ids(p.area), centreIds: ids(p.centre) }));
  return (
    <main>
      <p><a href="/">Home</a></p>
      <h1>Centres</h1>
      <form method="get">
        <label>Search code or name <input name="q" defaultValue={p.q ?? ""} /></label>
        <button type="submit">Search</button>
      </form>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Area</th><th>Region</th><th>Status</th></tr></thead>
        <tbody>
          {centres.map((c) => (
            <tr key={c.id}>
              <td><a href={`/centres/${c.id}`}>{c.code}</a></td><td>{c.name}</td><td>{c.area}</td><td>{c.region}</td><td>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {centres.length === 0 && <p>No centres to show.</p>}
    </main>
  );
}
