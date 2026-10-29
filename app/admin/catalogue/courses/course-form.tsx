// The course form and error lines shared by the new and edit pages (course-master design). A server component: the
// form posts as a plain HTML form to the course routes.
import { ADMIN_MESSAGES } from "@/server/admin-http";
import type { CourseDetails } from "@/server/catalogue";

export const FLAG_LABELS = {
  visible: "Offered for admission", materialsRequired: "Materials required", marklistRequired: "Marklist required",
  noRegFee: "No registration fee", itMagic: "IT MAGIC programme", keltron: "KELTRON course",
  internshipKeltron: "KELTRON internship", selected: "Selected course",
} as const;
/** The label for each field a "<field>: <rule>" error can name (R5). */
export const COURSE_FIELD_LABELS: Record<string, string> = {
  code: "Code", name: "Name", displayName: "Display name", categoryId: "Category", divisionId: "Division",
  department: "Department", durationType: "Duration type", durationMonths: "Months", durationWeeks: "Weeks",
  durationDays: "Days", durationHours: "Hours", capacity: "Capacity", examMinDays: "Exam minimum days",
  sortOrder: "Sort order", keltronShare: "KELTRON share (%)", classIds: "Centre classes", reason: "Reason", ...FLAG_LABELS,
};

export function CourseErrors({ error, detail }: { error?: string | undefined; detail?: string | undefined }) {
  if (!error) return null;
  if (error !== "invalid") return <p role="alert">{ADMIN_MESSAGES[error] ?? "Some values were invalid."}</p>;
  const label = detail ? COURSE_FIELD_LABELS[detail] : undefined;
  return <p role="alert">Some values were invalid.{label && <> Check: {label}</>}</p>;
}

type Entry = { id: number; code: string; name: string; active: boolean };
export type CourseValues = CourseDetails & { code: string; name: string; categoryId: number; divisionId: number };
const label = (e: Entry) => `${e.code} ${e.name}${e.active ? "" : " (inactive)"}`;
const num = (n: number | null) => (n === null ? "" : String(n));

export function CourseForm({ action, course, categories, divisions }: { action: string; course?: CourseValues; categories: Entry[]; divisions: Entry[] }) {
  const row = { display: "block" } as const;
  return (
    <form method="post" action={action}>
      <input type="hidden" name="op" value="details" />
      {course
        ? <p>Code: {course.code}</p>
        : <label style={row}>Code <input name="code" required maxLength={30} /></label>}
      <label style={row}>Name <input name="name" required maxLength={200} defaultValue={course?.name} /></label>
      <label style={row}>Display name <input name="displayName" maxLength={200} defaultValue={course?.displayName ?? ""} /></label>
      <label style={row}>Category <select name="categoryId" required defaultValue={course?.categoryId}>
        {categories.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}</select></label>
      <label style={row}>Division <select name="divisionId" required defaultValue={course?.divisionId}>
        {divisions.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}</select></label>
      <label style={row}>Department <input name="department" maxLength={100} defaultValue={course?.department ?? ""} /></label>
      <label style={row}>Duration type <select name="durationType" defaultValue={course?.durationType ?? ""}>
        <option value="" /><option value="MONTH">Month</option><option value="WEEK">Week</option>
        <option value="DAY">Day</option><option value="NA">Not applicable</option></select></label>
      <label>Months <input name="durationMonths" inputMode="numeric" size={4} defaultValue={num(course?.durationMonths ?? null)} /></label>{" "}
      <label>Weeks <input name="durationWeeks" inputMode="numeric" size={4} defaultValue={num(course?.durationWeeks ?? null)} /></label>{" "}
      <label>Days <input name="durationDays" inputMode="numeric" size={5} defaultValue={num(course?.durationDays ?? null)} /></label>{" "}
      <label>Hours <input name="durationHours" inputMode="numeric" size={6} defaultValue={num(course?.durationHours ?? null)} /></label>
      <label style={row}>Capacity <input name="capacity" inputMode="numeric" defaultValue={num(course?.capacity ?? null)} /></label>
      <label style={row}>Exam minimum days <input name="examMinDays" inputMode="numeric" defaultValue={num(course?.examMinDays ?? null)} /></label>
      <label style={row}>Sort order <input name="sortOrder" inputMode="numeric" required defaultValue={String(course?.sortOrder ?? 0)} /></label>
      {(Object.keys(FLAG_LABELS) as (keyof typeof FLAG_LABELS)[]).map((k) => (
        <label key={k} style={row}><input type="checkbox" name={k} value="1" defaultChecked={course ? course[k] : k === "visible"} /> {FLAG_LABELS[k]}</label>
      ))}
      <label style={row}>KELTRON share (%) <input name="keltronShare" inputMode="decimal" defaultValue={num(course?.keltronShare ?? null)} /> (KELTRON courses only)</label>
      <button type="submit">{course ? "Save details" : "Create course"}</button>
    </form>
  );
}
