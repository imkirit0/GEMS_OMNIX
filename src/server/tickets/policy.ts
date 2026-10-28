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
