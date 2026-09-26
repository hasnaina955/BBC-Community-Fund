import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useConvexAuth } from "@convex-dev/auth/react"
import { AppShell } from "@/components/layout/app-shell"
import { AuthGate } from "@/components/layout/auth-gate"
import { FullPageLoader } from "@/components/layout/full-page-loader"
import Auth from "@/routes/auth"
import Dashboard from "@/routes/dashboard"
import Funds from "@/routes/funds"
import FundDetail from "@/routes/fund-detail"
import Members from "@/routes/members"
import Contributions from "@/routes/contributions"
import Transactions from "@/routes/transactions"
import Approvals from "@/routes/approvals"
import Banks from "@/routes/banks"
import Reports from "@/routes/reports"
import Settings from "@/routes/settings"
import Users from "@/routes/users"

/**
 * The route table is the one recovered from the original build, plus `/auth`.
 *
 * Auth gating preserves the intended destination: a signed-out user heading to
 * `/contributions` is sent to `/auth?returnTo=/contributions` and lands back
 * there after signing in, rather than on the dashboard.
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

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/funds" element={<Funds />} />
        <Route path="/funds/:id" element={<FundDetail />} />
        <Route path="/members" element={<Members />} />
        <Route path="/contributions" element={<Contributions />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/banks" element={<Banks />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<Users />} />
      </Route>
    </Routes>
  )
}
