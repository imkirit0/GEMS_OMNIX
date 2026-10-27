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
] as const;
