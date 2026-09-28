import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useQuery } from "convex/react"
import { useAuthActions } from "@convex-dev/auth/react"
import { api } from "../../../convex/_generated/api"
import {
  Banknote,
  BellRing,
  Building2,
  CalendarDays,
  CheckCircle2,
  HandCoins,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  PieChart,
  Scale,
  Settings,
  Sun,
  UserRound,
  Users,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrentUser } from "@/data/store"
import { useTheme } from "@/lib/theme"
import { FullPageLoader } from "@/components/layout/full-page-loader"
import { Button } from "@/components/ui/button"
import { formatPaiseCompact } from "@/lib/format"
import { Avatar } from "@/components/ui/avatar"
import { ErrorBoundary } from "@/components/layout/error-boundary"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"

/**
 * App shell. The sidebar palette comes from the `--sidebar-*` tokens, which is
 * why it is dark in both themes while the content area is not.
 */

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/funds", label: "Funds", icon: PieChart },
  { to: "/members", label: "Members", icon: Users },
  { to: "/contributions", label: "Contributions", icon: Banknote },
  { to: "/collection", label: "Collection", icon: CalendarDays },
  { to: "/reminders", label: "Reminders", icon: BellRing },
  { to: "/transactions", label: "Transactions", icon: Wallet },
  { to: "/approvals", label: "Approvals", icon: ListChecks, badge: "pending" },
  { to: "/payment-requests", label: "Claimed payments", icon: HandCoins, badge: "requests" },
  { to: "/banks", label: "Banks", icon: Building2 },
  { to: "/reconciliation", label: "Reconciliation", icon: Scale },
  { to: "/reports", label: "Reports", icon: CheckCircle2 },
] as const

const NAV_ADMIN = [
  { to: "/member-accounts", label: "Member accounts", icon: UserRound },
  { to: "/users", label: "Users", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const

type NavItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
  badge?: string
}

/**
 * The sidebar list, used twice: once in the desktop rail and once in the phone
 * drawer. Written once so the two cannot drift — a destination that appears on
 * a desk and not on a phone is exactly the bug that made the console
 * unusable on a phone to begin with.
 *
 * The active item is marked three ways on purpose: a saffron rail down its left
 * edge, a filled background, and bolder type. One of those is easy to miss on a
 * projector in a meeting room; together they are not.
 */
function NavList({
  items,
  badgeFor,
  onNavigate,
}: {
  items: readonly NavItem[]
  badgeFor: (badge: string) => number
  onNavigate?: () => void
}) {
  return (
    <div className="space-y-0.5">
      {items.map(({ to, label, icon: Icon, end, badge }) => {
        const count = badge ? badgeFor(badge) : 0
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-md py-2 pl-3 pr-2.5 text-sm transition-colors",
                "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:transition-colors",
                isActive
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:bg-sidebar-primary"
                  : "font-medium text-sidebar-foreground/75 before:bg-transparent hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    isActive ? "text-sidebar-primary" : "text-sidebar-foreground/60",
                  )}
                />
                <span className="flex-1 truncate">{label}</span>
                {count > 0 ? (
                  <span className="tabular rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-primary-foreground">
                    {count}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        )
      })}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
      {children}
    </p>
  )
}

