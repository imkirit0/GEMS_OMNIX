// The contract the T-AUTH suite runs against (from the ADR-001 bake-off): the production auth API plus test hooks.
import type { SignIn } from "../../src/server/auth/policy";

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
