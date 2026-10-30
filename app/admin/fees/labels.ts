// Field labels for the fee pages' error line (AdminErrors), and the id rule of their parameters.
export const FEE_FIELD_LABELS: Record<string, string> = {
  code: "Code", name: "Name", categoryId: "Category", sortOrder: "Order", hsnSac: "HSN/SAC", gstRate: "GST rate", reason: "Reason",
  active: "Status", academicYear: "Academic year", dueOn: "Due date", courseId: "Course", centreClassId: "Centre class", centreId: "Centre",
  feeTypeId: "Fee type", captionId: "Instalment", amount: "Amount", accountId: "Account", planId: "Plan", id: "Record", op: "Operation",
};
export const ID = /^\d{1,9}$/;
