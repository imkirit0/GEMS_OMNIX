// FX-BASE (audit 09), foundation subset. Synthetic data only, loaded with an admin connection.
import pg from "pg";

export const C = { A: 1, A2: 2, B: 3 } as const; // A in area A1 (R1), A2 in area A2 (R1), B in area B1 (R2)
export const T = {
  uA: "tok-uA", uB: "tok-uB", hoR1: "tok-hoR1", hoArea: "tok-hoArea", hoAll: "tok-hoAll",
  expired: "tok-expired", revoked: "tok-revoked", disabled: "tok-disabled",
} as const;
export const PERIOD = "2026-27";

// Ticket-engine fixture users (design item 20). Existing users and assignments above are unchanged.
// Each has a session with token tok-tk<Name>, e.g. TK.raiser -> "tok-tkRaiser".
export const TK = {
  raiser: "00000000-0000-0000-0000-0000000000c1", // tk_raiser at centre A
  l1: "00000000-0000-0000-0000-0000000000c2", // tk_level1 at A: level-1 approver by role
  l2: "00000000-0000-0000-0000-0000000000c3", // tk_level2 at A: level-2 approver (named user in type fixtures)
  both: "00000000-0000-0000-0000-0000000000c4", // tk_level1 and tk_level2 at A (DD-14)
  fwd: "00000000-0000-0000-0000-0000000000c5", // tk_approver at A: forward and reassign target
  reviewer: "00000000-0000-0000-0000-0000000000c6", // tk_reviewer at A: a level role without ticket.approve
  admin: "00000000-0000-0000-0000-0000000000c7", // tk_type_admin (ticket.type.manage, rbac.view) at ALL
  viewer: "00000000-0000-0000-0000-0000000000c8", // tk_member at A (no permissions; a user needs a role to sign in): named viewer of a type
  b: "00000000-0000-0000-0000-0000000000c9", // tk_level1 at centre B: approver out of scope
} as const;
export const TK_ROLE = { raiser: 10, level1: 11, level2: 12, approver: 13, reviewer: 14, typeAdmin: 15, member: 16 } as const;
export const tkToken = (name: keyof typeof TK) => `tok-tk${name[0]!.toUpperCase()}${name.slice(1)}`;

// Person-core fixture users (design item 5), all role 17 student_admin. Tokens tok-stuA, tok-stuB, tok-stuR, tok-stuH.
export const ST = {
  sa: "00000000-0000-0000-0000-0000000000e1", // centre A
  sb: "00000000-0000-0000-0000-0000000000e2", // centre B (region 2): out of scope for both moves
  sr: "00000000-0000-0000-0000-0000000000e3", // REGION 1 (A and A2): the regional case
  sh: "00000000-0000-0000-0000-0000000000e4", // ALL: the HO move case (hoAll's roles are asserted in audit.test.ts)
} as const;
export const ST_TOKEN = { sa: "tok-stuA", sb: "tok-stuB", sr: "tok-stuR", sh: "tok-stuH" } as const;
export const ST_ROLE = 17;

// Catalogue-skeleton fixture user: role 18 catalogue_admin (catalogue.manage) at ALL. Token tok-catA.
export const CA = { ca: "00000000-0000-0000-0000-0000000000f1" } as const;

// Enquiry fixture users (enquiry design C11): roles 22 enquiry_worker (view, manage), 23 enquiry_viewer (view),
// 24 enquiry_setup (setup, sensitive). Not 19-21: tests add their own roles from 19 (learner-details).
export const EQ_ROLE = { worker: 22, viewer: 23, setup: 24 } as const;
export const EQ = {
  wa: "00000000-0000-0000-0000-0000000000b1", // 22 and 17 (student_admin) at A: may enrol
  wb: "00000000-0000-0000-0000-0000000000b2", // 22 at B
  va: "00000000-0000-0000-0000-0000000000b3", // 23 at A: view only
  ma: "00000000-0000-0000-0000-0000000000b4", // 22 at A only: manage without student.admit
  setup: "00000000-0000-0000-0000-0000000000b5", // 24 at ALL
} as const;
export const EQ_TOKEN = { wa: "tok-eqA", wb: "tok-eqB", va: "tok-eqView", ma: "tok-eqNoAdmit", setup: "tok-eqSetup" } as const;
/** The 0018 seeds, re-inserted after the truncate so ids are the migration's (paths 1-14, types 1-7, statuses 1-6). */
const ENQ_SEED = `
insert into app.enquiry_path (code, name) values ('SOCIAL_MEDIA', 'Social Media'), ('WALK_IN', 'Walk In'),
  ('DIRECT_CALL', 'Direct Call'), ('MESSAGE', 'Message'), ('TELE_CALLING', 'Tele Calling'), ('ALUMNI', 'Alumnus/Alumna'),
  ('FRIENDS', 'Friends'), ('GTEC_STUDENT', 'G-TEC Student''s'), ('NOTICE_BOARD', 'Notice Boards/Hoardings'),
  ('TV_AD', 'TV Advertisements'), ('NEWSPAPER_AD', 'Newspaper Advertisements'), ('MAIL', 'Mail'), ('STAFF', 'Staff'),
  ('OTHER_REF', 'Other Ref');
insert into app.enquiry_type (code, name) values ('WALK_IN', 'Walk In'), ('ONLINE', 'Online'), ('WEBSITE', 'Website'),
  ('TELECALLER', 'TeleCaller'), ('PHONE', 'Phone Enquiry'), ('OTHER_REF', 'Other Ref'), ('DIRECT_CALL', 'Direct Call');
insert into app.enquiry_status (code, name, kind, colour, sort_order) values
  ('NEW', 'New', 'OPEN', '#1e88e5', 10), ('CONTACTED', 'Contacted', 'OPEN', '#43a047', 20),
  ('AFFORDABILITY', 'Affordability', 'OPEN', '#fb8c00', 30), ('ENROLLED', 'Enrolled', 'ENROLLED', '#2e7d32', 900),
  ('LOST', 'Lost', 'LOST', '#757575', 950), ('JUNK', 'Junk', 'JUNK', '#b71c1c', 990);`;

