// Centre master, read-only (FR-022 list, FR-022.02 view). Two gates: RLS limits rows to the session's scope,
// and every row must also pass org.centre.view for that centre. Filters can only narrow, never widen (T-SEC-005).
import { withScope } from "./db";
import { limitSearch } from "./rate-limit";

export type CentreRow = { id: number; code: string; name: string; status: string; area: string; region: string };
export type CentreFilter = { regionIds?: number[]; areaIds?: number[]; centreIds?: number[]; q?: string };

const ints = (xs?: number[]) => (xs && xs.length ? xs.filter(Number.isSafeInteger) : null);

// A search term counts against the search rate limit (T-SEC-015); a plain or filtered list does not.
export function listCentres(session: string | undefined, f: CentreFilter = {}): Promise<CentreRow[]> {
  return withScope(session, async (tx) => {
    if (f.q?.trim()) await limitSearch(tx);
    return tx.$queryRaw<CentreRow[]>`
    select c.id, c.code, c.name, c.status::text, a.name as area, r.code as region
    from app.centre c join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id
    where c.id in (select unnest(app.scoped_centre_ids('org.centre.view'))) -- scope computed once, hash join
      and (${ints(f.regionIds)}::int[] is null or r.id = any (${ints(f.regionIds)}::int[]))
      and (${ints(f.areaIds)}::int[] is null or a.id = any (${ints(f.areaIds)}::int[]))
      and (${ints(f.centreIds)}::int[] is null or c.id = any (${ints(f.centreIds)}::int[]))
      and (${f.q?.trim() || null}::text is null or c.code ilike '%' || ${f.q?.trim() ?? ""} || '%' or c.name ilike '%' || ${f.q?.trim() ?? ""} || '%')
    order by c.code`;
  });
}

/** null for missing, out-of-scope and forbidden alike, so callers answer 404 in every case (T-SEC-001). */
export function getCentre(session: string | undefined, id: number): Promise<CentreRow | null> {
  if (!Number.isSafeInteger(id)) return Promise.resolve(null);
  return withScope(session, async (tx) => (await tx.$queryRaw<CentreRow[]>`
    select c.id, c.code, c.name, c.status::text, a.name as area, r.code as region
    from app.centre c join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id
    where c.id = ${id} and app.has_permission('org.centre.view', c.id)`)[0] ?? null);
}
