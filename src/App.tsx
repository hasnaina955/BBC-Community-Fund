import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useConvexAuth } from "@convex-dev/auth/react"
import { AppShell } from "@/components/layout/app-shell"
import { AuthGate } from "@/components/layout/auth-gate"
import { FullPageLoader } from "@/components/layout/full-page-loader"
import { Button } from "@/components/ui/button"
import Auth from "@/routes/auth"
import Dashboard from "@/routes/dashboard"
import Funds from "@/routes/funds"
import FundDetail from "@/routes/fund-detail"
import Members from "@/routes/members"
import Contributions from "@/routes/contributions"
import Transactions from "@/routes/transactions"
import Approvals from "@/routes/approvals"
import Banks from "@/routes/banks"
import Reconciliation from "@/routes/reconciliation"
import Reports from "@/routes/reports"
import Settings from "@/routes/settings"
import Users from "@/routes/users"

/**
 * The route table is the one recovered from the original build, plus `/auth`.
 *
 * Auth gating preserves the intended destination: a signed-out user heading to
 * `/contributions` is sent to `/auth?returnTo=/contributions` and lands back
 * there after signing in, rather than on the dashboard.
 *
 * `AppShell` is a layout route at `/` and every screen is a *relative* child of
 * it, with the dashboard as the `index` route. That structure is not cosmetic:
 * React Router 6 throws `Absolute route path "/" nested under path "*" is not
 * valid` if a splat parent is given absolute children, and it throws during
 * render — so the whole console, sign-in form included, came up blank. Child
 * paths here must therefore never start with a slash.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const location = useLocation()

  if (isLoading) return <FullPageLoader label="Checking your session" />

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  return <AuthGate>{children}</AuthGate>
}

/**
 * Unknown URL. The original build had one, and without it a mistyped path
 * renders an empty page — indistinguishable from the blank-screen bug above.
 */
function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-4xl font-semibold text-muted-foreground">404</p>
      <p className="font-medium">That page does not exist</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be out of date. Everything in the console is in the
        sidebar.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to the dashboard</Link>
      </Button>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="funds" element={<Funds />} />
        <Route path="funds/:id" element={<FundDetail />} />
        <Route path="members" element={<Members />} />
        <Route path="contributions" element={<Contributions />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="banks" element={<Banks />} />
        <Route path="reconciliation" element={<Reconciliation />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="users" element={<Users />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
