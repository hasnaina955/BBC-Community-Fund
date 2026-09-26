import { convexAuth } from "@convex-dev/auth/server"
import { Password } from "@convex-dev/auth/providers/Password"
import {
  hashSecret,
  validatePasswordRequirements,
  verifySecret,
} from "./lib/password"

/**
 * Convex Auth configured with email + password.
 *
 * Passwords are hashed with PBKDF2-SHA256 (see lib/password.ts) rather than
 * the provider's default, so the format is explicit and the demo seeder can
 * generate compatible hashes with the same helper.
 *
 * Email matching: the provider looks accounts up by the exact email string, so
 * emails are stored and submitted lowercased and trimmed. The sign-in form
 * normalises before calling `signIn`, and the seeder stores lowercase. Adding
 * case-insensitive matching properly would mean a `profile` hook here.
 *
 * Email verification is deliberately not enabled: it needs an email provider,
 * and milestone M1 has no outbound email. The provider rate-limits sign-in
 * attempts on its own. See docs/INTEGRATIONS.md -> Identity.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      crypto: { hashSecret, verifySecret },
      validatePasswordRequirements,
    }),
  ],
})
