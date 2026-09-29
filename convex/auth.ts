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
 * normalises before calling `signIn`, and the seeder stores lowercase. A
 * `profile` hook below now normalises on the server side too, so the guarantee
 * does not depend on every caller remembering.
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
      /**
       * The provider's default profile stores the email and nothing else, so a
       * signup would have produced an account with no name — and the console
       * header, the audit log and the users screen all show one. This hook is
       * the only place it can come from, since the `users` row is written by the
       * auth library before any of our own code runs.
       *
       * It also normalises the email here, which closes the caveat in the note
       * above: the provider looks accounts up by whatever this returns, so
       * lowercasing on both the creating and the finding side makes matching
       * case-insensitive without the sign-in form having to be the only thing
       * that remembers to do it.
       *
       * It returns no `orgId` and no `role`. The organisation is created
       * afterwards, by `orgs.createOrganization`, which is the whole reason
       * signup and onboarding are two screens: at this instant there is no
       * community to belong to and nobody to be on the committee of.
       */
      profile: (params) => {
        const name =
          typeof params.name === "string" ? params.name.trim() : ""
        return {
          email: String(params.email ?? "").trim().toLowerCase(),
          // Omitted rather than set to `undefined`: the index signature is
          // `Value`, which has no `undefined`, and an empty string is what the
          // schema's optional `name` means everywhere else.
          ...(name ? { name } : {}),
        }
      },
    }),
  ],
})
