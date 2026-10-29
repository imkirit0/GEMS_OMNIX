// Which courses the admission form offers at a centre (course-master DD-16, certifications DD-3). No imports, so the
// client bundle may include it (R16); admit() in people.ts applies the same rule on the server, and a test asserts they agree.

/** centreIds: the course's named centres within the caller's scope ([] = none here), or null when the class rule applies. */
export type OfferCourse = { code: string; name: string; classCodes: string[]; centreIds: number[] | null };
export type OfferCentre = { id: number; code: string; name: string; classCode: string | null };

export function offeredCourses<T extends OfferCourse>(courses: T[], centre: OfferCentre | null | undefined, enforced: boolean): T[] {
  if (!enforced || !centre) return courses;
  const k = centre.classCode;
  // a course with named centres is offered only there; otherwise by the centre's class (a centre without one: none)
  return courses.filter((c) => (c.centreIds !== null ? c.centreIds.includes(centre.id) : k !== null && c.classCodes.includes(k)));
}
