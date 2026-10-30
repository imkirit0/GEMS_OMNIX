// Shared fee seed (fee-dues R4): the fee-structure fixture data, used by fee-structure and fee-dues tests.
// Callers run reset() and setStepUp("tok-feeS", 0) first.
import * as cat from "../src/server/catalogue";
import * as fee from "../src/server/fees";
import { asAdmin, C } from "./fixtures";

export const FEE_S = "tok-feeS";
export const DCA = 1, TALLY = 2, CCNA = 5, METRO = 1; // fixture ids (restart identity)
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));

/** Centre A in METRO; DCA and TALLY sold through METRO; CCNA names centre B only. */
export async function placeCentre() {
  await sql(`update app.centre set centre_class_id = $1 where id = $2`, [METRO, C.A]);
  await sql(`insert into app.course_centre_class (course_id, centre_class_id) values ($1, $3), ($2, $3)`, [DCA, TALLY, METRO]);
  await sql(`insert into app.course_centre (course_id, centre_id) values ($1, $2)`, [CCNA, C.B]);
}

/** A category, a course-fee type and a registration type, and two instalments for 2026-27. */
export async function masters() {
  const S = FEE_S;
  const { id: catId } = await cat.createMaster(S, "fee_category", { code: "course fee", name: "Course fee" });
  const { id: course } = await fee.createFeeType(S, { code: "cf", name: "Course Fee", categoryId: catId, sortOrder: 10, hsnSac: "999293", gstRate: "18.00" });
  const { id: reg } = await fee.createFeeType(S, { code: "reg", name: "Registration", categoryId: catId, sortOrder: 1, hsnSac: "999293", gstRate: "18" });
  const { id: i1 } = await fee.createCaption(S, { academicYear: "2026-27", name: "INSTALLMENT 1", dueOn: "2026-11-30", sortOrder: 1 });
  const { id: i2 } = await fee.createCaption(S, { academicYear: "2026-27", name: "INSTALLMENT 2", dueOn: "2027-01-31", sortOrder: 2 });
  return { catId, course, reg, i1, i2 };
}

/** placeCentre + masters + a published DCA/METRO 2026-27 class plan: 2 fee types x 2 instalments. */
export async function seedFeePlan() {
  await placeCentre();
  const m = await masters();
  const { id: planId } = await fee.createPlan(FEE_S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO });
  // in the order dues are created (D5): instalment, then fee type order (reg 1, course 10)
  const lines = [
    { feeTypeId: m.reg, captionId: m.i1, amount: "500.00", dueOn: "2026-11-30" },
    { feeTypeId: m.course, captionId: m.i1, amount: "12000.50", dueOn: "2026-11-30" },
    { feeTypeId: m.reg, captionId: m.i2, amount: "0.10", dueOn: "2027-01-31" },
    { feeTypeId: m.course, captionId: m.i2, amount: "8000.00", dueOn: "2027-01-31" },
  ];
  for (const l of lines) await fee.setPlanLine(FEE_S, planId, { feeTypeId: l.feeTypeId, captionId: l.captionId, amount: l.amount });
  await fee.publishPlan(FEE_S, planId, "seed");
  return { ...m, planId, lines, total: "20500.60" };
}
