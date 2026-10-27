// Foundation acceptance tests: T-RLS (database isolation), authorization, audit, numbering.
// Runs against the local Docker database; the app connects as gems_app through PgBouncer (transaction mode).
import { beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { ScopeError, withScope } from "../src/server/db";
import { Forbidden, scopedAction } from "../src/server/action";
import { allocate, financialYear, formatNumber } from "../src/server/numbering";
import { asAdmin, audits, C, PERIOD, reset, seriesCurrent, T } from "./fixtures";

const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b);
const visibleCentres = (token: string) =>
  withScope(token, async (tx) => ids(await tx.$queryRaw<{ id: number }[]>`select id from app.centre`));
const allocateAt = (token: string, centreId: number, docType = "FEEREC") =>
  scopedAction(token, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId },
    (tx) => allocate(tx, { centreId, docType, period: PERIOD }), (n) => ({ number: Number(n) }));

describe("database isolation (T-RLS)", () => {
  beforeEach(() => reset());

  test("T-RLS-001 runtime roles: not superuser, no BYPASSRLS, own nothing, no DDL", async () => {
    const roles = await asAdmin((db) => db.query(`
      select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
             (select count(*)::int from pg_class where relowner = r.oid) as owned
      from pg_roles r where rolname in ('gems_app', 'gems_job', 'gems_report_ro') order by 1`).then((r) => r.rows));
    expect(roles).toHaveLength(3);
    for (const r of roles) expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, owned: 0 });
    const app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await app.connect();
    try {
      for (const sql of ["create table app.x (i int)", "alter table app.centre disable row level security",
        "drop policy scope_select on app.centre", "update app.app_session set revoked_at = null",
        "select * from app.role_assignment", "select * from app.app_user"]) {
        await expect(app.query(sql), sql).rejects.toMatchObject({ code: "42501" });
      }
    } finally { await app.end(); }
  });

  test("T-RLS-002 every table with centre_id (and centre itself) has ENABLE+FORCE RLS and per-command policies", async () => {
    const rows = await asAdmin((db) => db.query(`
      select c.relname, c.relrowsecurity rls, c.relforcerowsecurity force,
             array(select distinct cmd from pg_policies p where p.schemaname = 'app' and p.tablename = c.relname) cmds
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r'
        and (c.relname = 'centre' or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'centre_id' and not a.attisdropped))
      order by 1`).then((r) => r.rows));
    expect(rows.map((r) => r.relname)).toEqual(["centre", "number_series"]); // not vacuous
    for (const r of rows) {
      expect(r.rls && r.force, r.relname).toBe(true);
      const needed = r.relname === "centre" ? ["SELECT"] : ["SELECT", "INSERT", "UPDATE", "DELETE"]; // centre is read-only to the app so far
      for (const cmd of needed) expect(r.cmds, `${r.relname} ${cmd}`).toContain(cmd);
    }
  });

  test("T-RLS-005 definer functions: inventory, fixed search_path, owner bypasses RLS; scope truth table", async () => {
    const fns = await asAdmin((db) => db.query(`
      select p.proname, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') fixed,
             (select rolsuper or rolbypassrls from pg_roles where oid = p.proowner) owner_bypasses
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.prosecdef order by 1`).then((r) => r.rows));
    expect(fns.map((f) => f.proname)).toEqual(["account_usable", "has_permission", "scoped_centre_ids", "session_user_id", "visible_centre_ids"]);
    for (const f of fns) expect(f, f.proname).toMatchObject({ fixed: true, owner_bypasses: true });

    expect(await visibleCentres(T.uA)).toEqual([C.A]);
    expect(await visibleCentres(T.uB)).toEqual([C.B]);
    expect(await visibleCentres(T.hoR1)).toEqual([C.A, C.A2]);
    expect(await visibleCentres(T.hoArea)).toEqual([C.A]);
    expect(await visibleCentres(T.hoAll)).toEqual([C.A, C.A2, C.B]);
  });

  test("T-RLS-006/007 missing, forged, expired, revoked or disabled-user sessions fail loudly", async () => {
    for (const tok of [undefined, "", "forged-token", T.expired, T.revoked, T.disabled]) {
      await expect(withScope(tok, async () => 1), String(tok)).rejects.toBeInstanceOf(ScopeError);
    }
    const app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await app.connect();
    try { // without the guard: zero rows, and other GUCs grant nothing
      await app.query("begin");
      await app.query("select set_config('app.user_id', '00000000-0000-0000-0000-0000000000ff', true)");
      expect((await app.query("select count(*)::int n from app.centre")).rows[0].n).toBe(0);
      expect((await app.query("select count(*)::int n from app.number_series")).rows[0].n).toBe(0);
      await app.query("rollback");
    } finally { await app.end(); }
  });

  test("T-RLS-008 cross-centre writes under a centre-A session affect nothing", async () => {
    const res = await withScope(T.uA, async (tx) => ({
      upd: await tx.$executeRaw`update app.number_series set current = 99 where centre_id = ${C.B}`,
    }));
    expect(res.upd).toBe(0);
    await expect(withScope(T.uA, (tx) => tx.$executeRaw`update app.number_series set centre_id = ${C.B} where centre_id = ${C.A}`))
      .rejects.toThrow();
    expect(await seriesCurrent(C.B)).toBe(0);
  });

  test("T-RLS-009 pooled transactions never inherit another session's scope", async () => {
    const runs = Array.from({ length: 400 }, (_, i) => (i % 2 ? T.uA : T.uB));
    const leaks = (await Promise.all(runs.map(async (tok) => {
      const seen = await visibleCentres(tok);
      return JSON.stringify(seen) !== JSON.stringify(tok === T.uA ? [C.A] : [C.B]);
    }))).filter(Boolean).length;
    expect(leaks).toBe(0);
    const raw = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); // no session bound at all
    await raw.connect();
    try { expect((await raw.query("select current_setting('app.session_id', true) s")).rows[0].s || "").toBe(""); }
    finally { await raw.end(); }
  });

  test("T-RLS-010 the transaction handle is dead after withScope returns", async () => {
    let leaked: Parameters<Parameters<typeof withScope>[1]>[0] | undefined;
    await withScope(T.uA, async (tx) => { leaked = tx; });
    await expect(leaked!.$queryRaw`select 1`).rejects.toThrow();
  });
});

