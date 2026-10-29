// Course batches and time slots: T-CB-001…003 (audit 09; docs/designs/course-batches/course-batches.md). The page 404s
// are real-server smoke checks (scripts/smoke-security.mjs).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as saveRoute } from "../app/batches/save/route";
import { POST as placeRoute } from "../app/batches/place/save/route";
import { Forbidden } from "../src/server/action";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import * as bt from "../src/server/batches";
import { admit, type AdmitInput } from "../src/server/people";
import { asAdmin, C, reset, rows, ST_TOKEN, T } from "./fixtures";

const T_UA = "00000000-0000-0000-0000-00000000000a"; // the user behind T.uA

const A = "tok-bmA", R1 = "tok-bmR1", VIEW = ST_TOKEN.sa, ADMIT = ST_TOKEN.sa;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string }; } finally { await db.query("rollback"); }
});
const audit = async (action: string) => (await rows(action)).filter((r) => r.outcome === "OK");
const B1 = { centreId: C.A, code: "morning", name: " Morning ", startsAt: "09:00", endsAt: "10:30", capacity: 2 };

let app: pg.Client; // gems_app with a session, as withScope connects
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q, p); } finally { await app.query("rollback"); }
};
const asErr = (tok: string, q: string, p: unknown[] = []) => as(tok, q, p).then(() => null, (e: { code: string; constraint?: string }) => ({ code: e.code, constraint: e.constraint }));
let n = 0;
/** A learner admitted at centre A (or another), with one ACTIVE registration; returns its id and register number. */
const learner = async (centreId: number = C.A, tok: string = ADMIT) => {
  const input: AdmitInput = { person: { givenName: `Batch${++n}`, mobile: `94000${String(n).padStart(5, "0")}` }, centreId,
    academicYear: "2026-27", admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }] };
  const r = (await admit(tok, input)).registrations[0]!;
  return { id: r.id, registerNo: r.registerNo };
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(() => reset());

