// Field labels for the call log's error line (AdminErrors), and the id rule of its parameters.
export const CALL_FIELD_LABELS: Record<string, string> = {
  centreId: "Centre", phone: "Phone", name: "Name", calledOn: "Date", callType: "Call type", durationMin: "Duration",
  description: "Description", note: "Note", nextFollowUpOn: "Next follow-up", teleCaller: "Tele-caller",
};
export const ID = /^\d{1,9}$/;
export const CALL_TYPES: Record<string, string> = { CALL_IN: "Incoming", CALL_OUT: "Outgoing" };
