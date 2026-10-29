import { notFound } from "next/navigation";
import { listCourses } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";
import { CourseErrors, CourseForm } from "../course-form";

// New course: catalogue managers only; anyone else gets the same 404 as a missing page.
export default async function NewCourse({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string }> }) {
  const { error, detail } = await searchParams;
  const l = await pageRead((s) => listCourses(s)); // for the picklists and canManage
  if (!l.canManage) notFound();
  return (
    <main>
      <p><a href="/admin/catalogue/courses">All courses</a></p>
      <h1>New course</h1>
      <CourseErrors error={error} detail={detail} />
      <CourseForm action="/admin/catalogue/courses/create" categories={l.categories} divisions={l.divisions} />
    </main>
  );
}
