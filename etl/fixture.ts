// P8 synthetic fixture (design: "The Synthetic Fixture and Its Defects"). No real data; fixed seed, mulberry32.
import { PERSON_POLICY } from "../src/server/people";
import type { RawRow } from "./types";

export const FIXTURE_SEED = 20261028;
export const AS_OF = "2026-10-28";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (n: number) => String(n).padStart(6, "0");
const GIVEN = ["Anu", "Arjun", "Devi", "Faisal", "Gita", "Hari", "Indu", "Jose", "Kavya", "Lekha", "Manu", "Nisha"];
const FAMILY = ["Nair", "Menon", "Pillai", "Varghese", "Iyer", "Thomas", "Kurian", "Das", "Rao", "Khan"];
const COURSES = ["DCA", "TALLY", "PYTHON", "DTP", "CCNA"];
const STATUSES = ["Active", "Active", "Active", " active", "Drop", "Leave", "Transfer"];

export type Fixture = { legacy_centre: RawRow[]; legacy_admission: RawRow[]; legacy_course_row: RawRow[] };

/** ~2,000 admissions and ~3,000 course rows over centres A, A2, B, followed by the planted defects. */
export function buildFixture(seed = FIXTURE_SEED): Fixture {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayIn = (from: string, to: string) => { // a date between two ISO dates inclusive
    const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
    return new Date(a + Math.floor(rnd() * ((b - a) / 86_400_000 + 1)) * 86_400_000).toISOString().slice(0, 10);
  };
  const legacy_centre: RawRow[] = [" kl2-25 ", "KL3-07", "TN1-03", "GDEMO", "XX9-99", "KL3-07"]
    .map((code, i) => ({ source_key: key(i + 1), code, name: `Legacy centre ${i + 1}`, status: "Active" }));

  const legacy_admission: RawRow[] = [];
  const legacy_course_row: RawRow[] = [];
  const seq: Record<string, number> = { "2025-26": 38000, "2026-27": 40000 };
  let reg = 2_000_000;
  const addAdmission = (a: Partial<RawRow> & { academic_year: string }, courses = 1, courseExtra: Partial<RawRow> = {}) => {
    const k = key(legacy_admission.length + 1);
    const year = a.academic_year;
    const admittedOn = a.admitted_on !== undefined ? a.admitted_on
      : year === "2025-26" ? dayIn("2025-06-01", "2026-05-28") : dayIn("2026-06-01", "2026-10-27");
    const row: RawRow = {
      source_key: k, centre_code: pick(["KL2-25", "KL3-07", "TN1-03"]),
      admission_no: year in seq ? `${PERSON_POLICY.admissionPrefix(year)}${++seq[year]!}` : null,
      first_name: pick(GIVEN), last_name: pick(FAMILY), dob: `${1990 + Math.floor(rnd() * 21)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`,
      mobile: `9${String(100_000_000 + legacy_admission.length).padStart(9, "0")}`, ...a, admitted_on: admittedOn,
    } as RawRow;
    legacy_admission.push(row);
    for (let c = 0; c < courses; c++) {
      legacy_course_row.push({ source_key: key(legacy_course_row.length + 1), admission_key: k, course_code: pick(COURSES),
        register_no: String(++reg), join_date: admittedOn, status: pick(STATUSES), ...courseExtra });
    }
    return row;
  };

  for (let i = 0; i < 2000; i++) addAdmission({ academic_year: rnd() < 0.5 ? "2025-26" : "2026-27" }, rnd() < 0.5 ? 1 : 2);

  // ---------- planted defects (design table) ----------
  addAdmission({ academic_year: "2026-27", centre_code: "GDEMO" }, 1);
  addAdmission({ academic_year: "2026-27", centre_code: "GDEMO", admission_no: `${PERSON_POLICY.admissionPrefix("2026-27")}43887` }, 1,
    { register_no: "2064112" }); // the highest numbers sit on excluded rows (G7)
  addAdmission({ academic_year: "2026-27", centre_code: "XX9-99" }, 1);
  addAdmission({ academic_year: "2026-27", first_name: "Meera", last_name: "Nair", dob: "2001-01-11", mobile: "9811100001" }, 1);
  addAdmission({ academic_year: "2026-27", first_name: "Nair", last_name: "Meera", dob: "2001-01-11", mobile: "9811100001" }, 1);
  addAdmission({ academic_year: "2026-27", first_name: "Rahul", last_name: "Menon", dob: "2002-02-02", mobile: "+91 98470 12345" }, 1);
  addAdmission({ academic_year: "2026-27", first_name: "Rahul", last_name: "Menon", dob: "2002-02-02", mobile: "09847012345" }, 1);
  addAdmission({ academic_year: "2026-27", first_name: "Sona", dob: "" }, 1);
  addAdmission({ academic_year: "2026-27", first_name: "Tara", admitted_on: "45231" }, 1);
  addAdmission({ academic_year: "2026-2027", first_name: "Uma", admission_no: "LEGACY-UMA" }, 1);
  const twin = addAdmission({ academic_year: "2026-27" }, 1);
  addAdmission({ academic_year: "2026-27", admission_no: twin["admission_no"]! }, 1);
  addAdmission({ academic_year: "2026-27", admission_no: "G-TEC/26/0042" }, 1);
  addAdmission({ academic_year: "2027-28", admission_no: `${PERSON_POLICY.admissionPrefix("2027-28")}1`, admitted_on: "2026-10-01" }, 1);
  const last = legacy_course_row.at(-1)!;
  legacy_course_row.push({ source_key: key(legacy_course_row.length + 1), admission_key: "999999", course_code: "DCA",
    register_no: String(++reg), join_date: "2026-07-01", status: "Active" });
  legacy_course_row.push({ ...last, source_key: key(legacy_course_row.length + 1), course_code: "TALLY" }); // same Register No
  legacy_course_row.push({ ...last, source_key: key(legacy_course_row.length + 1), register_no: String(++reg), status: "Completed" });
  // catalogue skeleton (appended so every row above is unchanged): an unknown course, and a year not in the master
  legacy_course_row.push({ source_key: key(legacy_course_row.length + 1), admission_key: twin.source_key, course_code: "XYZ",
    register_no: String(++reg), join_date: twin["admitted_on"]!, status: "Active" });
  addAdmission({ academic_year: "2030-31", admission_no: `${PERSON_POLICY.admissionPrefix("2030-31")}1`, admitted_on: "2026-10-01" }, 1);
  return { legacy_centre, legacy_admission, legacy_course_row };
}
