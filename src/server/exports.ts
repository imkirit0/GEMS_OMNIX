// Exports (audit 06 §3; 11 P7). One mechanism for every dataset:
// - permission per dataset, PII columns only with pii.export (otherwise left out, and the audit says so);
// - one transaction, a server-side cursor, batches fetched only when the reader asks (bounded memory, T-RPT-013);
// - RLS plus the dataset's own permission gate per row, filters can only narrow (T-SEC-006, T-RLS-011);
// - audited with requested filters, actual scope, columns and row count (T-RPT-010); rate limited (T-SEC-015);
// - CSV cells that a spreadsheet would execute (= + - @) are neutralised.
import { Forbidden } from "./action";
import { withScope, type Tx } from "./db";
import { Prisma } from "../../generated/prisma/client";

export const EXPORT_POLICY = { perWindow: 10, windowMinutes: 10, batch: 500, timeoutMs: 120_000 } as const; // PMC (D-OPS-1)

export class RateLimited extends Error {
  override name = "RateLimited";
  constructor(readonly retryAfterSeconds: number) { super("too many exports"); }
}

export type ExportFilters = { regionIds?: number[]; areaIds?: number[]; centreIds?: number[]; q?: string };
type Column = { key: string; label: string; pii?: boolean };
type Dataset = {
  permission: string;
  /** may this session export at all? (centre-scoped: holds it somewhere; network-wide: holds it for all centres) */
  allowed: (tx: Tx) => Promise<boolean>;
  columns: Column[];
  query: (f: ExportFilters) => Prisma.Sql;
};

