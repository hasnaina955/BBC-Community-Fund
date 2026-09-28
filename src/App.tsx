import { Suspense, lazy } from "react"
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useConvexAuth } from "@convex-dev/auth/react"
import { AppShell } from "@/components/layout/app-shell"
import { AuthGate } from "@/components/layout/auth-gate"
import { FullPageLoader } from "@/components/layout/full-page-loader"
import { PortalShell } from "@/components/portal/portal-shell"
import { ReadModelLoader } from "@/components/shared/read-model"
import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/data/store"
import Auth from "@/routes/auth"

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
 *
 * ## Why the screens are lazy and the shells are not
 *
 * Before this, the whole application shipped as one 933 kB chunk (267 kB
 * gzipped) and the build was already warning about it. The uncomfortable part is
 * who pays for that: `recharts` is a quarter of it, and it is only used by four
 * console screens — the dashboard, fund detail, reports, and the collection
 * grid. **A member opening the portal to read their own balance downloaded the
 * entire charting library to see four numbers.**
 *
 * `React.lazy` on the screens splits it without touching the router: a member
 * now loads the portal and the console, and nothing else. The two shells and
 * `/auth` stay eager because they are the first thing every single visitor
 * needs, and a lazy shell would mean a spinner where the app should already be.
 *
 * The `Suspense` fallback is `ReadModelLoader` rather than a bare spinner, and
 * that is deliberate for a second reason: it carries the `animate-spin` class
 * the visual harnesses poll for. A fallback without it would make every
 * assertion in the suite race the chunk download.
 */

const Dashboard = lazy(() => import("@/routes/dashboard"))
const Funds = lazy(() => import("@/routes/funds"))
const FundDetail = lazy(() => import("@/routes/fund-detail"))
const Members = lazy(() => import("@/routes/members"))
const Contributions = lazy(() => import("@/routes/contributions"))
const Collection = lazy(() => import("@/routes/collection"))
const Reminders = lazy(() => import("@/routes/reminders"))
const Transactions = lazy(() => import("@/routes/transactions"))
const Approvals = lazy(() => import("@/routes/approvals"))
const Banks = lazy(() => import("@/routes/banks"))
const Reconciliation = lazy(() => import("@/routes/reconciliation"))
const Reports = lazy(() => import("@/routes/reports"))
const Settings = lazy(() => import("@/routes/settings"))
const Users = lazy(() => import("@/routes/users"))
const MemberAccounts = lazy(() => import("@/routes/member-accounts"))
const PaymentRequests = lazy(() => import("@/routes/payment-requests"))
const PortalHome = lazy(() => import("@/routes/portal/portal-home"))
const PortalReceipts = lazy(() => import("@/routes/portal/portal-receipts"))
// This module has two exports and only one of them is a route element.
const PortalReceipt = lazy(() =>
  import("@/routes/portal/portal-receipts").then((m) => ({ default: m.PortalReceipt })),
)
const PortalStatement = lazy(() => import("@/routes/portal/portal-statement"))
const PortalRequests = lazy(() => import("@/routes/portal/portal-requests"))
const PortalAccount = lazy(() => import("@/routes/portal/portal-account"))

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
      <p className="tabular text-5xl font-semibold tracking-tight text-muted-foreground">
        404
      </p>
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
    <Suspense fallback={<ReadModelLoader label="Loading" />}>
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
          <Route path="collection" element={<Collection />} />
          <Route path="reminders" element={<Reminders />} />
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
    </Suspense>
  )
}
