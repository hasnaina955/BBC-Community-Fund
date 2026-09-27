import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useState } from "react"
import { useAuthActions } from "@convex-dev/auth/react"
import {
  BookOpen,
  Home,
  LogOut,
  Moon,
  Receipt,
  Send,
  Sun,
  UserRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrentUser } from "@/data/store"
import { useTheme } from "@/lib/theme"
import { ErrorBoundary } from "@/components/layout/error-boundary"
import { Button } from "@/components/ui/button"

/**
 * The member portal's layout. Deliberately not the console's.
 *
 * The console is a desk: a wide sidebar, nine destinations, dense tables. This is
 * a phone held in one hand at the collection table, and it is built the other way
 * round — a single column, four destinations on a bottom bar that a thumb can
 * reach, and generous tap targets. The difference is not cosmetic: the two are
 * used by people with entirely different relationships to the software, one of
 * whom will use it roughly twice a year.
 *
 * The bottom bar rather than a top nav because on a tall phone the bottom of the
 * screen is the reachable part, and a member who cannot find "my receipts" will
 * not ask for them twice.
 */

const TABS: ReadonlyArray<{
  to: string
  label: string
  icon: typeof Home
  end?: boolean
}> = [
  { to: "/me", label: "Balance", icon: Home, end: true },
  { to: "/me/receipts", label: "Receipts", icon: Receipt },
  { to: "/me/statement", label: "Statement", icon: BookOpen },
  { to: "/me/account", label: "Account", icon: UserRound },
]

/**
 * The theme now comes from `@/lib/theme`. This shell used to keep its own copy
 * that toggled the class but never wrote it to `localStorage`, so a member who
 * chose dark mode in their portal and reloaded the page got light mode back.
 * The console shell's copy did persist, which is why nobody noticed: a member
 * is never shown the console, so the working half of the pair is the half they
 * never load.
 */
export function PortalShell() {
  const me = useCurrentUser()
  const { dark, toggle } = useTheme()
  const { signOut } = useAuthActions()
  const navigate = useNavigate()
  const location = useLocation()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate("/auth", { replace: true })
  }

  // Committee staff are signed into the same app, so the portal has to be able to
  // hand them back. A member has no console to go to and is never offered one.
  const isStaff = me.role !== "member"

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="cf-chrome sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-3 px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            CF
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{me.orgName}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {me.name}
            </p>
          </div>
          <button
            onClick={toggle}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {/*
        `pb-24` clears the fixed tab bar. Without it the last row of a long
        statement sits underneath the bar, which on a receipt list is exactly the
        receipt somebody wanted to tap.
      */}
      <main
        className="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-4 print:px-0 print:pb-0"
        key={location.pathname}
      >
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav className="cf-chrome fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid w-full max-w-lg grid-cols-4">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors",
                  // The active tab is marked with a saffron tab above the label
                  // as well as by colour. On a cheap phone in daylight, a hue
                  // change on a small label is the single least reliable signal
                  // on the screen.
                  "before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:transition-colors",
                  isActive
                    ? "font-semibold text-foreground before:bg-primary"
                    : "font-medium text-muted-foreground before:bg-transparent",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      "size-5 transition-colors",
                      isActive ? "stroke-[2.25] text-primary" : "text-muted-foreground",
                    )}
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {isStaff ? (
        <div className="cf-chrome border-t border-border/60 px-4 py-3">
          <div className="mx-auto w-full max-w-lg">
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/">
                <Send className="size-4" />
                Committee console
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** The header line on a portal screen: a title, and optionally a way back. */
export function PortalHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
