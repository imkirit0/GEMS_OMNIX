// Money for display (fee-structure R13): amounts stay strings (numeric(14,2) as text), never JS numbers (audit 07 F13).
/** "1234567.50" -> "₹12,34,567.50": Indian digit grouping, built from the string. */
export function inr(s: string): string {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = ""] = m;
  const last3 = int!.slice(-3), rest = int!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${sign}₹${grouped}.${frac.padEnd(2, "0")}`;
}
