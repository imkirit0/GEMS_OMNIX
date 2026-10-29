"use client";
// The enquiry record's forms (enquiry design G2): edit (with version), status, counsellor, follow-up.
import { useActionState } from "react";
import type { EnquiryFormState, RecordFormState } from "@/server/enquiry-form";
import EnquiryFields, { type EnquiryOptions } from "../enquiry-fields";
import { counsellorAction, enquiryStatusAction, followUpAction, saveEnquiryAction } from "./actions";

type Ctx = { id: string; centreId: number };
const Hidden = ({ id, centreId }: Ctx) => (<><input type="hidden" name="id" value={id} /><input type="hidden" name="centreId" value={centreId} /></>);
const Errors = ({ s }: { s: RecordFormState }) => (
  <>{s.formError && <p role="alert">{s.formError}</p>}
    {Object.entries(s.fieldErrors).map(([k, m]) => <p key={k} role="alert">{k}: {m}</p>)}</>
);

export function EditForm({ ctx, version, values, options }: { ctx: Ctx; version: number; values: Record<string, string>; options: EnquiryOptions }) {
  const [state, action, pending] = useActionState(saveEnquiryAction, { values, fieldErrors: {} } as EnquiryFormState);
  return (
    <form action={action} key={JSON.stringify(state)}>
      <Hidden {...ctx} /><input type="hidden" name="version" value={version} />
      <EnquiryFields values={state.values} errors={state.fieldErrors} options={options} edit />
      <button type="submit" disabled={pending}>Save changes</button>
      {state.formError && <p role="alert">{state.formError}</p>}
    </form>
  );
}

export function StatusForm({ ctx, statuses, current }: { ctx: Ctx; statuses: { id: number; name: string; kind: string }[]; current: number }) {
  const [state, action, pending] = useActionState(enquiryStatusAction, { fieldErrors: {} } as RecordFormState);
  return (
    <form action={action}>
      <Hidden {...ctx} />
      <label>Status <select name="statusId" defaultValue={current}>
        {statuses.filter((s) => s.kind !== "ENROLLED").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>{" "}
      <label>Note (needed to mark lost or junk, or to reopen) <input name="note" maxLength={2000} /></label>{" "}
      <button type="submit" disabled={pending}>Change status</button>
      <Errors s={state} />
    </form>
  );
}

export function CounsellorForm({ ctx, people, current }: { ctx: Ctx; people: { id: string; displayName: string }[]; current: string | null }) {
  const [state, action, pending] = useActionState(counsellorAction, { fieldErrors: {} } as RecordFormState);
  return (
    <form action={action}>
      <Hidden {...ctx} />
      <label>Counsellor <select name="userId" defaultValue={current ?? ""}>
        <option value="">(none)</option>{people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      </select></label>{" "}
      <button type="submit" disabled={pending}>Assign</button>
      <Errors s={state} />
    </form>
  );
}

export function FollowUpForm({ ctx, kinds }: { ctx: Ctx; kinds: Record<string, string> }) {
  const [state, action, pending] = useActionState(followUpAction, { fieldErrors: {} } as RecordFormState);
  return (
    <form action={action}>
      <Hidden {...ctx} />
      <label>Kind <select name="kind" defaultValue="CALL_OUT">
        {Object.entries(kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select></label>{" "}
      <label>Minutes <input name="durationMin" inputMode="numeric" size={4} /></label>{" "}
      <label style={{ display: "block" }}>Note <textarea name="note" required rows={2} maxLength={2000} /></label>
      <label>Next follow-up <input type="date" name="nextOn" /></label>{" "}
      <label><input type="checkbox" name="clearNext" value="1" /> No further follow-up</label>{" "}
      <button type="submit" disabled={pending}>Add follow-up</button>
      <Errors s={state} />
    </form>
  );
}
