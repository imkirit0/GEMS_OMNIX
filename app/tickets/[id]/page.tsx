import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { getTicket } from "@/server/tickets/engine";
import { HANDLERS } from "@/server/tickets/handlers";

// Detail, history and documents; the action buttons are offered only when act() would allow them.
export default async function TicketDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; detail?: string }> }) {
  const { id } = await params;
  const { error, detail } = await searchParams;
  const t = await pageRead((s) => getTicket(s, id)); // hidden or missing: 404
  const name = (u: string | null) => (u ? t.names[u] ?? "someone" : "");
  const self = `/tickets/${t.id}`;
  // the stale text comes from the handler's fixed list, never from the URL (design D10)
  const stale = error === "ticket.stale" && detail
    ? Object.values(HANDLERS).map((h) => h.staleMessages[detail]).find(Boolean) : undefined;
  return (
    <main>
      <p><a href="/tickets">All tickets</a> · <a href="/tickets/approvals">My approvals</a></p>
      <h1>{t.number}: {t.typeName}</h1>
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["ticket.invalid"]}{stale ? ` ${stale}` : ""}</p>}
      <p>Centre {t.centreCode} · Priority {t.priority} · Status {t.status} · Level {t.currentLevel} of {t.levelCount}
        {t.assignedUserId && <> · Forwarded to {name(t.assignedUserId)}</>}</p>
      <p>Raised by {name(t.raisedBy)} on {t.createdAt.toISOString().slice(0, 10)}
        {t.reraiseOf && <> · Re-raise of <a href={`/tickets/${t.reraiseOf}`}>an earlier ticket</a></>}</p>
      <h2>Request</h2>
      <pre>{JSON.stringify(t.payload, null, 2)}</pre>

      <h2>Levels</h2>
      <ol>{t.levels.map((l) => <li key={l.level}>{l.approverUserId ? name(l.approverUserId) : `Role: ${l.roleName ?? l.approverRoleId}`}</li>)}</ol>

      <h2>Documents</h2>
      {t.documents.length === 0 ? <p>None.</p> : (
        <ul>{t.documents.map((d) => (
          <li key={String(d.id)}>
            <form method="post" action={`${self}/documents/${d.id}`} style={{ display: "inline" }}>
              <button type="submit">Download {d.fileName}</button>
            </form> ({d.contentType}, {String(d.sizeBytes)} bytes)
          </li>))}
        </ul>
      )}

      {t.canAct && (
        <>
          <h2>Act at level {t.currentLevel}</h2>
          <form method="post" action={`${self}/act`}>
            <input type="hidden" name="seenVersion" value={t.version} />
            <label style={{ display: "block" }}>Remarks (required to reject) <input name="remarks" maxLength={1000} /></label>
            <label style={{ display: "block" }}>Forward to <select name="forwardTo" defaultValue="">
              <option value="">(only for Forward)</option>
              {t.candidates.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select></label>
            <button type="submit" name="action" value="approve">Approve</button>{" "}
            <button type="submit" name="action" value="reject">Reject</button>{" "}
            <button type="submit" name="action" value="forward">Forward</button>
          </form>
        </>
      )}
      {t.status === "REJECTED" && <p><a href={`/tickets/new?reraise=${t.id}`}>Re-raise as a new ticket</a> (the person who raised it only)</p>}

      {t.canReassign && (
        <>
          <h2>Reassign (administrator)</h2>
          <form method="post" action={`${self}/reassign`}>
            <input type="hidden" name="seenVersion" value={t.version} />
            <label>Reassign level {t.currentLevel} to <select name="toUserId" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {t.candidates.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select></label>{" "}
            <button type="submit">Reassign</button>
          </form>
        </>
      )}

      <h2>History</h2>
      <ol>{t.history.map((e) => (
        <li key={String(e.id)}>{e.at.toISOString().slice(0, 16).replace("T", " ")} · {name(e.actorId)} · {e.action} at level {e.level}
          {e.toUserId && <> to {name(e.toUserId)}</>}{e.remarks && <>: {e.remarks}</>}</li>))}
      </ol>
    </main>
  );
}