const ints = (xs?: number[]) => (xs && xs.length ? xs.filter(Number.isSafeInteger) : null);
const has = async (tx: Tx, perm: string, centre: number | null = null) =>
  (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission(${perm}, ${centre}::int) as ok`)[0]!.ok;

export const DATASETS: Record<string, Dataset> = {
  centres: {
    permission: "org.centre.export",
    allowed: async (tx) => (await tx.$queryRaw<{ ok: boolean }[]>`
      select cardinality(app.scoped_centre_ids('org.centre.export')) > 0 as ok`)[0]!.ok,
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "area", label: "Area" },
      { key: "region", label: "Region" }, { key: "status", label: "Status" }],
    query: (f) => Prisma.sql`
      select c.id, c.code, c.name, a.name as area, r.code as region, c.status::text as status
      from app.centre c join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id
      where c.id in (select unnest(app.scoped_centre_ids('org.centre.export'))) -- scope computed once, hash join
        and (${ints(f.regionIds)}::int[] is null or r.id = any (${ints(f.regionIds)}::int[]))
        and (${ints(f.areaIds)}::int[] is null or a.id = any (${ints(f.areaIds)}::int[]))
        and (${ints(f.centreIds)}::int[] is null or c.id = any (${ints(f.centreIds)}::int[]))
        and (${f.q?.trim() || null}::text is null or c.code ilike '%' || ${f.q?.trim() ?? ""}::text || '%' or c.name ilike '%' || ${f.q?.trim() ?? ""}::text || '%')
      order by c.id`,
  },
  users: {
    permission: "rbac.user.export",
    allowed: (tx) => has(tx, "rbac.user.export"),
    columns: [{ key: "login", label: "Login", pii: true }, { key: "display_name", label: "Name", pii: true },
      { key: "status", label: "Status" }, { key: "requires_totp", label: "Two-step required" }, { key: "roles", label: "Roles" }],
    query: () => Prisma.sql`
      select u.id, u.login, u.display_name, u.status::text as status, u.requires_totp,
             (select count(*)::int from app.role_assignment ra where ra.user_id = u.id) as roles
      from app.app_user u order by u.id`,
  },
};

/** One CSV cell. Leading = + - @ (and tab/CR) would be run as a formula by spreadsheet apps, so it is prefixed with '. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "bigint" ? v.toString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function denied(session: string, key: string, filters: ExportFilters) {
  await withScope(session, (tx) => tx.$executeRaw`insert into app.audit_log (user_id, action, outcome, detail)
    values (app.session_user_id(), ${`export.${key}`}, 'DENIED', ${JSON.stringify({ requested: filters })}::jsonb)`);
}

/**
 * Checks permission and rate limit up front (so the caller can answer 403/429), then returns a CSV stream.
 * The stream holds one transaction open while the reader consumes it; it never buffers more than a few batches.
 */
export async function exportCsv(session: string | undefined, key: string, filters: ExportFilters = {},
  { batch = EXPORT_POLICY.batch as number, onBatch }: { batch?: number; onBatch?: () => void } = {}) {
  const ds = DATASETS[key];
  if (!ds || !session) throw new Forbidden("unknown export");
  const pre = await withScope(session, async (tx) => ({
    allowed: await ds.allowed(tx),
    recent: (await tx.$queryRaw<{ n: number }[]>`select app.recent_export_count(${EXPORT_POLICY.windowMinutes}) as n`)[0]!.n,
    pii: await has(tx, "pii.export"),
  }));
  if (!pre.allowed) { await denied(session, key, filters); throw new Forbidden(`${ds.permission} denied`); }
  if (pre.recent >= EXPORT_POLICY.perWindow) throw new RateLimited(EXPORT_POLICY.windowMinutes * 60);

  const columns = ds.columns.filter((c) => !c.pii || pre.pii);
  const omitted = ds.columns.filter((c) => c.pii && !pre.pii).map((c) => c.key);
  const size = Math.max(1, Math.min(10_000, Math.trunc(batch)));
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let resume: (() => void) | null = null;
  let cancelled = false;
  let started = false;
  const demand = () => new Promise<void>((r) => { resume = r; });

  const run = () => withScope(session, async (tx) => {
    await tx.$executeRaw(Prisma.sql`declare export_cur no scroll cursor for ${ds.query(filters)}`);
    // after a cancel the stream is closed: enqueueing would throw, roll back the transaction and lose the audit row
    const send = (text: string) => { if (!cancelled) controller.enqueue(encoder.encode(text)); };
    send(columns.map((c) => csvCell(c.label)).join(",") + "\r\n");
    let rows = 0;
    for (;;) {
      if ((controller.desiredSize ?? 1) <= 0) await demand(); // backpressure: wait until the reader wants more
      if (cancelled) break;
      const page = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`fetch ${Prisma.raw(String(size))} from export_cur`);
      if (!page.length || cancelled) break;
      onBatch?.();
      rows += page.length;
      send(page.map((r) => columns.map((c) => csvCell(r[c.key])).join(",")).join("\r\n") + "\r\n");
    }
    await tx.$executeRaw`close export_cur`;
    await tx.$executeRaw`insert into app.audit_log (user_id, action, outcome, detail)
      values (app.session_user_id(), ${`export.${key}`}, 'OK', jsonb_build_object(
        'requested', ${JSON.stringify(filters)}::jsonb, 'scope', to_jsonb(app.visible_centre_ids()),
        'rows', ${rows}::int, 'columns', ${JSON.stringify(columns.map((c) => c.key))}::jsonb,
        'piiOmitted', ${JSON.stringify(omitted)}::jsonb, 'cancelled', ${cancelled}::boolean))`;
  }, { timeoutMs: EXPORT_POLICY.timeoutMs, retries: 0 });

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    // the transaction opens on the first read, so a stream that is never read never holds a connection or locks
    pull() {
      if (!started) {
        started = true;
        run().then(() => { if (!cancelled) controller.close(); }, (e) => { if (!cancelled) controller.error(e); });
        return;
      }
      resume?.();
      resume = null;
    },
    cancel() { cancelled = true; resume?.(); resume = null; },
  }, { highWaterMark: 0 }); // 0: pull() fires only when the reader asks, so nothing runs (or buffers) ahead of it

  return { filename: `${key}-${new Date().toISOString().slice(0, 10)}.csv`, columns: columns.map((c) => c.key), stream };
}

/** For showing a download button only to users who may use it. */
export const exportAllowed = (session: string | undefined, key: string) =>
  DATASETS[key] ? withScope(session, (tx) => DATASETS[key]!.allowed(tx)) : Promise.resolve(false);
