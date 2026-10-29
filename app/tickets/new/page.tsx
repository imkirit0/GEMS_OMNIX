import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { getTicket, raiseOptions } from "@/server/tickets/engine";
import { HANDLERS } from "@/server/tickets/handlers";
import Upload from "./upload";

// Two steps without client JavaScript: choose type and centre (GET), then fill in the type's fields.
// A re-raise (DD-9) fixes the rejected ticket's type and centre and starts with blank fields.
export default async function NewTicket({ searchParams }: { searchParams: Promise<{ type?: string; centre?: string; reraise?: string; error?: string; detail?: string }> }) {
  const q = await searchParams;
  const { options, source } = await pageRead(async (s) => ({
    options: await raiseOptions(s),
    source: q.reraise ? await getTicket(s, q.reraise) : null,
  }));
  if (q.reraise && (!source || source.status !== "REJECTED")) notFound();
  const typeId = source ? null : Number(q.type);
  const centreId = source?.centreId ?? Number(q.centre);
  const type = source ? null : options.types.find((t) => t.id === typeId);
  const centre = options.centres.find((c) => c.id === centreId);
  // a handler's specific reason comes from its fixed list, never from the URL (correction-tickets DD-12)
  const specific = q.error === "ticket.invalid" && q.detail
    ? Object.values(HANDLERS).map((h) => h.invalidMessages?.[q.detail!]).find(Boolean) : undefined;
  const error = q.error && <p role="alert">{specific ?? ADMIN_MESSAGES[q.error] ?? ADMIN_MESSAGES["ticket.invalid"]}</p>;

  if (options.types.length === 0) {
    return <main><p><a href="/tickets">All tickets</a></p><h1>Raise a ticket</h1><p>No ticket types are available.</p></main>;
  }
  if (!source && (!type || !centre)) {
    return (
      <main>
        <p><a href="/tickets">All tickets</a></p>
        <h1>Raise a ticket</h1>
        {error}
        <form method="get">
          <label>Type <select name="type" required defaultValue={q.type ?? ""}>
            <option value="" disabled>Choose…</option>
            {options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
          <label>Centre <select name="centre" required defaultValue={q.centre ?? ""}>
            <option value="" disabled>Choose…</option>
            {options.centres.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
          </select></label>
          <button type="submit">Next</button>
        </form>
      </main>
    );
  }
  // a re-raise uses the rejected ticket's type; its handler fields come from the live type list
  const fieldsOf = source ? options.types.find((t) => t.code === source.typeCode) : type;
  if (!fieldsOf) notFound();
  return (
    <main>
      <p><a href="/tickets">All tickets</a></p>
      <h1>{source ? `Re-raise ${source.number}` : `Raise: ${fieldsOf.name}`}</h1>
      {error}
      <form method="post" action="/tickets/create" id="raise">
        <input type="hidden" name="ticketId" value={randomUUID()} />
        <input type="hidden" name="typeId" value={fieldsOf.id} />
        <input type="hidden" name="centreId" value={centreId} />
        {source && <input type="hidden" name="reraiseOf" value={source.id} />}
        <p>Centre: {centre ? `${centre.code} ${centre.name}` : source?.centreCode}</p>
        {fieldsOf.fields.map((f) => (
          <label key={f.name} style={{ display: "block" }}>{f.label}{" "}
            {f.kind === "select"
              ? <select name={`p.${f.name}`} required>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <input name={`p.${f.name}`} type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"} />}
          </label>
        ))}
        {fieldsOf.documentRequired && <Upload typeId={fieldsOf.id} centreId={centreId} form="raise" />}
        <button type="submit">Raise ticket</button>
      </form>
    </main>
  );
}
