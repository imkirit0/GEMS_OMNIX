import { enquiryCounsellors, enquiryOptions, listEnquiries, STATUS_KINDS } from "@/server/enquiry";
import { pageRead } from "@/server/page-read";
import EnquiryList from "./list";

// Enquiries at centres in the viewer's enquiry.view scope (R-081, R-085). No such scope: 404.
// Filters are GET parameters without personal data; the search term travels only in a POST body (Z5).
const KEYS = { centre: "centreId", status: "statusId", kind: "kind", counsellor: "counsellorId", from: "from", to: "to", due: "due" } as const;

export default async function Enquiries({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const filter = Object.fromEntries(Object.entries(KEYS).map(([param, key]) => [key, typeof p[param] === "string" ? p[param] : ""])
    .filter(([, v]) => v !== "")) as Record<string, string>;
  const { rows, options, people } = await pageRead(async (s) => {
    const options = await enquiryOptions(s);
    const centre = Number(filter["centreId"]);
    const managed = options.centres.find((c) => c.id === centre && c.manage);
    return { rows: await listEnquiries(s, filter), options, people: managed ? await enquiryCounsellors(s, centre) : [] };
  });
  const canBulk = options.centres.some((c) => String(c.id) === filter["centreId"] && c.manage);
  const sel = (name: string, list: { v: string; label: string }[]) => (
    <select name={name} defaultValue={typeof p[name] === "string" ? p[name] : ""}><option value="">All</option>
      {list.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
  );
  return (
    <main>
      <p><a href="/">Home</a>{options.centres.some((c) => c.manage && c.active) && <> · <a href="/enquiries/new">New enquiry</a></>}
        {" · "}<a href="/enquiries/calendar">Follow-up calendar</a>
        {options.canSetup && <> · <a href="/enquiries/statuses">Statuses</a> · <a href="/admin/catalogue/masters/enquiry-paths">Paths</a> · <a href="/admin/catalogue/masters/enquiry-types">Types</a></>}</p>
      <h1>Enquiries</h1>
      {typeof p["done"] === "string" && <p role="status">Changed {p["done"]} enquiries.</p>}
      <form method="get">
        <label>Centre {sel("centre", options.centres.map((c) => ({ v: String(c.id), label: c.code })))}</label>{" "}
        <label>Status {sel("status", options.statuses.map((s) => ({ v: String(s.id), label: s.name })))}</label>{" "}
        <label>Kind {sel("kind", STATUS_KINDS.map((k) => ({ v: k, label: k })))}</label>{" "}
        <label>From <input type="date" name="from" defaultValue={filter["from"] ?? ""} /></label>{" "}
        <label>To <input type="date" name="to" defaultValue={filter["to"] ?? ""} /></label>{" "}
        <label>Follow-up due by <input type="date" name="due" defaultValue={filter["due"] ?? ""} /></label>{" "}
        <button type="submit">Filter</button>
      </form>
      {!canBulk && <p>Filter by one centre you manage to change several enquiries at once.</p>}
      <EnquiryList rows={rows} filter={filter} statuses={options.statuses} people={people} canBulk={canBulk} />
    </main>
  );
}
