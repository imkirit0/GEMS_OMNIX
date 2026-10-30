// Phone call log (docs/designs/call-log, WF-X16, R-084 standalone): calls not tied to an enquiry. Reads need enquiry.view
// at the centre; logging needs enquiry.manage and view there (I1), at an active centre (DD-2). Append-only (DD-3); the
// database sets who and when (call_log_guard, 0022). The audit names fields only, never values (enquiry DD-14).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope } from "./db";
import { bad } from "./catalogue";
import { ownText, phoneDigits } from "./details";
import { isoDate, istToday, PersonError } from "./person-rules";
import { RbacError } from "./rbac";

export type CallType = "CALL_IN" | "CALL_OUT";
export type CallInput = { centreId: number; phone: string; name?: string | null; calledOn?: string | null; callType: CallType;
  durationMin?: number | null; description?: string | null; note?: string | null; nextFollowUpOn?: string | null;
  teleCaller?: string | null }; // undefined = the person logging; null = none (C1)
export type CallRow = { id: string; phone: string; name: string | null; calledOn: string; callType: CallType; durationMin: number | null;
  description: string | null; note: string | null; nextFollowUpOn: string | null; at: string };
export type CallFilter = { from?: string; to?: string; callType?: string; dueBy?: string };

const MAX_LIST = 200; // PMC
const MAX_DURATION = 600; // PMC
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The fields of the audit row, in this order (R5). */
const FIELDS = ["phone", "name", "calledOn", "callType", "durationMin", "description", "note", "nextFollowUpOn", "teleCaller"] as const;

// the shared field helpers throw PersonError; the admin routes map RbacError (R1)
const rb = <T>(run: () => T): T => { try { return run(); } catch (e) { if (e instanceof PersonError) throw bad(e.message); throw e; } };
const centreOf = (v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad("centreId: unknown"); return v as number; };

async function callDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const c = cause?.originalCode;
    if (c === "23503") throw bad("teleCaller: inactive or unknown"); // the only foreign key that can fail (I6)
    if (c === "23514") throw new RbacError("invalid", "invalid value");
    if (c === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

export async function logCall(session: string | undefined, input: CallInput): Promise<{ id: string }> {
  const centreId = centreOf(input?.centreId);
  const v = rb(() => {
    if (typeof input.phone !== "string" || input.phone.trim() === "") throw bad("phone: required");
    const phone = phoneDigits("phone", input.phone);
    const name = ownText("name", input.name, 100);
    const calledOn = input.calledOn == null || input.calledOn === "" ? istToday() : isoDate("calledOn", input.calledOn);
    if (calledOn > istToday()) throw bad("calledOn: not in the future");
    if (input.callType !== "CALL_IN" && input.callType !== "CALL_OUT") throw bad("callType: one of the listed values");
    const d = input.durationMin;
    if (d != null && (!Number.isSafeInteger(d) || d < 0 || d > MAX_DURATION)) throw bad(`durationMin: 0-${MAX_DURATION}`);
    const description = ownText("description", input.description, 1000, true);
    const note = ownText("note", input.note, 1000, true);
    const next = input.nextFollowUpOn == null || input.nextFollowUpOn === "" ? null : isoDate("nextFollowUpOn", input.nextFollowUpOn);
    if (next !== null && next < calledOn) throw bad("nextFollowUpOn: not before calledOn");
    const t = input.teleCaller;
    if (t !== undefined && t !== null && (typeof t !== "string" || !UUID.test(t))) throw bad("teleCaller: inactive or unknown");
    return { phone, name, calledOn, callType: input.callType, durationMin: d ?? null, description, note, nextFollowUpOn: next };
  });
  // the id first: scopedAction fixes the audit target before its callback (D1)
  const id = await withScope(session, async (tx) => (await tx.$queryRaw<{ id: string }[]>`select nextval('app.call_log_id_seq')::text as id`)[0]!.id);
  let stored: Record<string, unknown> = {};
  return scopedAction(session, { action: "call.create", permission: "enquiry.manage", centreId, targetType: "call", targetId: id },
    (tx, ctx) => callDb(async () => {
      await authorize(tx, "enquiry.view", centreId); // DENIED names enquiry.view (I1)
      const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
      if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
      // the default: the person logging, who holds manage and view here, so may receive (R6)
      const teleCaller = input.teleCaller === undefined ? ctx.userId : input.teleCaller;
      if (teleCaller !== null) {
        const [ok] = await tx.$queryRaw<{ ok: boolean }[]>`select app.enquiry_may_receive(${centreId}, ${teleCaller}::uuid) as ok`;
        if (!ok?.ok) throw bad("teleCaller: inactive or unknown");
      }
      stored = { ...v, teleCaller };
      await tx.$executeRaw`insert into app.call_log (id, centre_id, phone, name, called_on, call_type, duration_min, description, note,
          next_follow_up_on, tele_caller)
        values (${id}::bigint, ${centreId}, ${v.phone}, ${v.name}, ${v.calledOn}::date, ${v.callType}, ${v.durationMin}::int, ${v.description},
          ${v.note}, ${v.nextFollowUpOn}::date, ${teleCaller}::uuid)`;
      return { id };
    }), () => ({ after: { fields: FIELDS.filter((k) => stored[k] != null) } }));
}

export function listCalls(session: string | undefined, centreId: number, f: CallFilter = {}): Promise<{ rows: CallRow[]; truncated: boolean }> {
  return withScope(session, async (tx) => {
    if (!Number.isSafeInteger(centreId) || centreId < 1) throw new Forbidden("enquiry.view denied", "enquiry.view"); // a 404 (D9)
    await authorize(tx, "enquiry.view", centreId);
    // an invalid filter matches nothing (C4), as listEnquiries
    const date = (s?: string) => (s === undefined || s === "" ? null : DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : "invalid");
    const [from, to, due] = [date(f.from), date(f.to), date(f.dueBy)];
    const type = f.callType === undefined || f.callType === "" ? null : f.callType;
    if ([from, to, due].includes("invalid") || (type !== null && type !== "CALL_IN" && type !== "CALL_OUT")) return { rows: [], truncated: false };
    const rows = await tx.$queryRaw<(Omit<CallRow, "at"> & { at: Date })[]>`
      select id::text, phone, name, called_on::text as "calledOn", call_type as "callType", duration_min as "durationMin", description, note,
             next_follow_up_on::text as "nextFollowUpOn", at
      from app.call_log where centre_id = ${centreId}
        and (${from}::date is null or called_on >= ${from}::date) and (${to}::date is null or called_on <= ${to}::date)
        and (${type}::text is null or call_type = ${type}::text)
        and (${due}::date is null or next_follow_up_on <= ${due}::date)
      order by called_on desc, id desc limit ${MAX_LIST + 1}`;
    return { rows: rows.slice(0, MAX_LIST).map((r) => ({ ...r, at: r.at.toISOString() })), truncated: rows.length > MAX_LIST };
  });
}
