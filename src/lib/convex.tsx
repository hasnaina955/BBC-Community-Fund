import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

/**
 * Convex client.
 *
 * The URL comes from `VITE_CONVEX_URL` in the workspace environment. There is
 * no fallback: if the variable is missing the app must fail loudly rather than
 * silently pointing at a made-up deployment.
 */
const url = import.meta.env.VITE_CONVEX_URL

if (!url) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Add it to .env.local — see README -> Running it.",
  )
}

export const convex = new ConvexReactClient(url)

export function ConvexProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
}