describe("T-CB course batches", () => {
  test("T-CB-001 batches: fields, messages in order, checks, audit, who may", async () => {
    expect(await bt.createBatch(A, B1)).toEqual({ id: 1 });
    expect((await audit("batch.create"))[0]).toMatchObject({ target_type: "batch", target_id: "1", target_centre_id: C.A,
      after: { code: "MORNING", name: "Morning", startsAt: "09:00", endsAt: "10:30", capacity: 2, active: true } });
    expect(await bt.listBatches(VIEW, C.A)).toEqual([{ id: 1, code: "MORNING", name: "Morning", startsAt: "09:00", endsAt: "10:30",
      capacity: 2, active: true, placed: 0 }]);

    const bad: [Partial<bt.BatchInput>, string][] = [
      [{ centreId: 0, code: "" }, "centreId: unknown"], [{ code: "", name: "" }, "code: required"],
      [{ name: " ", startsAt: "x" }, "name: 1-100 characters"], [{ name: "x".repeat(101) }, "name: 1-100 characters"],
      [{ startsAt: "24:00", endsAt: "x" }, "startsAt: HH:MM"], [{ endsAt: "9:00" }, "endsAt: HH:MM"],
      [{ startsAt: "10:00", endsAt: "10:00", capacity: 0 }, "endsAt: after startsAt"], [{ capacity: 0 }, "capacity: 1-500"],
      [{ capacity: 501 }, "capacity: 1-500"], [{ capacity: 1.5 }, "capacity: 1-500"],
    ];
    for (const [o, m] of bad) expect(await msg(bt.createBatch(A, { ...B1, code: "B2", ...o })), JSON.stringify(o)).toBe(m);
    expect(await thrown(bt.createBatch(A, { ...B1, code: "Morning" }))).toMatchObject({ key: "batch.duplicate" });
    expect(await sqlErr(`insert into app.batch (centre_id, code, name, starts_at, ends_at, capacity) values (3, 'MORNING', 'x', '09:00', '10:00', 5)`)).toBeNull();

    // update: merged time order, below placed, nothing to change, other centre's id
    const [l1, l2] = [await learner(), await learner()];
    await bt.placeLearners(A, C.A, 1, [l1.id, l2.id]);
    expect(await msg(bt.updateBatch(A, C.A, 1, { capacity: 1 }))).toBe("capacity: below the learners placed");
    expect(await msg(bt.updateBatch(A, C.A, 1, { endsAt: "08:00" }))).toBe("endsAt: after startsAt");
    expect(await msg(bt.updateBatch(A, C.A, 1, { name: " Morning ", startsAt: "09:00" }))).toBe("nothing to change");
    expect(await msg(bt.updateBatch(A, C.A, 1, {}))).toBe("nothing to change");
    await bt.updateBatch(A, C.A, 1, { name: "Early", capacity: 3, endsAt: "11:00" });
    expect((await audit("batch.update"))[0]).toMatchObject({ target_id: "1", before: { name: "Morning", capacity: 2, endsAt: "10:30" },
      after: { name: "Early", capacity: 3, endsAt: "11:00" } });
    expect(await thrown(bt.updateBatch(A, C.A, 999, { name: "x" }))).toMatchObject({ reason: "notfound" });
    // (de)activate with a reason
    expect(await msg(bt.setBatchActive(A, C.A, 1, false, " "))).toBe("reason: required");
    await bt.setBatchActive(A, C.A, 1, false, "term ended");
    expect((await audit("batch.deactivate"))[0]).toMatchObject({ reason: "term ended", before: { active: true }, after: { active: false } });
    expect(await msg(bt.setBatchActive(A, C.A, 1, false, "again"))).toBe("already inactive");
    await bt.setBatchActive(A, C.A, 1, true, "back");
    expect((await audit("batch.activate"))[0]).toMatchObject({ reason: "back", before: { active: false }, after: { active: true } });
    expect(await msg(bt.setBatchActive(A, C.A, 1, true, "again"))).toBe("already active");

    // who may: bmA only at A; bmR1 in region 1; viewers read only; others nothing
    expect(await thrown(bt.createBatch(A, { ...B1, centreId: C.B }))).toBeInstanceOf(Forbidden);
    expect(await thrown(bt.listBatches(A, C.B))).toBeInstanceOf(Forbidden);
    expect(await bt.createBatch(R1, { ...B1, centreId: C.A2 })).toEqual({ id: expect.any(Number) });
    expect(await thrown(bt.createBatch(VIEW, { ...B1, code: "X" }))).toBeInstanceOf(Forbidden);
    expect(await thrown(bt.listBatches(T.uA, C.A))).toBeInstanceOf(Forbidden);
    expect((await bt.batchCentres(VIEW)).map((c) => [c.code, c.canManage])).toEqual([["KL2-25", false]]);
    expect((await bt.batchCentres(R1)).map((c) => [c.code, c.canManage])).toEqual([["KL2-25", true], ["KL3-07", true]]);
    expect(await bt.batchCentres(T.uA)).toEqual([]);
    // placing implies reading: batch.manage alone is refused, audited as DENIED naming student.view (C3, R7)
    await sql(`insert into app.role (id, key, name) values (27, 'batch_only', 'Batch only')`);
    await sql(`insert into app.role_permission values (27, 'batch.manage')`);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 27, 'CENTRE', 1)`, [T_UA]);
    expect(await thrown(bt.createBatch(T.uA, { ...B1, code: "X" }))).toBeInstanceOf(Forbidden);
    expect((await rows("batch.create")).filter((r) => r.outcome === "DENIED").at(-1)).toMatchObject({ detail: { permission: "student.view" } });
    // an inactive centre takes no batch writes (DD-5)
    await sql(`update app.centre set status = 'INACTIVE' where id = $1`, [C.A2]);
    expect(await msg(bt.createBatch(R1, { ...B1, centreId: C.A2, code: "LATE" }))).toBe("centreId: centre is not active");

    // the database: RLS, grants, named checks
    expect((await as(T.uA, `select count(*)::int n from app.batch`)).rows).toEqual([{ n: 0 }]);
    expect(await asErr(VIEW, `insert into app.batch (centre_id, code, name, starts_at, ends_at, capacity) values (1, 'X', 'x', '09:00', '10:00', 5)`))
      .toMatchObject({ code: "42501" });
    expect((await as(VIEW, `update app.batch set name = 'x'`)).rowCount).toBe(0);
    expect(await asErr(A, `update app.batch set code = 'X' where id = 1`)).toMatchObject({ code: "42501" });
    expect(await asErr(A, `delete from app.batch where id = 1`)).toMatchObject({ code: "42501" });
    const cols = "centre_id, code, name, starts_at, ends_at, capacity";
    for (const [v, c] of [[`1, 'x', 'x', '09:00', '10:00', 5`, "batch_code_check"], [`1, 'X', ' x', '09:00', '10:00', 5`, "batch_name_check"],
      [`1, 'X', '${"x".repeat(101)}', '09:00', '10:00', 5`, "batch_name_check"], [`1, 'X', 'x', '10:00', '10:00', 5`, "batch_time_check"],
      [`1, 'X', 'x', '09:00:30', '10:00', 5`, "batch_time_check"], [`1, 'X', 'x', '09:00', '10:00', 0`, "batch_capacity_check"],
      [`1, 'X', 'x', '09:00', '10:00', 501`, "batch_capacity_check"]] as const) {
      expect(await sqlErr(`insert into app.batch (${cols}) values (${v})`), c).toMatchObject({ code: "23514", constraint: c });
    }
    const sec = await sql(`select c.relrowsecurity rls, c.relforcerowsecurity force, array(select case polcmd when 'r' then 'SELECT'
      when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end from pg_policy where polrelid = c.oid order by 1) cmds
      from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'app' where c.relname = 'batch'`);
    expect(sec).toEqual([{ rls: true, force: true, cmds: ["DELETE", "INSERT", "SELECT", "UPDATE"] }]);
  });

  test("T-CB-002 placing learners: rules, audit, and the database guard for every writer", async () => {
    await bt.createBatch(A, B1); // 1: capacity 2
    await bt.createBatch(A, { ...B1, code: "EVENING", name: "Evening", startsAt: "17:00", endsAt: "18:00", capacity: 5 }); // 2
    const [l1, l2, l3] = [await learner(), await learner(), await learner()];
    expect(await bt.placeLearners(A, C.A, 1, [l1.id, l2.id])).toEqual({ changed: 2 });
    expect((await audit("batch.place"))[0]).toMatchObject({ target_type: "batch", target_id: "1",
      before: { [l1.registerNo]: null, [l2.registerNo]: null }, after: { batch: "MORNING", registerNos: [l1.registerNo, l2.registerNo].sort() } });
    expect(await msg(bt.placeLearners(A, C.A, 1, [l3.id]))).toBe("batchId: full");
    expect(await msg(bt.placeLearners(A, C.A, 1, [l1.id]))).toBe("nothing to change");
    // several rows in one statement past capacity: refused whole (R10)
    await bt.placeLearners(A, C.A, 2, [l1.id, l2.id, l3.id]);
    expect(await msg(bt.placeLearners(A, C.A, 1, [l1.id, l2.id, l3.id]))).toBe("batchId: full");
    expect(await sql(`select count(*)::int n from app.registration where batch_id = 1`)).toEqual([{ n: 0 }]);
    // move, then remove (also out of an inactive batch)
    await bt.setBatchActive(A, C.A, 2, false, "closing");
    expect(await msg(bt.placeLearners(A, C.A, 2, [l1.id]))).toBe("batchId: inactive or unknown");
    expect(await bt.placeLearners(A, C.A, 1, [l1.id])).toEqual({ changed: 1 });
    expect(await bt.placeLearners(A, C.A, null, [l1.id, l2.id, l3.id])).toEqual({ changed: 3 });
    expect((await audit("batch.place")).at(-1)).toMatchObject({ target_type: "centre", target_id: String(C.A),
      before: { [l1.registerNo]: "MORNING", [l2.registerNo]: "EVENING" }, after: { batch: null } });
    expect(await msg(bt.placeLearners(A, C.A, null, [l1.id]))).toBe("nothing to change");
    // refusals: another centre's batch or learner, non-ACTIVE, malformed ids
    const lb = await learner(C.B, ST_TOKEN.sb);
    await sql(`insert into app.batch (centre_id, code, name, starts_at, ends_at, capacity) values (3, 'B', 'B', '09:00', '10:00', 5)`); // 3
    expect(await msg(bt.placeLearners(A, C.A, 3, [l1.id]))).toBe("batchId: inactive or unknown");
    expect(await msg(bt.placeLearners(A, C.A, 1, [lb.id]))).toBe("registrationIds: not active here");
    await sql(`update app.registration set status = 'DROP' where id = $1`, [l3.id]);
    expect(await msg(bt.placeLearners(A, C.A, 1, [l3.id]))).toBe("registrationIds: not active here");
    for (const ids of [[], [l1.id, l1.id], ["x"], Array.from({ length: 201 }, () => l1.id)]) {
      expect(await msg(bt.placeLearners(A, C.A, 1, ids))).toBe("registrationIds: 1-200 distinct ids");
    }
    expect(await thrown(bt.placeLearners(VIEW, C.A, 1, [l1.id]))).toBeInstanceOf(Forbidden);
    // reads: the course picker and the list, ACTIVE rows only, filter by batch
    await bt.placeLearners(A, C.A, 1, [l1.id]);
    expect(await bt.placementCourses(VIEW, C.A)).toEqual([{ code: "DCA", name: "Diploma in Computer Applications" }]);
    const list = await bt.listPlacements(VIEW, C.A, "DCA");
    expect(list.truncated).toBe(false);
    expect(list.rows.map((r) => [r.registerNo, r.batchCode])).toEqual([[l1.registerNo, "MORNING"], [l2.registerNo, null]].sort());
    expect((await bt.listPlacements(VIEW, C.A, "DCA", 1)).rows.map((r) => r.registerNo)).toEqual([l1.registerNo]);
    expect((await bt.listPlacements(VIEW, C.A, "NOPE")).rows).toEqual([]);
    expect(await thrown(bt.listPlacements(T.uA, C.A, "DCA"))).toBeInstanceOf(Forbidden);

    // the database guard, by SQL as the app role
    const upd = (tok: string, b: number | null, id: string) => asErr(tok, `update app.registration set batch_id = $1 where id = $2`, [b, id]);
    expect(await upd(VIEW, 1, l2.id)).toMatchObject({ code: "42501" }); // student.view alone
    expect(await asErr(A, `update app.registration set course_code = 'TALLY' where id = $1`, [l2.id])).toMatchObject({ code: "42501" }); // column grant
    expect(await upd(A, 2, l2.id)).toMatchObject({ code: "23514", constraint: "batch_active_guard" });
    expect(await upd(A, 3, l2.id)).toMatchObject({ code: "23514", constraint: "batch_active_guard" }); // B's batch: hidden, fails closed
    expect(await sqlErr(`update app.registration set batch_id = 3 where id = $1`, [l2.id])).toMatchObject({ code: "23503" }); // the composite key
    expect(await upd(A, 1, l3.id)).toMatchObject({ code: "23514", constraint: "batch_registration_guard" });
    await bt.updateBatch(A, C.A, 1, { capacity: 1 });
    expect(await upd(A, 1, l2.id)).toMatchObject({ code: "23514", constraint: "batch_capacity_guard" });
    // an admitting insert cannot carry a batch
    expect(await asErr(ADMIT, `insert into app.registration (id, admission_id, centre_id, course_code, register_no, join_date, batch_id)
      select gen_random_uuid(), admission_id, centre_id, 'TALLY', 'X-1', '2026-11-01', 1 from app.registration where id = $1`, [l1.id]))
      .toMatchObject({ code: "42501" });
    // the owner too: a status back to ACTIVE over capacity, a placement into an inactive batch
    expect(await sqlErr(`update app.registration set batch_id = 1 where id = $1`, [l3.id])).toMatchObject({ constraint: "batch_registration_guard" });
    await sql(`update app.registration set status = 'DROP' where id = $1`, [l1.id]);
    await sql(`update app.registration set batch_id = 1 where id = $1`, [l2.id]); // l1 no longer counts
    expect(await sqlErr(`update app.registration set status = 'ACTIVE' where id = $1`, [l1.id])).toMatchObject({ code: "23514", constraint: "batch_capacity_guard" });
    expect(await sqlErr(`update app.registration set batch_id = 2 where id = $1`, [l2.id])).toMatchObject({ constraint: "batch_active_guard" });

    // two concurrent sessions cannot overfill (R9): A holds the batch lock; B waits, then counts A's committed row
    await sql(`update app.registration set batch_id = null where id = $1`, [l2.id]);
    const l4 = await learner();
    const other = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await other.connect();
    try {
      for (const c of [app, other]) { await c.query("begin"); await c.query("select set_config('app.session_id', $1, true)", [A]); }
      await app.query(`update app.registration set batch_id = 1 where id = $1`, [l2.id]);
      const pid = (await other.query("select pg_backend_pid() p")).rows[0].p;
      let done = false;
      const second = other.query(`update app.registration set batch_id = 1 where id = $1`, [l4.id])
        .then(() => null, (e: { constraint?: string }) => e.constraint).finally(() => { done = true; });
      // B must be waiting on the batch lock before A commits; without the lock it finishes first, unrefused
      const waiting = () => sql(`select wait_event_type = 'Lock' w from pg_stat_activity where pid = $1`, [pid]).then((r) => r[0]?.w === true);
      for (let i = 0; i < 100 && !done && !(await waiting()); i++) await new Promise((r) => setTimeout(r, 20));
      expect(done, "B was not blocked by A's batch lock").toBe(false);
      await app.query("commit");
      expect(await second).toBe("batch_capacity_guard");
    } finally { await other.query("rollback").catch(() => null); await other.end(); }
    expect(await sql(`select count(*)::int n from app.registration where batch_id = 1 and status = 'ACTIVE'`)).toEqual([{ n: 1 }]);

    // a writer who sees two centres (bmR1: region 1) cannot cross them: the app names the learner, not the batch
    const la2 = await learner(C.A2, ST_TOKEN.sr);
    await bt.updateBatch(A, C.A, 1, { capacity: 5 });
    expect(await msg(bt.placeLearners(R1, C.A, 1, [la2.id]))).toBe("registrationIds: not active here");
    // a registration that left ACTIVE cannot be moved, not even out of its batch
    await sql(`update app.registration set status = 'DROP' where id = $1`, [l2.id]);
    expect(await msg(bt.placeLearners(A, C.A, null, [l2.id]))).toBe("registrationIds: not active here");
  });

  test("T-CB-003 routes: batches and placement; origin, field details, unknown op, repeated ids", async () => {
    const ORIGIN = "https://gems.test";
    const post = (path: string, body: URLSearchParams, origin = ORIGIN, tok = A) => new Request(`${ORIGIN}${path}`, {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${tok}`, origin } });
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const save = (b: Record<string, string>, origin?: string) => saveRoute(post("/batches/save", new URLSearchParams(b), origin));
    const P = `/batches?centre=${C.A}`;
    const form = { op: "create", centreId: String(C.A), code: "morning", name: "Morning", startsAt: "09:00", endsAt: "10:00", capacity: "2" };
    expect(where(await save(form))).toBe(`${P}&saved=1`);
    expect(where(await save(form))).toBe(`${P}&error=batch.duplicate`);
    expect(where(await save({ ...form, code: "X", capacity: "many" }))).toBe(`${P}&error=invalid&detail=capacity`);
    expect(where(await save({ op: "update", centreId: String(C.A), id: "1", name: "Morning", startsAt: "09:00", endsAt: "10:30", capacity: "2" }))).toBe(`${P}&saved=1`);
    expect(where(await save({ op: "active", centreId: String(C.A), id: "1", active: "x", reason: "r" }))).toBe(`${P}&error=invalid&detail=active`);
    expect(where(await save({ op: "active", centreId: String(C.A), id: "1", active: "0", reason: "r" }))).toBe(`${P}&saved=1`);
    expect(where(await save({ op: "nope", centreId: String(C.A) }))).toBe(`${P}&error=invalid&detail=op`);
    expect((await save(form, "https://evil.example")).status).toBe(403);
    await bt.setBatchActive(A, C.A, 1, true, "back");

    const [l1, l2] = [await learner(), await learner()];
    const place = (pairs: [string, string][], origin?: string) => placeRoute(post("/batches/place/save", new URLSearchParams(pairs), origin));
    const Q = `/batches/place?centre=${C.A}&course=DCA`;
    const base: [string, string][] = [["centreId", String(C.A)], ["course", "DCA"], ["filterBatch", ""]];
    expect(where(await place([...base, ["batchId", "1"], ["registrationId", l1.id], ["registrationId", l2.id]]))).toBe(`${Q}&saved=1`);
    expect(await sql(`select count(*)::int n from app.registration where batch_id = 1`)).toEqual([{ n: 2 }]);
    expect(where(await place([...base, ["batchId", ""], ["registrationId", l1.id]]))).toBe(`${Q}&saved=1`); // "" is no batch
    expect(await sql(`select batch_id from app.registration where id = $1`, [l1.id])).toEqual([{ batch_id: null }]);
    expect(where(await place([...base, ["batchId", "1"]]))).toBe(`${Q}&error=invalid&detail=registrationIds`);
    expect(where(await place([["centreId", String(C.A)], ["course", "DCA"], ["filterBatch", "1"], ["batchId", "1"], ["registrationId", l2.id]])))
      .toBe(`${Q}&batch=1&error=invalid`); // nothing to change
    expect((await place([...base, ["batchId", "1"], ["registrationId", l1.id]], "https://evil.example")).status).toBe(403);
  });
});

