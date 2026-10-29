// Ticket engine parameters (PMC, not approved: Q9 / D-STO-1, NP-5 / DD-10). No imports, so the plain-Node
// operator script scripts/storage-setup.mjs can read the same values (Node 24 runs erasable TypeScript).
export const TICKET_POLICY = {
  maxFileBytes: 10 * 1024 * 1024,
  // checked against the stored object's first bytes, never the name or type the browser sends
  fileTypes: [
    { mime: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
    { mime: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
    { mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  maxFilesPerTicket: 5,
  downloadUrlSeconds: 60,
  numberPad: 0,
  numberMaxLength: 30,
  numberPeriod: "ALL", // one counter that never resets (NP-2 default)
} as const;

// Go-live gates (correction-tickets DD-14, DD-18), for every ticket type, in every environment. Mutable so tests can
// open them; the committed values stay false (a test asserts it). A manual Supabase run sets documentsLive locally
// before `next build` and never commits it.
export const TICKET_GATES = {
  numberingSigned: false, // NP signed and the ticket counter seeded after the legacy numbers
  documentsLive: false, // ADR-002 signed and the engine's DD-16 safeguards built (upload cleanup, per-user limit)
};
export function gateRefusal(t: { documentRequired: boolean }): "ticket.setup.numbering" | "ticket.setup.storage" | null {
  if (!TICKET_GATES.numberingSigned) return "ticket.setup.numbering";
  return t.documentRequired && !TICKET_GATES.documentsLive ? "ticket.setup.storage" : null;
}
