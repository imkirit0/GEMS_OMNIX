// The three code/name masters behind one page (catalogue-masters DD-8) and the toggle field reader (R1).
import type { MasterKind } from "@/server/catalogue";
import { RbacError } from "@/server/rbac";

export const SLUGS: Record<string, { kind: MasterKind; title: string }> = {
  categories: { kind: "course_category", title: "Course categories" },
  divisions: { kind: "course_division", title: "Course divisions" },
  classes: { kind: "centre_class", title: "Centre classes" },
  "enquiry-paths": { kind: "enquiry_path", title: "Enquiry paths" },
  "enquiry-types": { kind: "enquiry_type", title: "Enquiry types" },
  "fee-categories": { kind: "fee_category", title: "Fee categories" },
};
/** The master for a URL slug, or undefined (own keys only: "constructor" is no slug). */
export const slugOf = (slug: string) => (Object.hasOwn(SLUGS, slug) ? SLUGS[slug] : undefined);

/** "1" → true, "0" → false; anything else is a tampered form. */
export function flag(field: string, v: string | undefined): boolean {
  if (v === "1") return true;
  if (v === "0") return false;
  throw new RbacError("invalid", `${field}: invalid`);
}
