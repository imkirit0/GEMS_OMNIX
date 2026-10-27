// FX-BASE (audit 09), foundation subset. Synthetic data only, loaded with an admin connection.
import pg from "pg";

export const C = { A: 1, A2: 2, B: 3 } as const; // A in area A1 (R1), A2 in area A2 (R1), B in area B1 (R2)
export const T = {
  uA: "tok-uA", uB: "tok-uB", hoR1: "tok-hoR1", hoArea: "tok-hoArea", hoAll: "tok-hoAll",
  expired: "tok-expired", revoked: "tok-revoked", disabled: "tok-disabled",
} as const;
export const PERIOD = "2026-27";

export async function asAdmin<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}

export async function reset({ gapRule = "GAPLESS" }: { gapRule?: "GAPLESS" | "UNIQUE" } = {}): Promise<void> {
  await asAdmin(async (db) => {
    await db.query("set session_replication_role = replica"); // lets the admin clear the append-only audit table
    await db.query(`truncate app.audit_log, app.number_series, app.app_session, app.role_assignment, app.role_permission,
      app.role, app.permission, app.app_user, app.centre, app.area, app.region restart identity cascade`);
    await db.query("set session_replication_role = origin");
    await db.query(`insert into app.region (id, code, name) values (1, 'R1', 'Region 1'), (2, 'R2', 'Region 2')`);
    await db.query(`insert into app.area (id, region_id, name) values (1, 1, 'A1'), (2, 1, 'A2'), (3, 2, 'B1')`);
    await db.query(`insert into app.centre (id, code, name, area_id, status) values
      (1, 'KL2-25', 'Centre A', 1, 'ACTIVE'), (2, 'KL3-07', 'Centre A2', 2, 'ACTIVE'), (3, 'TN1-03', 'Centre B', 3, 'ACTIVE')`);
    await db.query(`insert into app.permission (key, description) values
      ('org.centre.view', 'View centre'), ('numbering.series.allocate', 'Allocate a document number'),
      ('rbac.role.manage', 'Manage roles')`);
    await db.query(`insert into app.role (id, key, name) values (1, 'centre_admin', 'Centre admin'),
      (2, 'ho_viewer', 'HO viewer'), (3, 'rbac_admin', 'RBAC admin')`);
    await db.query(`insert into app.role_permission values
      (1, 'org.centre.view'), (1, 'numbering.series.allocate'), (2, 'org.centre.view'), (3, 'rbac.role.manage')`);
    await db.query(`insert into app.app_user (id, login, display_name, status) values
      ('00000000-0000-0000-0000-00000000000a', 'uA', 'User A', 'ACTIVE'),
      ('00000000-0000-0000-0000-00000000000b', 'uB', 'User B', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000a1', 'hoR1', 'HO Region 1', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000a2', 'hoArea', 'HO Area A1', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000ff', 'hoAll', 'HO All', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000d0', 'disabled', 'Disabled user', 'DISABLED')`);
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, region_id, area_id, scope_centre_id) values
      ('00000000-0000-0000-0000-00000000000a', 1, 'CENTRE', null, null, 1),
      ('00000000-0000-0000-0000-00000000000b', 1, 'CENTRE', null, null, 3),
      ('00000000-0000-0000-0000-0000000000a1', 2, 'REGION', 1, null, null),
      ('00000000-0000-0000-0000-0000000000a2', 2, 'AREA', null, 1, null),
      ('00000000-0000-0000-0000-0000000000ff', 2, 'ALL', null, null, null),
      ('00000000-0000-0000-0000-0000000000ff', 3, 'ALL', null, null, null),
      ('00000000-0000-0000-0000-0000000000d0', 2, 'ALL', null, null, null)`);
    await db.query(`insert into app.app_session (token_hash, user_id, expires_at, revoked_at)
      select sha256(convert_to(t, 'UTF8')), u::uuid, now() + e::interval, r from (values
        ('tok-uA', '00000000-0000-0000-0000-00000000000a', '8 hours', null::timestamptz),
        ('tok-uB', '00000000-0000-0000-0000-00000000000b', '8 hours', null),
        ('tok-hoR1', '00000000-0000-0000-0000-0000000000a1', '8 hours', null),
        ('tok-hoArea', '00000000-0000-0000-0000-0000000000a2', '8 hours', null),
        ('tok-hoAll', '00000000-0000-0000-0000-0000000000ff', '8 hours', null),
        ('tok-expired', '00000000-0000-0000-0000-00000000000a', '-1 minute', null),
        ('tok-revoked', '00000000-0000-0000-0000-00000000000a', '8 hours', now()),
        ('tok-disabled', '00000000-0000-0000-0000-0000000000d0', '8 hours', null)) v(t, u, e, r)`);
    await db.query(`insert into app.number_series (centre_id, doc_type, period, gap_rule, current)
      select c, d, $1, $2::app."GapRule", 0 from unnest(array[1, 2, 3]) c, unnest(array['FEEREC', 'INV']) d`, [PERIOD, gapRule]);
  });
}

export const seriesCurrent = (centreId: number, docType = "FEEREC") =>
  asAdmin((db) => db.query(`select current::int as n from app.number_series where centre_id = $1 and doc_type = $2 and period = $3`,
    [centreId, docType, PERIOD]).then((r) => r.rows[0]?.n as number));

export const audits = (action: string) =>
  asAdmin((db) => db.query(`select outcome, target_centre_id from app.audit_log where action = $1 order by id`, [action])
    .then((r) => r.rows as { outcome: string; target_centre_id: number | null }[]));