export async function asAdmin<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}

export async function reset({ gapRule = "GAPLESS" }: { gapRule?: "GAPLESS" | "UNIQUE" } = {}): Promise<void> {
  await asAdmin(async (db) => {
    await db.query("set session_replication_role = replica"); // lets the admin clear the append-only audit table
    await db.query(`truncate app.audit_log, app.number_series, app.app_session, app.role_assignment, app.role_permission,
      app.role, app.permission, app.app_user, app.centre, app.area, app.region,
      app.ticket_document, app.ticket_upload, app.ticket_event, app.ticket_level, app.ticket, app.global_number_series,
      app.enquiry_followup, app.enquiry, app.enquiry_status, app.enquiry_type, app.enquiry_path,
      app.registration, app.admission, app.person_detail, app.person,
      app.ticket_type_viewer, app.ticket_type_level, app.ticket_type, app.ticket_category, app.rate_hit,
      app.course, app.course_category, app.course_division, app.centre_class, app.academic_year restart identity cascade`);
    if ((await db.query(`select to_regclass('app.test_ticket_counter') t`)).rows[0].t) await db.query(`truncate app.test_ticket_counter`);
    await db.query("set session_replication_role = origin");
    await db.query(`insert into app.region (id, code, name) values (1, 'R1', 'Region 1'), (2, 'R2', 'Region 2')`);
    await db.query(`insert into app.area (id, region_id, name) values (1, 1, 'A1'), (2, 1, 'A2'), (3, 2, 'B1')`);
    await db.query(`insert into app.centre (id, code, name, area_id, status) values
      (1, 'KL2-25', 'Centre A', 1, 'ACTIVE'), (2, 'KL3-07', 'Centre A2', 2, 'ACTIVE'), (3, 'TN1-03', 'Centre B', 3, 'ACTIVE')`);
    await db.query(`insert into app.permission (key, description, sensitive) values
      ('org.centre.view', 'View centre', false), ('numbering.series.allocate', 'Allocate a document number', false),
      ('rbac.view', 'View users and roles', false), ('rbac.user.manage', 'Manage users', true), ('rbac.role.manage', 'Manage roles', true),
      ('ticket.raise', 'Raise tickets', false), ('ticket.view', 'View tickets', false), ('ticket.approve', 'Act on tickets', false),
      ('ticket.document.view', 'Download ticket documents', false), ('ticket.type.manage', 'Set up ticket types', true),
      ('student.view', 'View learners admitted at a centre in your scope', false), ('student.admit', 'Admit learners at a centre', false),
      ('catalogue.manage', 'Maintain the catalogue: courses, masters, academic years', true),
      ('enquiry.view', 'View enquiries of a centre', false), ('enquiry.manage', 'Record and work enquiries of a centre', false),
      ('enquiry.setup', 'Maintain enquiry paths, types and statuses', true)`);
    await db.query(`insert into app.role (id, key, name) values (1, 'centre_admin', 'Centre admin'),
      (2, 'ho_viewer', 'HO viewer'), (3, 'rbac_admin', 'RBAC admin'),
      (10, 'tk_raiser', 'Ticket raiser'), (11, 'tk_level1', 'Ticket level 1'), (12, 'tk_level2', 'Ticket level 2'),
      (13, 'tk_approver', 'Ticket approver'), (14, 'tk_reviewer', 'Ticket reviewer'), (15, 'tk_type_admin', 'Ticket type admin'),
      (16, 'tk_member', 'Centre member (no permissions)'), (17, 'student_admin', 'Student admin'), (18, 'catalogue_admin', 'Catalogue admin'),
      (22, 'enquiry_worker', 'Enquiry worker'), (23, 'enquiry_viewer', 'Enquiry viewer'), (24, 'enquiry_setup', 'Enquiry setup')`);
    await db.query(`insert into app.role_permission values
      (1, 'org.centre.view'), (1, 'numbering.series.allocate'), (2, 'org.centre.view'),
      (3, 'rbac.view'), (3, 'rbac.user.manage'), (3, 'rbac.role.manage'),
      (10, 'ticket.raise'), (10, 'ticket.view'), (10, 'ticket.document.view'),
      (11, 'ticket.approve'), (11, 'ticket.view'), (11, 'ticket.document.view'),
      (12, 'ticket.approve'), (12, 'ticket.view'), (12, 'ticket.document.view'),
      (13, 'ticket.approve'), (13, 'ticket.view'), (14, 'ticket.view'),
      (15, 'ticket.type.manage'), (15, 'rbac.view'), (17, 'student.view'), (17, 'student.admit'), (18, 'catalogue.manage'),
      (22, 'enquiry.view'), (22, 'enquiry.manage'), (23, 'enquiry.view'), (24, 'enquiry.setup')`);
    await db.query(`insert into app.app_user (id, login, display_name, status) values
      ('00000000-0000-0000-0000-00000000000a', 'ua', 'User A', 'ACTIVE'),
      ('00000000-0000-0000-0000-00000000000b', 'ub', 'User B', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000a1', 'hor1', 'HO Region 1', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000a2', 'hoarea', 'HO Area A1', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000ff', 'hoall', 'HO All', 'ACTIVE'),
      ('00000000-0000-0000-0000-0000000000d0', 'disabled', 'Disabled user', 'DISABLED'),
      ${Object.entries(TK).map(([k, id]) => `('${id}', '${k.toLowerCase()}', 'Ticket ${k}', 'ACTIVE')`).join(", ")},
      ${Object.entries(ST).map(([k, id]) => `('${id}', '${k}', 'Student admin ${k}', 'ACTIVE')`).join(", ")},
      ('${CA.ca}', 'ca', 'Catalogue admin', 'ACTIVE'),
      ${Object.entries(EQ).map(([k, id]) => `('${id}', 'eq${k}', 'Enquiry ${k}', 'ACTIVE')`).join(", ")}`);
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, region_id, area_id, scope_centre_id) values
      ('00000000-0000-0000-0000-00000000000a', 1, 'CENTRE', null, null, 1),
      ('00000000-0000-0000-0000-00000000000b', 1, 'CENTRE', null, null, 3),
      ('00000000-0000-0000-0000-0000000000a1', 2, 'REGION', 1, null, null),
      ('00000000-0000-0000-0000-0000000000a2', 2, 'AREA', null, 1, null),
      ('00000000-0000-0000-0000-0000000000ff', 2, 'ALL', null, null, null),
      ('00000000-0000-0000-0000-0000000000ff', 3, 'ALL', null, null, null),
      ('00000000-0000-0000-0000-0000000000d0', 2, 'ALL', null, null, null),
      ('${TK.raiser}', 10, 'CENTRE', null, null, 1), ('${TK.l1}', 11, 'CENTRE', null, null, 1),
      ('${TK.l2}', 12, 'CENTRE', null, null, 1), ('${TK.both}', 11, 'CENTRE', null, null, 1),
      ('${TK.both}', 12, 'CENTRE', null, null, 1), ('${TK.fwd}', 13, 'CENTRE', null, null, 1),
      ('${TK.reviewer}', 14, 'CENTRE', null, null, 1), ('${TK.admin}', 15, 'ALL', null, null, null),
      ('${TK.viewer}', 16, 'CENTRE', null, null, 1), ('${TK.b}', 11, 'CENTRE', null, null, 3),
      ('${ST.sa}', 17, 'CENTRE', null, null, 1), ('${ST.sb}', 17, 'CENTRE', null, null, 3),
      ('${ST.sr}', 17, 'REGION', 1, null, null), ('${ST.sh}', 17, 'ALL', null, null, null),
      ('${CA.ca}', 18, 'ALL', null, null, null),
      ('${EQ.wa}', 22, 'CENTRE', null, null, 1), ('${EQ.wa}', 17, 'CENTRE', null, null, 1), ('${EQ.wb}', 22, 'CENTRE', null, null, 3),
      ('${EQ.va}', 23, 'CENTRE', null, null, 1), ('${EQ.ma}', 22, 'CENTRE', null, null, 1), ('${EQ.setup}', 24, 'ALL', null, null, null)`);
    await db.query(`insert into app.app_session (token_hash, user_id, expires_at, revoked_at)
      select sha256(convert_to(t, 'UTF8')), u::uuid, now() + e::interval, r from (values
        ('tok-uA', '00000000-0000-0000-0000-00000000000a', '8 hours', null::timestamptz),
        ('tok-uB', '00000000-0000-0000-0000-00000000000b', '8 hours', null),
        ('tok-hoR1', '00000000-0000-0000-0000-0000000000a1', '8 hours', null),
        ('tok-hoArea', '00000000-0000-0000-0000-0000000000a2', '8 hours', null),
        ('tok-hoAll', '00000000-0000-0000-0000-0000000000ff', '8 hours', null),
        ('tok-expired', '00000000-0000-0000-0000-00000000000a', '-1 minute', null),
        ('tok-revoked', '00000000-0000-0000-0000-00000000000a', '8 hours', now()),
        ('tok-disabled', '00000000-0000-0000-0000-0000000000d0', '8 hours', null),
        ${Object.entries(TK).map(([k, id]) => `('tok-tk${k[0]!.toUpperCase()}${k.slice(1)}', '${id}', '8 hours', null)`).join(", ")},
        ${Object.entries(ST).map(([k, id]) => `('${ST_TOKEN[k as keyof typeof ST]}', '${id}', '8 hours', null)`).join(", ")},
        ('tok-catA', '${CA.ca}', '8 hours', null),
        ${Object.entries(EQ).map(([k, id]) => `('${EQ_TOKEN[k as keyof typeof EQ]}', '${id}', '8 hours', null)`).join(", ")}) v(t, u, e, r)`);
    // explicit ids above do not advance the identity sequences; later inserts must not collide with them
    for (const t of ["region", "area", "centre", "role"]) await db.query(`select setval('app.${t}_id_seq', (select max(id) from app.${t}))`);
    await db.query(`insert into app.number_series (centre_id, doc_type, period, gap_rule, current)
      select c, d, $1, $2::app."GapRule", 0 from unnest(array[1, 2, 3]) c, unnest(array['FEEREC', 'INV']) d`, [PERIOD, gapRule]);
    // as the cutover script would seed them (NP-8): legacy current values (R-029)
    await db.query(`insert into app.global_number_series (series, period, current) values
      ('REGISTER', 'ALL', 2064112), ('ADMISSION', '2026-27', 43887)`);
    // catalogue skeleton: one category, division and class; the P8 courses; academic years 2024-25 to 2028-29, all open
    await db.query(`insert into app.course_category (code, name) values ('GEN', 'General')`);
    await db.query(`insert into app.course_division (code, name) values ('GEN', 'General')`);
    await db.query(`insert into app.centre_class (code, name) values ('METRO', 'Metro')`);
    await db.query(`insert into app.course (code, name, category_id, division_id) values ('DCA', 'Diploma in Computer Applications', 1, 1),
      ('TALLY', 'Tally', 1, 1), ('PYTHON', 'Python', 1, 1), ('DTP', 'Desktop Publishing', 1, 1), ('CCNA', 'CCNA', 1, 1)`);
    await db.query(`insert into app.academic_year (code, starts_on, ends_on)
      select y || '-' || lpad(((y + 1) % 100)::text, 2, '0'), make_date(y, 6, 1), make_date(y + 1, 5, 31) from generate_series(2024, 2028) y`);
    await db.query(ENQ_SEED);
  });
}

export const seriesCurrent = (centreId: number, docType = "FEEREC") =>
  asAdmin((db) => db.query(`select current::int as n from app.number_series where centre_id = $1 and doc_type = $2 and period = $3`,
    [centreId, docType, PERIOD]).then((r) => r.rows[0]?.n as number));

// Whole audit rows, for assertions on detail, before/after and target columns.
export const rows = (action: string) =>
  asAdmin((db) => db.query(`select * from app.audit_log where action = $1 order by id`, [action]).then((r) => r.rows));

export const setStepUp = (token: string, ageSeconds: number) => asAdmin((db) => db.query(
  `update app.app_session set step_up_at = now() - make_interval(secs => $2) where token_hash = sha256(convert_to($1, 'UTF8'))`, [token, ageSeconds]));

export const newSession = (userId: string, token: string) => asAdmin((db) => db.query(
  `insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values (sha256(convert_to($1, 'UTF8')), $2, now() + interval '1 hour', now())`, [token, userId]));

export const audits = (action: string) =>
  asAdmin((db) => db.query(`select outcome, target_centre_id from app.audit_log where action = $1 order by id`, [action])
    .then((r) => r.rows as { outcome: string; target_centre_id: number | null }[]));
