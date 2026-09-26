import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useAuthActions } from "@convex-dev/auth/react"
import {
  Banknote,
  Building2,
  CheckCircle2,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  PieChart,
  Settings,
  Sun,
  Users,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useData } from "@/data/store"
import { collectionStats, defaulters, fundSummaries } from "@/lib/selectors"
import { CURRENT_MONTH, CURRENT_YEAR, MONTHS_ELAPSED } from "@/data/period"
import { Button } from "@/components/ui/button"
import { formatPaiseCompact } from "@/lib/format"
import { Avatar } from "@/components/ui/avatar"

/**
 * App shell. The sidebar palette comes from the recovered `--sidebar-*` tokens,
 * which is why it is dark in both themes while the content area is not.
 */

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/funds", label: "Funds", icon: PieChart },
  { to: "/members", label: "Members", icon: Users },
  { to: "/contributions", label: "Contributions", icon: Banknote },
  { to: "/transactions", label: "Transactions", icon: Wallet },
  { to: "/approvals", label: "Approvals", icon: ListChecks, badge: "pending" },
  { to: "/banks", label: "Banks", icon: Building2 },
  { to: "/reports", label: "Reports", icon: CheckCircle2 },
] as const

const NAV_ADMIN = [
  { to: "/users", label: "Users", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const

function useTheme() {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains("dark"),
  )
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try {
      localStorage.setItem("cf-theme", dark ? "dark" : "light")
    } catch {
      // Private browsing — the theme just will not persist.
    }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export function AppShell() {
  const data = useData()
  const location = useLocation()
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()
  const { signOut } = useAuthActions()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate("/auth", { replace: true })
  }

  const isAdmin = data.currentUser.role === "admin"
  const pendingCount = data.transactions.filter(
    (t) => t.status === "pending",
  ).length

  const stats = collectionStats(data.contributions, CURRENT_YEAR, CURRENT_MONTH)
  const defaulterCount = defaulters(
    data.contributions,
    data.members,
    CURRENT_YEAR,
    MONTHS_ELAPSED,
  ).length
  const totalBalance = fundSummaries(data.ledgerEntries, data.funds).reduce(
    (acc, f) => acc + f.balancePaise,
    0,
  )

  const renderNav = (
    items: readonly {
      to: string
      label: string
      icon: typeof LayoutDashboard
      end?: boolean
      badge?: string
    }[],
  ) =>
    items.map(({ to, label, icon: Icon, end, badge }) => {
      const count = badge === "pending" ? pendingCount : 0
      return (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {count > 0 ? (
                <span className="tabular rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-primary-foreground">
                  {count}
                </span>
              ) : null}
              {isActive ? (
                <ChevronRight className="size-3.5 opacity-60" />
              ) : null}
            </>
          )}
        </NavLink>
      )
    })

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
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

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {renderNav(NAV)}
          {isAdmin ? (
            <>
              <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                Administration
              </p>
              {renderNav(NAV_ADMIN)}
            </>
          ) : null}
        </nav>

        <div className="space-y-3 border-t border-sidebar-border p-3">
          <div className="rounded-lg bg-sidebar-accent/60 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-sidebar-foreground/55">
              Total across funds
            </p>
            <p className="tabular text-lg font-semibold text-sidebar-foreground">
              {formatPaiseCompact(totalBalance)}
            </p>
            <p className="text-[11px] text-sidebar-foreground/55">
              {stats.collectionRate.toFixed(0)}% collected this month
            </p>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <Avatar
              name={data.currentUser.name}
              className="size-8 bg-sidebar-accent text-xs text-sidebar-accent-foreground"
            />
            <div className="min-w-0 flex-1 leading-tight">                <p className="truncate text-xs font-medium text-sidebar-foreground">
                  {data.currentUser.name}
                </p>
                <p className="truncate text-[11px] capitalize text-sidebar-foreground/55">
                  {data.currentUser.role.replace("_", " ")} ·{" "}
                  {data.currentUser.orgName}
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
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            CF
          </div>
          <p className="text-sm font-semibold">CommunityFund</p>
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular hidden text-xs text-muted-foreground sm:inline">
              {defaulterCount} in arrears
            </span>
            <button
              onClick={toggle}
              className="rounded-md border p-1.5"
              aria-label="Toggle theme"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8" key={location.pathname}>
          <div className="mx-auto w-full max-w-7xl space-y-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
