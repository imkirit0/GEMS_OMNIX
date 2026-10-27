// Authentication policy values (ADR-001). Every number is PMC (D-SEC-3) until Accounts/IT sign; change here only.
export const POLICY = {
  lockoutThreshold: 5, // T-AUTH-003, PMC
  lockoutMinutes: 15,
  secondFactorMaxFailures: 5, // TOTP / recovery-code guesses per user before a lockout, PMC
  ipLimit: 20, // attempts per IP per window, T-AUTH-004, PMC
  ipWindowMinutes: 10,
  idleMinutes: 30, // T-AUTH-013, PMC (D-SEC-3); must equal app.idle_minutes() in the DB (test-enforced)
  absoluteHours: 12,
  resetMinutes: 30, // T-AUTH-008
  stepUpMaxAgeSeconds: 300, // T-AUTH-015
  recoveryCodeCount: 10,
  minPasswordLength: 12, // D-SEC-3, PMC (breach-list check optional, also PMC)
} as const;

export const GENERIC_INVALID = "Invalid login or password.";

export type SignIn =
  | { kind: "session"; token: string; setCookie: string }
  | { kind: "totp"; challenge: string } // password accepted, second factor required
  | { kind: "enrol"; challenge: string } // TOTP required by role but not enrolled: no session yet
  | { kind: "invalid"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "rate_limited" };
