// Field labels for the batch pages' error line (AdminErrors), and the shared id rule of their parameters.
export const BATCH_FIELD_LABELS: Record<string, string> = {
  centreId: "Centre", code: "Code", name: "Name", startsAt: "Start time", endsAt: "End time", capacity: "Capacity",
  active: "Status", reason: "Reason", id: "Batch", batchId: "Batch", registrationIds: "Learners", op: "Operation",
};
export const ID = /^\d{1,9}$/;
