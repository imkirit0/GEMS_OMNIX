import { betterAuth } from "better-auth";
import { twoFactor, username } from "better-auth/plugins";
import { memoryAdapter } from "better-auth/adapters/memory";
const auth = betterAuth({ database: memoryAdapter({}), secret: "x".repeat(40), baseURL: "http://localhost:3000",
  emailAndPassword: { enabled: true }, plugins: [username(), twoFactor()], telemetry: { enabled: false } });
console.log(Object.keys(auth.api).sort().join(" "));