describe("authorization and audit", () => {
  beforeEach(() => reset());

  test("permission must be held over a scope that covers the centre", async () => {
    const can = (tok: string, perm: string, centre?: number) =>
      withScope(tok, async (tx) => (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission(${perm}, ${centre ?? null}::int) ok`)[0]!.ok);
    expect(await can(T.uA, "numbering.series.allocate", C.A)).toBe(true);
    expect(await can(T.uA, "numbering.series.allocate", C.B)).toBe(false);
    expect(await can(T.hoR1, "org.centre.view", C.A2)).toBe(true);
    expect(await can(T.hoR1, "org.centre.view", C.B)).toBe(false);
    expect(await can(T.hoR1, "numbering.series.allocate", C.A)).toBe(false); // in scope, but role lacks the permission
    expect(await can(T.hoAll, "rbac.role.manage")).toBe(true); // network-wide: ALL scope required
    expect(await can(T.hoR1, "rbac.role.manage")).toBe(false);
    expect(await can(T.uA, "no.such.permission", C.A)).toBe(false); // deny by default
  });

  test("T-RLS-018 denied action: no number consumed, one DENIED audit row, no OK row", async () => {
    await expect(allocateAt(T.uA, C.B)).rejects.toBeInstanceOf(Forbidden);
    expect(await seriesCurrent(C.B)).toBe(0);
    expect(await audits("numbering.allocate")).toEqual([{ outcome: "DENIED", target_centre_id: C.B }]);
  });

  test("T-AUD: change and audit commit together; a failure leaves neither", async () => {
    expect(await allocateAt(T.uA, C.A)).toBe(1n);
    await expect(scopedAction(T.uA, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId: C.A },
      async (tx) => { await allocate(tx, { centreId: C.A, docType: "FEEREC", period: PERIOD }); throw new Error("business failure"); }))
      .rejects.toThrow("business failure");
    expect(await seriesCurrent(C.A)).toBe(1);
    expect(await audits("numbering.allocate")).toEqual([{ outcome: "OK", target_centre_id: C.A }]);
  });

  test("T-AUD: audit log is append-only for the app and for the owner", async () => {
    await allocateAt(T.uA, C.A);
    await expect(withScope(T.uA, (tx) => tx.$executeRaw`update app.audit_log set action = 'x'`)).rejects.toThrow();
    await expect(withScope(T.uA, (tx) => tx.$queryRaw`select * from app.audit_log`)).rejects.toThrow();
    await asAdmin(async (db) => {
      await expect(db.query("update app.audit_log set action = 'x'")).rejects.toThrow(/append-only/);
      await expect(db.query("delete from app.audit_log")).rejects.toThrow(/append-only/);
      await expect(db.query("truncate app.audit_log")).rejects.toThrow(/append-only/);
    });
  });
});

describe.each(["GAPLESS", "UNIQUE"] as const)("numbering, NP-3 mode %s (T-NUM)", (mode) => {
  beforeEach(() => reset({ gapRule: mode }));
  const expectNumbers = (got: bigint[], n: number) => {
    const s = got.map(Number).sort((a, b) => a - b);
    expect(new Set(s).size).toBe(n);
    if (mode === "GAPLESS") expect(s).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  };

  test("T-NUM-001 100 concurrent allocations through the pooler", async () => {
    expectNumbers(await Promise.all(Array.from({ length: 100 }, () => allocateAt(T.uA, C.A))), 100);
  });

  test("T-NUM-002 rolled-back allocations release their numbers", async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) =>
      scopedAction(T.uA, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId: C.A }, async (tx) => {
        const n = await allocate(tx, { centreId: C.A, docType: "FEEREC", period: PERIOD });
        if (i % 3 === 0) throw new Error("business failure");
        return n;
      })));
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    expect(ok).toHaveLength(20);
    expectNumbers(ok, 20);
    expect(await seriesCurrent(C.A)).toBe(20);
  });

  test("T-NUM-006 series are independent per centre and document type", async () => {
    const [a, ai, b] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => allocateAt(T.uA, C.A))),
      Promise.all(Array.from({ length: 10 }, () => allocateAt(T.uA, C.A, "INV"))),
      Promise.all(Array.from({ length: 10 }, () => allocateAt(T.uB, C.B))),
    ]);
    for (const xs of [a, ai, b]) expectNumbers(xs, 10);
  });
});

describe("numbering pure functions", () => {
  test("T-NUM-007 FY boundary in Asia/Kolkata", () => {
    expect(financialYear(new Date("2027-03-31T18:29:59.999Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T18:30:00.000Z"))).toBe("2027-28");
  });
  test("T-NUM-009 format and length are NP-5 parameters; over-length is rejected", () => {
    const p = { centreCode: "KL2-25", docType: "FEEREC", period: "2026-27", number: 123 };
    expect(formatNumber(p)).toBe("KL2-25/FEEREC/2026-27/000123");
    expect(() => formatNumber({ ...p, maxLength: 16 })).toThrow(RangeError);
  });
});
