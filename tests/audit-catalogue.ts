// The sensitive-action catalogue (T-AUD-001/009): every audit action the system writes.
// Adding an action in code without listing it here, or listing it without a test that asserts it, fails CI.
export const AUDIT_CATALOGUE = [
  // authentication (src/server/auth)
  "auth.login.success", "auth.login.failure", "auth.login.locked", "auth.lockout", "auth.password.rehash",
  "auth.totp.enrol", "auth.totp.failure", "auth.recovery.failure", "auth.2fa.lockout", "auth.recovery.regenerate",
  "auth.logout", "auth.password.change", "auth.reset.request", "auth.reset.complete", "auth.stepup", "auth.stepup.failure",
  "auth.sessions.revoked",
  // administration (src/server/rbac.ts, scripts/bootstrap-admin.mjs)
  "rbac.user.create", "rbac.user.enable", "rbac.user.disable", "rbac.assignment.create", "rbac.assignment.delete",
  "rbac.role.create", "rbac.role.permissions", "rbac.user.setup_link", "rbac.bootstrap",
  // exports (src/server/exports.ts DATASETS)
  "export.centres", "export.users",
  // tickets (src/server/tickets/engine.ts, setup.ts)
  "ticket.upload.request", "ticket.raise", "ticket.approve", "ticket.reject", "ticket.forward", "ticket.reassign",
  "ticket.apply_failed", "ticket.document.download", "ticket.review.duplicates",
  "ticket.category.create", "ticket.type.create", "ticket.type.update", "ticket.type.levels", "ticket.type.viewers",
  "ticket.type.activate", "ticket.type.deactivate",
  // person core (src/server/people.ts)
  "person.admit", "person.details.update",
  // catalogue (src/server/catalogue.ts)
  "catalogue.create", "catalogue.update", "catalogue.activate", "catalogue.deactivate", "catalogue.course.classes", "catalogue.centre.class", "catalogue.course.certifications", "catalogue.course.centres",
  // centre onboarding (src/server/centres.ts)
  "org.centre.create", "org.centre.update", "org.centre.activate", "org.centre.deactivate",
  "org.region.create", "org.region.update", "org.area.create", "org.area.update",
  // course batches (src/server/batches.ts)
  "batch.create", "batch.update", "batch.activate", "batch.deactivate", "batch.place",
  // enquiry (src/server/enquiry.ts)
  "enquiry.create", "enquiry.update", "enquiry.status", "enquiry.counsellor", "enquiry.followup",
  "enquiry.setup.status.create", "enquiry.setup.status.update", "enquiry.setup.status.activate", "enquiry.setup.status.deactivate",
  // migration runs (etl/run.ts)
  "migration.run.start", "migration.run.finish",
] as const;
