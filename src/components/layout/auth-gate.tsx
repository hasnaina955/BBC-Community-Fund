import type { ReactNode } from "react"
import { useConvexAuth } from "@convex-dev/auth/react"
import { AlertCircle } from "lucide-react"
import { useStore } from "@/data/store"
import { FullPageLoader } from "@/components/layout/full-page-loader"

/**
 * Gates the console on two things, in order:
 *
 *   1. Authentication, via Convex Auth.
 *   2. Identity and shell readiness. `useCurrentUser()` throws if the `me` query
 *      has not resolved, so the shell must not mount screens early.
 *
 * Per-screen read models load after this point and each screen shows its own
 * loader — see `components/shared/read-model.tsx`.
 *
 * Routing itself happens in `App.tsx`; this component only decides whether the
 * console is allowed to paint.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth()
  const { isLoading: dataLoading, error } = useStore()

  if (authLoading) return <FullPageLoader label="Checking your session" />

  if (!isAuthenticated) {
    // App.tsx will have redirected already; this is a safety net for the frame
    // between the two.
    return <FullPageLoader label="Redirecting to sign in" />
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertCircle className="mx-auto size-6 text-destructive" />
          <p className="font-medium">Could not load your data</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground">
            This usually means the account is not attached to an organisation.
          </p>
        </div>
      </div>
    )
  }

  if (dataLoading) return <FullPageLoader label="Loading the books" />

  return <>{children}</>
}
