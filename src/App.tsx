import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useConvexAuth } from "@convex-dev/auth/react"
import { AppShell } from "@/components/layout/app-shell"
import { AuthGate } from "@/components/layout/auth-gate"
import { FullPageLoader } from "@/components/layout/full-page-loader"
import { PortalShell } from "@/components/portal/portal-shell"
import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/data/store"
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
import MemberAccounts from "@/routes/member-accounts"
import PaymentRequests from "@/routes/payment-requests"
import PortalHome from "@/routes/portal/portal-home"
import PortalReceipts, { PortalReceipt } from "@/routes/portal/portal-receipts"
import PortalStatement from "@/routes/portal/portal-statement"
import PortalRequests from "@/routes/portal/portal-requests"
import PortalAccount from "@/routes/portal/portal-account"

/**
 * The route table: the recovered console, `/auth`, and the member portal.
 *
 * Auth gating preserves the intended destination: a signed-out user heading to
 * `/me/statement` is sent to `/auth?returnTo=/me/statement` and lands back there
 * after signing in, rather than on the dashboard.
 *
 * `AppShell` is a layout route at `/` and every screen is a *relative* child of
 * it, with the dashboard as the `index` route. That structure is not cosmetic:
 * React Router 6 throws `Absolute route path "/" nested under path "*" is not
 * valid` if a splat parent is given absolute children, and it throws during
 * render — so the whole console, sign-in form included, came up blank. Child
 * paths here must therefore never start with a slash.
 *
 * ## Two applications, one session
 *
 * M3 introduced the `member` role, which is the first role in this system that is
 * signed in but is *not* on the committee. It needs a different application, not
 * a reduced one — a member has no use for a sidebar of nine destinations, and the
 * console is a desk tool. So there are two shells and one router:
 *
 *   - `/` and its children are the console. `ConsoleGate` turns a member away
 *     from all of it, before the sidebar ever renders, so a member following an
 *     old link lands in their own portal rather than on a screen full of figures
 *     about other people.
 *   - `/me` and its children are the portal, which a committee member can also
 *     open — a treasurer checking what their own record looks like is a real
 *     thing to want.
 *
 * The server enforces both boundaries independently (`requireConsole` versus the
 * portal's session-scoped reads). This routing is the courtesy version, so that
 * nobody is shown a screen that is going to refuse them.
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
 * The console, for the committee.
 *
 * A member is redirected to their portal rather than shown a refusal. Both
 * outcomes are correct — the server would have thrown either way — but a member
 * who followed a link from a treasurer and landed on an error page would conclude
 * the app was broken, and would be right about the link even if wrong about the
 * app.
 */
function ConsoleGate() {
  const me = useCurrentUser()
  if (me.role === "member") return <Navigate to="/me" replace />
  return <AppShell />
}

/** The portal, which committee members may also open. */
function PortalGate() {
  return <PortalShell />
}

/**
 * Unknown URL. The original build had one, and without it a mistyped path
 * renders an empty page — indistinguishable from the blank-screen bug above.
 */
function NotFound() {
  const me = useCurrentUser()
  const isMember = me.role === "member"

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-4xl font-semibold text-muted-foreground">404</p>
      <p className="font-medium">That page does not exist</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {isMember
          ? "The link may be out of date. Your balance, receipts and statement are on the tabs below."
          : "The link may be out of date. Everything in the console is in the sidebar."}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to={isMember ? "/me" : "/"}>
          {isMember ? "Back to your balance" : "Back to the dashboard"}
        </Link>
      </Button>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />

      {/* The member portal. Its own shell, its own routes, reachable by anyone
          signed in — a treasurer checking their own record is welcome here too. */}
      <Route
        path="/me"
        element={
          <RequireAuth>
            <PortalGate />
          </RequireAuth>
        }
      >
        <Route index element={<PortalHome />} />
        <Route path="receipts" element={<PortalReceipts />} />
        <Route path="receipts/:id" element={<PortalReceipt />} />
        <Route path="statement" element={<PortalStatement />} />
        <Route path="requests" element={<PortalRequests />} />
        <Route path="account" element={<PortalAccount />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route
        path="/"
        element={
          <RequireAuth>
            <ConsoleGate />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="funds" element={<Funds />} />
        <Route path="funds/:id" element={<FundDetail />} />
        <Route path="members" element={<Members />} />
        <Route path="member-accounts" element={<MemberAccounts />} />
        <Route path="contributions" element={<Contributions />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="payment-requests" element={<PaymentRequests />} />
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
