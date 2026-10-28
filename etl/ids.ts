// Deterministic ids (design: "Deterministic Ids and Order"). UUIDv5, RFC 9562 §5.5, on node:crypto.
import { createHash } from "node:crypto";

export const ETL_NAMESPACE = "4f6d0b2e-9c1a-5e7b-8d3f-2a6c4e8b1d90"; // never changed

export function uuidv5(name: string, namespace: string = ETL_NAMESPACE): string {
  const h = createHash("sha1").update(Buffer.from(namespace.replace(/-/g, ""), "hex")).update(name, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // version 5
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** `${source_system}/${source_table}/${encodeURIComponent(source_key)}/${target_table}[/${n}]` */
export const targetName = (system: string, table: string, key: string, targetTable: string, n?: number) =>
  `${system}/${table}/${encodeURIComponent(key)}/${targetTable}${n == null ? "" : `/${n}`}`;
