import { notFound } from "next/navigation";
import { followUpCalendar } from "@/server/enquiry";
import { istToday } from "@/server/person-rules";
import { pageRead } from "@/server/page-read";

// Follow-ups due in a month (enquiry design G4, C19): open enquiries by their next follow-up date, at most 1000.
export default async function Calendar({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const { month: m } = await searchParams;
  if (Array.isArray(m)) notFound();
  const month = m ?? istToday().slice(0, 7);
  const days = await pageRead((s) => followUpCalendar(s, month));
  const [y, mm] = month.split("-").map(Number) as [number, number];
  const shift = (d: number) => { const t = new Date(Date.UTC(y, mm - 1 + d, 1)); return t.toISOString().slice(0, 7); };
  return (
    <main>
      <p><a href="/enquiries">All enquiries</a></p>
      <h1>Follow-ups due in {month}</h1>
      <p><a href={`/enquiries/calendar?month=${shift(-1)}`}>Previous month</a> · <a href={`/enquiries/calendar?month=${shift(1)}`}>Next month</a></p>
      {days.length === 0 && <p>No follow-ups due this month.</p>}
      {days.map((d) => (
        <section key={d.day}>
          <h2>{d.day}</h2>
          <ul>{d.rows.map((r) => <li key={r.id}><a href={`/enquiries/${r.id}`}>{r.id}</a> {r.givenName} {r.familyName ?? ""} · {r.statusName}{r.counsellorName ? ` · ${r.counsellorName}` : ""}</li>)}</ul>
        </section>
      ))}
    </main>
  );
}
