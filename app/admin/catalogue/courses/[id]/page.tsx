import { notFound } from "next/navigation";
import { durationSummary, getCourse } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";
import { AdminErrors } from "../../admin-errors";
import { COURSE_FIELD_LABELS, CourseForm, FLAG_LABELS } from "../course-form";

// One course: the form, centre classes and the switch for catalogue managers; a read-only view without the KELTRON
// share for everyone else (DD-13). The save route dispatches on the hidden op field.
export default async function Course({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, detail, saved } = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const { course: c, categories, divisions, classes, canManage } = await pageRead((s) => getCourse(s, Number(id)));
  const save = `/admin/catalogue/courses/${c.id}/save`;
  const code = (list: { id: number; code: string }[], x: number) => list.find((e) => e.id === x)?.code ?? "—";
  return (
    <main>
      <p><a href="/admin/catalogue/courses">All courses</a></p>
      <h1>{c.code}: {c.name}</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={COURSE_FIELD_LABELS} />
      <p>{c.active ? "Active" : "Inactive"} · {c.visible ? "Offered for admission" : "Not offered for admission"}</p>
      {canManage ? (
        <>
          <h2>Details</h2>
          <CourseForm action={save} course={c} categories={categories} divisions={divisions} />

          <h2>Centre classes</h2>
          <form method="post" action={save}>
            <input type="hidden" name="op" value="classes" />
            {classes.map((k) => (
              <label key={k.id} style={{ display: "block" }}><input type="checkbox" name="classId" value={k.id} defaultChecked={c.classes.includes(k.code)} />{" "}
                {k.code} {k.name}{k.active ? "" : " (inactive)"}</label>
            ))}
            <button type="submit">Save classes</button>
          </form>

          <h2>Status</h2>
          <form method="post" action={save}>
            <input type="hidden" name="op" value="active" />
            <input type="hidden" name="active" value={c.active ? "0" : "1"} />
            <label>Reason <input name="reason" required /></label>{" "}
            <button type="submit">{c.active ? "Deactivate" : "Activate"}</button>
          </form>
        </>
      ) : (
        <dl>
          <dt>Display name</dt><dd>{c.displayName ?? "—"}</dd>
          <dt>Category</dt><dd>{code(categories, c.categoryId)}</dd>
          <dt>Division</dt><dd>{code(divisions, c.divisionId)}</dd>
          <dt>Department</dt><dd>{c.department ?? "—"}</dd>
          <dt>Duration</dt><dd>{durationSummary(c)}</dd>
          <dt>Capacity</dt><dd>{c.capacity ?? "—"}</dd>
          <dt>Exam minimum days</dt><dd>{c.examMinDays ?? "—"}</dd>
          <dt>Centre classes</dt><dd>{c.classes.join(", ") || "—"}</dd>
          {(Object.keys(FLAG_LABELS) as (keyof typeof FLAG_LABELS)[]).map((k) => (
            <div key={k}><dt>{FLAG_LABELS[k]}</dt><dd>{c[k] ? "Yes" : "No"}</dd></div>
          ))}
        </dl>
      )}
    </main>
  );
}
