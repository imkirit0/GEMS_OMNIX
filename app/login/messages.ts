// One place for user-facing auth messages. Never reveal whether an account exists.
export const MESSAGES: Record<string, string> = {
  invalid: "Invalid login or password.",
  locked: "Too many attempts. Try again later.",
  rate: "Too many attempts from this network. Try again later.",
  expired: "That step expired. Please sign in again.",
  code: "Code not accepted.",
  password: "Password not accepted.",
  short: "The password is too short.",
};
