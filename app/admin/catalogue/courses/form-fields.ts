// Posted course fields to the catalogue's input (course-master form mapping). A malformed number becomes NaN, so the
// server refuses it with that field's message (D2: "1e2" and "0x10" are not whole numbers).
const text = (s: string | undefined) => { const t = (s ?? "").trim(); return t === "" ? null : t; };
const int = (s: string | undefined) => { const t = (s ?? "").trim(); return t === "" ? null : /^\d+$/.test(t) ? Number(t) : NaN; };
const share = (s: string | undefined) => { const t = (s ?? "").trim(); return t === "" ? null : /^\d{1,3}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };

export function courseFields(f: Record<string, string>) {
  return {
    name: f["name"] ?? "", categoryId: Number(f["categoryId"]), divisionId: Number(f["divisionId"]),
    displayName: text(f["displayName"]), department: text(f["department"]),
    durationType: text(f["durationType"]) as "MONTH" | "WEEK" | "DAY" | "NA" | null,
    durationMonths: int(f["durationMonths"]), durationWeeks: int(f["durationWeeks"]), durationDays: int(f["durationDays"]),
    durationHours: int(f["durationHours"]), capacity: int(f["capacity"]), examMinDays: int(f["examMinDays"]),
    sortOrder: int(f["sortOrder"]) as number, // blank → null → "sortOrder: invalid"
    visible: f["visible"] === "1", materialsRequired: f["materialsRequired"] === "1", marklistRequired: f["marklistRequired"] === "1",
    noRegFee: f["noRegFee"] === "1", itMagic: f["itMagic"] === "1", keltron: f["keltron"] === "1",
    internshipKeltron: f["internshipKeltron"] === "1", selected: f["selected"] === "1", keltronShare: share(f["keltronShare"]),
  };
}