export function AppShell() {
  const me = useCurrentUser()
  // The shell read model: org totals, the arrears count (fixed_monthly funds
  // only) and the pending-approval badge. Computed on the server, so this is a
  // few hundred bytes rather than the whole ledger.
  //
  // Subscribed here rather than in the app-wide `DataProvider` on purpose. It is
  // org-wide committee data, and a plain member must not receive it merely for
  // signing in — which is exactly what a provider that wrapped the whole app
  // would have done. Only this component mounts for a committee member, and the
  // server refuses the query outright for a `member` role.
  const shell = useQuery(api.aggregate.shell)
  const location = useLocation()
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()
  const { signOut } = useAuthActions()
  const [signingOut, setSigningOut] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  // Close the drawer on navigation. `onNavigate` covers the links; this covers
  // the browser back button and a swipe, which do not go through a link.
  //
  // This has to sit with the other hooks rather than below the `if (!shell)`
  // bail-out, or the hook order would depend on whether the query has resolved.
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate("/auth", { replace: true })
  }

  const isAdmin = me.role === "admin"

  // Every hook above has run; only now is it safe to bail out. Returning earlier
  // would make the hook order depend on the query, which React does not allow.
  if (!shell) return <FullPageLoader label="Loading the books" />

  const pendingCount = shell.pendingCount
  // Members claiming they have paid is a second, separate queue from transaction
  // approvals, and it is the one that ages badly: a claim sits in someone's
  // pocket until somebody acts on it. It gets its own badge rather than being
  // folded into the approvals count, because the two are confirmed by different
  // people in different ways.
  const requestCount = shell.paymentRequestCount
  const badgeFor = (badge: string) =>
    badge === "pending" ? pendingCount : badge === "requests" ? requestCount : 0

  const sidebarBody = (onNavigate?: () => void) => (
    <>
      <nav className="cf-scroll flex-1 overflow-y-auto px-3 py-2">
        <NavList items={NAV} badgeFor={badgeFor} onNavigate={onNavigate} />
        {isAdmin ? (
          <>
            <SectionLabel>Administration</SectionLabel>
            <NavList items={NAV_ADMIN} badgeFor={badgeFor} onNavigate={onNavigate} />
          </>
        ) : null}
      </nav>

      <div className="space-y-3 border-t border-sidebar-border p-3">
        <div className="rounded-lg bg-sidebar-accent/60 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-sidebar-foreground/55">
            Total across funds
          </p>
          <p className="tabular text-lg font-semibold text-sidebar-foreground">
            {formatPaiseCompact(shell.totalBalance)}
          </p>
          <p className="text-[11px] text-sidebar-foreground/55">
            {shell.memberCount} members · {shell.funds.length} funds
          </p>
          {/*
            The arrears count used to live in the phone header, which is where a
            treasurer used to see it. The header is now the menu, the app name
            and the two buttons, so it has moved into the drawer next to the
            other totals rather than being dropped.
          */}
          <p
            className={cn(
              "mt-1.5 border-t border-sidebar-border/60 pt-1.5 text-[11px]",
              shell.arrearsCount > 0
                ? "text-sidebar-primary"
                : "text-sidebar-foreground/55",
            )}
          >
            <span className="tabular">{shell.arrearsCount} in arrears</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <Avatar
            name={me.name}
            className="size-8 bg-sidebar-accent text-xs text-sidebar-accent-foreground"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium text-sidebar-foreground">
              {me.name}
            </p>
            <p className="truncate text-[11px] capitalize text-sidebar-foreground/55">
              {me.role.replace("_", " ")} · {me.orgName}
            </p>
          </div>
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </>
  )

  const brand = (
    <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
        CF
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-sidebar-foreground">
          CommunityFund
        </p>
        <p className="text-[11px] text-sidebar-foreground/60">
          Jamaat fund management
        </p>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar. The only one in the document — the phone drawer below is a
          `nav`, not an `aside`, so a query for the first `aside` still finds
          this and not the drawer. */}
      <aside className="cf-chrome sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {brand}
        {sidebarBody()}
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header. The menu button is new and load-bearing: without it
            this header offered the theme and the way out, and no way in. */}
        <header className="cf-chrome sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent aria-label="Console">
              {brand}
              {sidebarBody(() => setNavOpen(false))}
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">CommunityFund</p>
          </div>

          <button
            onClick={toggle}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8" key={location.pathname}>
          <div className="mx-auto w-full max-w-7xl space-y-6">
            {/*
              A screen's read model can fail — a fund id that no longer resolves,
              a year with nothing in it. Convex's `useQuery` rethrows, so without
              this the failure would take the sidebar and the header with it.
            */}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
