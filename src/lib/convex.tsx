import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

/**
 * Convex client.
 *
 * The URL comes from `VITE_CONVEX_URL` in the workspace environment. There is
 * no silent fallback to a made-up deployment: if the variable is missing the app
 * fails loudly.
 *
 * ## One exception, and why it exists
 *
 * A local Convex backend listens on loopback. A browser can only reach loopback
 * from a page that is *itself* on loopback. Open the same app through the hosted
 * preview proxy — or from another machine on the network — and the page's origin
 * is public, the deployment URL is `127.0.0.1`, and the browser refuses the
 * connection: Chrome's local-network access checks block it outright, and where
 * they do not, the socket simply never opens. The visible symptom is the app
 * hanging on the sign-in button forever, because `signIn()` waits on a client
 * whose socket is not connected. No error is shown, because nothing failed — it
 * simply never started.
 *
 * So when the page is not on loopback, the client is pointed at `/__convex` on
 * the page's own origin, which the Vite dev server proxies to the backend
 * (`server.proxy` in `vite.config.ts`, websockets included). Same-origin traffic
 * is never subject to local-network restrictions, so the app behaves the same
 * however it was opened, and nothing about a real cloud deployment changes:
 * set `VITE_CONVEX_URL` to that deployment's URL and it is used directly.
 */

const configured = import.meta.env.VITE_CONVEX_URL

if (!configured) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Add it to .env.local — see README -> Running it.",
  )
}

const isLoopback =
  typeof window !== "undefined" &&
  ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname)

/**
 * A loopback deployment reached from a non-loopback page has to come through
 * the dev proxy; anything else is used as configured.
 */
const url =
  !isLoopback && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(configured)
    ? `${window.location.origin}/__convex`
    : configured

export const convex = new ConvexReactClient(url)

export function ConvexProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
}
