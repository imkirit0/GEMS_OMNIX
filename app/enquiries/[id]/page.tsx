import { notFound } from "next/navigation";
import { enquiryCounsellors, enquiryOptions, FOLLOW_UP_KINDS, getEnquiry } from "@/server/enquiry";
import { pageRead } from "@/server/page-read";
import { CounsellorForm, EditForm, FollowUpForm, StatusForm } from "./forms";

// One enquiry (enquiry design G2, G3). Hidden, missing and malformed ids are the same 404 (pageRead).
export default async function Enquiry({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const { g, options, people } = await pageRead(async (s) => {
    const g = await getEnquiry(s, id);
    return { g, options: await enquiryOptions(s), people: g.canManage ? await enquiryCounsellors(s, g.enquiry.centreId) : [] };
  });
  const e = g.enquiry as Record<string, unknown> & typeof g.enquiry;
  const str = (k: string) => (e[k] == null ? "" : String(e[k]));
  const values = Object.fromEntries(["givenName", "familyName", "dateOfBirth", "gender", "mobile", "email", "currentAddress", "currentPincode",
    "qualification", "guardianName", "guardianPhone", "whatsapp", "landline", "instagram", "lastSchool", "remark", "pathId", "typeId"]
    .map((k) => [k, str(k)]).filter(([, v]) => v !== ""));
  e.courseCodes.forEach((c, i) => { values[`course${i + 1}`] = c; });
  const ctx = { id: e.id, centreId: e.centreId };
  const enrolled = Boolean(e.admissionId);
  return (
    <main>
      <p><a href="/enquiries">All enquiries</a> · <a href="/enquiries/calendar">Follow-up calendar</a></p>
      <h1>Enquiry {e.id}: {str("givenName")} {str("familyName")}</h1>
      {saved && <p role="status">Saved.</p>}
      <p>{str("centreCode")} · <span style={{ color: str("statusColour") }}>{str("statusName")}</span> · enquired {str("enquiredOn")}
        {e["counsellorName"] ? ` · counsellor ${str("counsellorName")}` : ""}
        {e["nextFollowUpOn"] ? ` · next follow-up ${str("nextFollowUpOn")}` : ""}</p>
      {enrolled && <p>Enrolled{e["admissionNo"] ? `: admission ${str("admissionNo")}` : ""}.</p>}
      {g.canEnrol && <p><a href={`/students/new?enquiry=${e.id}`}>Enroll this learner</a></p>}
      {g.canManage && !enrolled ? (
        <>
          <h2>Status</h2>
          <StatusForm ctx={ctx} statuses={options.statuses} current={e["statusId"] as number} />
          <h2>Counsellor</h2>
          <CounsellorForm ctx={ctx} people={people} current={(e["counsellorId"] as string | null) ?? null} />
          <h2>Follow-up</h2>
          <FollowUpForm ctx={ctx} kinds={FOLLOW_UP_KINDS} />
          <h2>Details</h2>
          <EditForm ctx={ctx} version={e.version} values={values} options={options} />
        </>
      ) : (
        <dl>
          <dt>Mobile</dt><dd>{str("mobile")}</dd>
          <dt>Courses</dt><dd>{e.courseCodes.join(", ")}</dd>
          <dt>Remark</dt><dd>{str("remark") || "—"}</dd>
        </dl>
      )}
      <h2>Follow-ups</h2>
      <ul>
        {g.followUps.map((f) => (
          <li key={f.id}>{f.at.slice(0, 16)} · {FOLLOW_UP_KINDS[f.kind] ?? f.kind}{f.durationMin != null ? ` (${f.durationMin} min)` : ""}
            {f.byName ? ` · ${f.byName}` : ""}: {f.note}{f.nextOn ? ` · next ${f.nextOn}` : ""}</li>
        ))}
      </ul>
      {g.followUps.length === 0 && <p>No follow-ups yet.</p>}
    </main>
  );
}
