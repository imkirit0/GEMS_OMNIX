// Phone call log: T-CL-001…003 (audit 09; docs/designs/call-log/call-log.md). Page 404s are real-server smoke checks.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as saveRoute } from "../app/calls/save/route";
import { Forbidden } from "../src/server/action";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import * as cl from "../src/server/call-log";
import { istToday } from "../src/server/person-rules";
import { asAdmin, C, EQ, EQ_TOKEN, reset, rows, T } from "./fixtures";

const WA = EQ_TOKEN.wa, VA = EQ_TOKEN.va, WB = EQ_TOKEN.wb;
const T_UA = "00000000-0000-0000-0000-00000000000a"; // the user behind T.uA
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string }; } finally { await db.query("rollback"); }
});
const base: cl.CallInput = { centreId: C.A, phone: "98470 00001", callType: "CALL_IN" };

let app: pg.Client; // gems_app with a session, as withScope connects
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q, p); } finally { await app.query("rollback"); }
};
const asErr = (tok: string, q: string, p: unknown[] = []) => as(tok, q, p).then(() => null, (e: { code: string }) => e.code);
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(() => reset());

describe("T-CL phone call log", () => {
  test("T-CL-001 logging and listing calls: fields, defaults, messages, who may, audit, filters", async () => {
    expect(await cl.logCall(WA, { ...base, name: " Asha ", calledOn: "2026-10-28", durationMin: 5, description: "Asked about DCA\nfees",
      note: " call back ", nextFollowUpOn: "2026-11-02" })).toEqual({ id: "1" });
    expect(await sql(`select phone, name, called_on::text, call_type, duration_min, description, note, next_follow_up_on::text,
      tele_caller::text, by_user::text from app.call_log where id = 1`)).toEqual([{ phone: "9847000001", name: "Asha", called_on: "2026-10-28",
      call_type: "CALL_IN", duration_min: 5, description: "Asked about DCA\nfees", note: "call back", next_follow_up_on: "2026-11-02",
      tele_caller: EQ.wa, by_user: EQ.wa }]);
    // the audit names fields only (D2)
    const [a1] = (await rows("call.create")).filter((r) => r.outcome === "OK");
    expect(a1).toMatchObject({ target_type: "call", target_id: "1", target_centre_id: C.A,
      after: { fields: ["phone", "name", "calledOn", "callType", "durationMin", "description", "note", "nextFollowUpOn", "teleCaller"] } });
    expect(JSON.stringify(a1)).not.toMatch(/9847000001|Asha/);
    // defaults: today; the logger as tele-caller; an explicit null means none (C1)
    const { id: id2 } = await cl.logCall(WA, { ...base, callType: "CALL_OUT" });
    const { id: id3 } = await cl.logCall(WA, { ...base, teleCaller: null });
    expect(await sql(`select id::text, called_on::text d, tele_caller::text t from app.call_log where id in (${id2}, ${id3}) order by id`))
      .toEqual([{ id: id2, d: istToday(), t: EQ.wa }, { id: id3, d: istToday(), t: null }]);
    expect((await rows("call.create")).filter((r) => r.outcome === "OK")[2].after).toEqual({ fields: ["phone", "calledOn", "callType"] });

    // each message, in order
    const bad: [Partial<cl.CallInput>, string][] = [
      [{ centreId: 0, phone: "" }, "centreId: unknown"], [{ phone: " ", name: "\u0001" }, "phone: required"], [{ phone: "123" }, "phone: 10 digits"],
      [{ name: "a\u0001", calledOn: "x" }, "name: invalid characters"], [{ name: "x".repeat(101) }, "name: 1-100 characters"],
      [{ calledOn: "28/10/2026" }, "calledOn: YYYY-MM-DD"], [{ calledOn: "2026-02-30" }, "calledOn: not a date"],
      [{ calledOn: "2999-01-01" }, "calledOn: not in the future"], [{ callType: "VISIT" as never }, "callType: one of the listed values"],
      [{ durationMin: 601 }, "durationMin: 0-600"], [{ durationMin: 1.5 }, "durationMin: 0-600"], [{ durationMin: -1 }, "durationMin: 0-600"],
      [{ description: "a\u0001" }, "description: invalid characters"], [{ note: "x".repeat(1001) }, "note: 1-1000 characters"],
      [{ nextFollowUpOn: "x" }, "nextFollowUpOn: YYYY-MM-DD"], [{ calledOn: "2026-10-28", nextFollowUpOn: "2026-10-27" }, "nextFollowUpOn: not before calledOn"],
      [{ teleCaller: "x" }, "teleCaller: inactive or unknown"], [{ teleCaller: EQ.wb }, "teleCaller: inactive or unknown"], // B's worker
    ];
    for (const [o, m] of bad) expect(await msg(cl.logCall(WA, { ...base, ...o })), JSON.stringify(o)).toBe(m);
    await cl.logCall(WA, { ...base, calledOn: "2026-10-28", nextFollowUpOn: "2026-10-28" }); // the same day is fine

    // who may: managers at their centre; viewers read only; others nothing; manage without view refused (I1)
    expect(await thrown(cl.logCall(VA, base))).toBeInstanceOf(Forbidden);
    expect(await thrown(cl.logCall(WB, base))).toBeInstanceOf(Forbidden);
    expect(await thrown(cl.logCall(T.uA, base))).toBeInstanceOf(Forbidden);
    expect(await thrown(cl.listCalls(T.uA, C.A))).toBeInstanceOf(Forbidden);
    expect(await thrown(cl.listCalls(WB, C.A))).toBeInstanceOf(Forbidden);
    expect(await thrown(cl.listCalls(VA, 0))).toBeInstanceOf(Forbidden);
    await sql(`insert into app.role (id, key, name) values (27, 'enquiry_manage_only', 'Manage only')`);
    await sql(`insert into app.role_permission values (27, 'enquiry.manage')`);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 27, 'CENTRE', 1)`, [T_UA]);
    expect(await thrown(cl.logCall(T.uA, base))).toBeInstanceOf(Forbidden);
    expect((await rows("call.create")).filter((r) => r.outcome === "DENIED").at(-1)).toMatchObject({ detail: { permission: "enquiry.view" } });
    // an inactive centre logs no calls (R11)
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 22, 'CENTRE', 2)`, [EQ.wa]);
    await sql(`update app.centre set status = 'INACTIVE' where id = 2`);
    expect(await msg(cl.logCall(WA, { ...base, centreId: C.A2 }))).toBe("centreId: centre is not active");

    // the list: newest first (date, then id); filters inclusive; invalid filters match nothing
    const list = await cl.listCalls(VA, C.A);
    expect(list.truncated).toBe(false);
    expect(list.rows.map((r) => r.id)).toEqual([id3, id2, "5", "1"]); // today's two (newest id first), then 2026-10-28's two
    expect(list.rows[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const ids = async (f: cl.CallFilter) => (await cl.listCalls(VA, C.A, f)).rows.map((r) => r.id).sort();
    expect(await ids({ from: "2026-10-28", to: "2026-10-28" })).toEqual(["1", "5"]);
    expect(await ids({ callType: "CALL_OUT" })).toEqual([id2]);
    expect(await ids({ dueBy: "2026-11-01" })).toEqual(["5"]);
    expect(await ids({ dueBy: "2026-11-02" })).toEqual(["1", "5"]);
    for (const f of [{ from: "x" }, { to: "2026-13-01" }, { callType: "VISIT" }, { dueBy: "tomorrow" }]) expect(await ids(f), JSON.stringify(f)).toEqual([]);
    // capped at 200
    await sql(`insert into app.call_log (centre_id, phone, called_on, call_type, by_user) select 1, '9000000000', '2026-01-01', 'CALL_IN', $1
      from generate_series(1, 200)`, [EQ.wa]);
    const many = await cl.listCalls(VA, C.A);
    expect([many.rows.length, many.truncated]).toEqual([200, true]);
  });

  test("T-CL-002 the log in the database: append-only, who and when, row security, grants, named checks", async () => {
    // a plain app insert gets the session user and now(); naming who or when is refused by the grant (R2)
    await as(WA, `insert into app.call_log (centre_id, phone, called_on, call_type) values (1, '9000000001', '2026-10-28', 'CALL_IN')`);
    const r = await as(WA, `insert into app.call_log (centre_id, phone, called_on, call_type) values (1, '9000000001', '2026-10-28', 'CALL_IN')
      returning by_user::text u, (now() - at) < interval '1 minute' fresh`);
    expect(r.rows).toEqual([{ u: EQ.wa, fresh: true }]);
    expect(await asErr(WA, `insert into app.call_log (centre_id, phone, called_on, call_type, by_user) values (1, '9000000001', '2026-10-28', 'CALL_IN', $1)`, [EQ.va]))
      .toBe("42501");
    expect(await asErr(WA, `insert into app.call_log (centre_id, phone, called_on, call_type, at) values (1, '9000000001', '2026-10-28', 'CALL_IN', '2000-01-01')`))
      .toBe("42501");
    expect(await asErr(VA, `insert into app.call_log (centre_id, phone, called_on, call_type) values (1, '9000000001', '2026-10-28', 'CALL_IN')`)).toBe("42501");
    expect(await asErr(WA, `insert into app.call_log (centre_id, phone, called_on, call_type) values (3, '9000000001', '2026-10-28', 'CALL_IN')`)).toBe("42501");
    // the owner's forged time is replaced; the owner cannot change, delete or truncate the log (R9)
    await sql(`insert into app.call_log (centre_id, phone, called_on, call_type, by_user, at) values (1, '9000000002', '2026-10-28', 'CALL_IN', $1, '2000-01-01')`, [EQ.wa]);
    expect(await sql(`select (now() - at) < interval '1 minute' fresh from app.call_log`)).toEqual([{ fresh: true }]);
    for (const q of [`update app.call_log set note = 'x'`, `delete from app.call_log`, `truncate app.call_log`]) {
      expect(await sqlErr(q), q).toMatchObject({ code: expect.any(String) });
    }
    expect(await sql(`select count(*)::int n from app.call_log`)).toEqual([{ n: 1 }]);
    // the app role: no update or delete; viewers read, others not
    expect(await asErr(WA, `update app.call_log set note = 'x'`)).toBe("42501");
    expect(await asErr(WA, `delete from app.call_log`)).toBe("42501");
    expect((await as(VA, `select count(*)::int n from app.call_log`)).rows).toEqual([{ n: 1 }]);
    expect((await as(T.uA, `select count(*)::int n from app.call_log`)).rows).toEqual([{ n: 0 }]);
    expect((await as(WB, `select count(*)::int n from app.call_log`)).rows).toEqual([{ n: 0 }]);
    // the insert grant (R14)
    expect((await sql(`select column_name from information_schema.column_privileges where table_schema = 'app' and table_name = 'call_log'
      and grantee = 'gems_app' and privilege_type = 'INSERT' order by column_name`)).map((x) => x.column_name)).toEqual(["called_on", "call_type",
      "centre_id", "description", "duration_min", "id", "name", "next_follow_up_on", "note", "phone", "tele_caller"].sort());
    // named checks refuse the same values to the owner
    const ins = (col: string, v: string) => sqlErr(`insert into app.call_log (centre_id, phone, called_on, call_type, by_user${col ? `, ${col}` : ""})
      values (1, ${col === "phone" ? v : "'9000000003'"}, '2026-10-28', ${col === "call_type" ? v : "'CALL_IN'"}, '${EQ.wa}'${col && col !== "phone" && col !== "call_type" ? `, ${v}` : ""})`.replace(", phone)", ")").replace(", call_type)", ")"));
    for (const [col, v, c] of [["phone", "'123'", "call_log_phone_check"], ["name", "' x'", "call_log_name_check"], ["name", `'${"x".repeat(101)}'`, "call_log_name_check"],
      ["name", "E'a\\nb'", "call_log_name_check"], ["description", "' x'", "call_log_description_check"], ["note", `'${"x".repeat(1001)}'`, "call_log_note_check"],
      ["call_type", "'VISIT'", "call_log_call_type_check"], ["duration_min", "601", "call_log_duration_min_check"],
      ["next_follow_up_on", "'2026-10-27'", "call_log_follow_up_check"]] as const) {
      expect(await ins(col, v), `${col} ${v}`).toMatchObject({ code: "23514", constraint: c });
    }
    expect(await ins("description", "E'line\\nline'")).toBeNull(); // multiline allowed
    // the multiline checks are 0018's own (R10)
    const def = async (c: string) => (await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conname = $1`, [c]))[0].d as string;
    expect((await def("call_log_note_check")).replaceAll("note", "X")).toBe((await def("enquiry_remark_check")).replaceAll("remark", "X"));
    expect((await def("call_log_name_check")).replaceAll("name", "X").replace("100", "N"))
      .toBe((await def("enquiry_given_name_check")).replaceAll("given_name", "X").replace("100", "N"));
    // row security with four commands
    const sec = await sql(`select c.relrowsecurity rls, c.relforcerowsecurity force, array(select case polcmd when 'r' then 'SELECT'
      when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end from pg_policy where polrelid = c.oid order by 1) cmds
      from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'app' where c.relname = 'call_log'`);
    expect(sec).toEqual([{ rls: true, force: true, cmds: ["DELETE", "INSERT", "SELECT", "UPDATE"] }]);
  });

  test("T-CL-003 route: saved, field details, origin, empty fields", async () => {
    const ORIGIN = "https://gems.test";
    const post = (body: Record<string, string>, origin = ORIGIN) => saveRoute(new Request(`${ORIGIN}/calls/save`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${WA}`, origin } }));
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const P = `/calls?centre=${C.A}`;
    const form = { centreId: String(C.A), phone: "9847000001", name: "", calledOn: "", callType: "CALL_IN", durationMin: "", description: "",
      note: "", nextFollowUpOn: "", teleCaller: "" };
    expect(where(await post(form))).toBe(`${P}&saved=1`);
    expect(await sql(`select name, called_on::text d, duration_min, tele_caller from app.call_log`)).toEqual([{ name: null, d: istToday(), duration_min: null, tele_caller: null }]);
    const { teleCaller: _t, ...noCaller } = form;
    expect(where(await post(noCaller))).toBe(`${P}&saved=1`); // no select: the default
    expect(await sql(`select tele_caller::text t from app.call_log where id = 2`)).toEqual([{ t: EQ.wa }]);
    expect(where(await post({ ...form, phone: "12" }))).toBe(`${P}&error=invalid&detail=phone`);
    expect(where(await post({ ...form, durationMin: "lots" }))).toBe(`${P}&error=invalid&detail=durationMin`);
    expect(where(await post({ ...form, centreId: "x" }))).toBe(`/calls?error=invalid&detail=centreId`);
    expect((await post(form, "https://evil.example")).status).toBe(403);
  });
});
