// Which courses the admission form offers at a centre (course-master DD-16). No imports, so the client bundle may
// include it (R16); admit() in people.ts applies the same rule on the server, and a test asserts they agree.

export type OfferCourse = { code: string; name: string; classCodes: string[] };
export type OfferCentre = { id: number; code: string; name: string; classCode: string | null };

export function offeredCourses<T extends OfferCourse>(courses: T[], centre: OfferCentre | null | undefined, enforced: boolean): T[] {
  if (!enforced || !centre) return courses;
  const k = centre.classCode;
  if (k === null) return []; // a centre without a class sells nothing (DD-7)
  return courses.filter((c) => c.classCodes.includes(k));
}
