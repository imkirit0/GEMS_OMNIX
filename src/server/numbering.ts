// Numbering mechanism (C-02.2; POC P3). Policy NP-1..NP-8 is UNAPPROVED: everything policy-shaped is a parameter.
import type { Tx } from "./db";

// Allocate inside the caller's transaction. The row lock serialises allocators and a rollback
// releases the increment, so the same code serves both gapless and unique-only policies.
export async function allocate(tx: Tx, s: { centreId: number; docType: string; period: string }): Promise<bigint> {
  const rows = await tx.$queryRaw<{ current: bigint }[]>`
    update app.number_series set current = current + 1
    where centre_id = ${s.centreId} and doc_type = ${s.docType} and period = ${s.period}
    returning current`;
  if (!rows[0]) throw new Error(`no number series ${s.centreId}/${s.docType}/${s.period}`);
  return rows[0].current;
}

// Tickets: one network-wide counter (ticket-engine DD-8), so it cannot live in number_series (centre in its key).
// The first raise of a period creates the row; the upsert's row lock serialises raisers like allocate().
export async function allocateTicketNumber(tx: Tx, period: string): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ current: bigint }[]>`
    insert into app.ticket_number_series (period, current) values (${period}, 1)
    on conflict (period) do update set current = ticket_number_series.current + 1
    returning current`;
  return row!.current;
}

// SRC format {prefix}/{typecode}/{seq}; padding and length are NP-5 parameters (DD-10). Over-length is rejected.
export function formatTicketNumber(p: { prefix: string; typeCode: string; number: bigint | number; pad: number; maxLength: number }): string {
  const s = `${p.prefix}/${p.typeCode}/${String(p.number).padStart(p.pad, "0")}`;
  if (s.length > p.maxLength) throw new RangeError(`ticket number is ${s.length} chars, limit ${p.maxLength}`);
  return s;
}

// Indian financial year (Apr-Mar) of an instant in Asia/Kolkata (UTC+5:30, no DST). NP-2 may choose AY instead.
export function financialYear(instant: Date): string {
  const ist = new Date(instant.getTime() + 330 * 60_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// NP-5 (format, max length) is unapproved: pieces and limit are inputs. Over-length is rejected, never truncated.
export function formatNumber(p: { centreCode: string; docType: string; period: string; number: bigint | number; pad?: number; maxLength?: number }): string {
  const s = `${p.centreCode}/${p.docType}/${p.period}/${String(p.number).padStart(p.pad ?? 6, "0")}`;
  if (p.maxLength != null && s.length > p.maxLength) throw new RangeError(`formatted number is ${s.length} chars, limit ${p.maxLength}`);
  return s;
}
