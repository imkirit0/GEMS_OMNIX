// ADR-001 bake-off: the candidate-neutral contract. Every candidate implements this; the same suite
// (bakeoff/suite.ts, T-AUTH-001..020) runs against each. Policy numbers are PMC (D-SEC-3) and live in POLICY.

export const POLICY = {
  lockoutThreshold: 5, // T-AUTH-003, PMC
  lockoutMinutes: 15,
  ipLimit: 20, // attempts per IP per window, T-AUTH-004, PMC
  ipWindowMinutes: 10,
  idleMinutes: 30, // T-AUTH-013, PMC (D-SEC-3)
  absoluteHours: 12,
  resetMinutes: 30, // T-AUTH-008
  stepUpMaxAgeSeconds: 300, // T-AUTH-015
  recoveryCodeCount: 10,
} as const;

export const GENERIC_INVALID = "Invalid login or password.";

export type SignIn =
  | { kind: "session"; token: string; setCookie: string }
  | { kind: "totp"; challenge: string } // password accepted, second factor required
  | { kind: "enrol"; challenge: string } // TOTP required by role but not enrolled: no session yet
  | { kind: "invalid"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "rate_limited" };

export type NewUser = { id: string; login: string; password: string; requiresTotp: boolean };

export interface Candidate {
  name: string;
  setup(): Promise<void>; // create the candidate's tables (idempotent)
  reset(): Promise<void>; // clear candidate state between tests
  close(): Promise<void>;
  createUser(u: NewUser): Promise<void>;

  signIn(login: string, password: string, ip: string): Promise<SignIn>;
  startTotpEnrolment(challenge: string, password: string): Promise<{ secret: string }>; // base32; password re-entered
  confirmTotpEnrolment(challenge: string, code: string): Promise<{ result: SignIn; recoveryCodes: string[] }>;
  verifyTotp(challenge: string, code: string): Promise<SignIn>;
  useRecoveryCode(challenge: string, code: string): Promise<SignIn>;
  regenerateRecoveryCodes(token: string, password: string): Promise<string[]>; // re-auth required

  /** The per-request check: returns the user or null (expired, idle, revoked, disabled). */
  resolve(token: string): Promise<{ userId: string } | null>;
  signOut(token: string): Promise<void>;
  changePassword(token: string, oldPassword: string, newPassword: string): Promise<{ token: string }>;
  requestReset(login: string): Promise<{ response: unknown }>;
  confirmReset(resetToken: string, newPassword: string): Promise<boolean>;
  /** Re-authenticate for a sensitive action. Returns the (possibly rotated) session token. */
  stepUp(token: string, password: string): Promise<{ token: string }>;
  hasFreshStepUp(token: string, maxAgeSeconds: number): Promise<boolean>;
  /** Called by RBAC/admin code on role or scope change and deactivation (T-AUTH-010/011). */
  revokeUserSessions(userId: string): Promise<void>;

  // test hooks (not part of the production surface)
  test: {
    outbox: { to: string; resetToken: string }[]; // password-reset "e-mails"
    ageSession(token: string, s: { idleSeconds?: number; absoluteSeconds?: number; stepUpSeconds?: number }): Promise<void>;
    setLegacyPassword(userId: string, legacyMd5Hex: string): Promise<void>; // D-MIG-6 stand-in scheme
    storedHash(userId: string): Promise<string>;
    expireLockouts(): Promise<void>; // jump past the lockout window (T-AUTH-003)
    ageResetTokens(seconds: number): Promise<void>; // T-AUTH-008
    clearRateLimits(): Promise<void>; // tests check logic, not burst timing; throttling is scored separately
    liveSessionCount(userId: string): Promise<number>; // every live session the candidate holds (T-AUTH-020)
  };
}
