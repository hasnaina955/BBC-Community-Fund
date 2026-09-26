/**
 * Convex Auth application config.
 *
 * `applicationID` must be "convex": it is the `aud` claim Convex Auth puts in
 * every JWT, and the query layer refuses a token whose audience does not match
 * a configured provider. Naming it anything else (e.g. "communityfund") makes
 * every authenticated query fail with `NoAuthProvider`.
 *
 * `CONVEX_AUTH_DOMAIN` is the origin auth anchors cookies and post-sign-in
 * redirects to. It is not a secret, but it must match the issuer Convex puts in
 * the token. Locally the issuer is the Convex *site* port:
 *
 *   bunx convex env set CONVEX_AUTH_DOMAIN http://127.0.0.1:3211
 *
 * For a cloud deployment set it to that deployment's site URL.
 *
 * See docs/INTEGRATIONS.md -> Identity.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_AUTH_DOMAIN,
      applicationID: "convex",
    },
  ],
}
