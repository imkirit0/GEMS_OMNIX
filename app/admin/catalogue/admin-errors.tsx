// The error line of the catalogue pages (catalogue-masters Z2, C13): the ADMIN_MESSAGES text, or for a field error
// "Some values were invalid." and the field's label. Own keys only (D4): ?error=__proto__ must not reach React.
import { ADMIN_MESSAGES } from "@/server/admin-http";

export const MASTER_FIELD_LABELS: Record<string, string> = {
  code: "Code", name: "Name", reason: "Reason", startsOn: "Start date", endsOn: "End date", classId: "Class",
  centreId: "Centre", active: "Status", open: "Status", type: "Type", description: "Description",
};

export function AdminErrors({ error, detail, labels }: { error?: string | undefined; detail?: string | undefined; labels: Record<string, string> }) {
  if (!error) return null;
  if (error !== "invalid") return <p role="alert">{Object.hasOwn(ADMIN_MESSAGES, error) ? ADMIN_MESSAGES[error] : "Some values were invalid."}</p>;
  const label = detail && Object.hasOwn(labels, detail) ? labels[detail] : undefined;
  return <p role="alert">Some values were invalid.{label && <> Check: {label}</>}</p>;
}
