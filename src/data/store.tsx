import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useMutation, useQueries } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { CollectionMode, FundType, Role } from "@/lib/types"

/**
 * The data layer, now backed by Convex read models.
 *
 * ## Why this file no longer aggregates anything
 *
 * Milestone M1 shipped the whole database to the browser: every ledger entry,
 * contribution, payment, member and transaction, with `lib/selectors.ts` doing
 * the arithmetic. That measured **1,018,956 bytes** for nine months of demo
 * data, and extrapolates to roughly 11 MB at the eight years of real history
 * this community actually has. It also put the numbers the treasurer relies on
 * under client-side control, which is the wrong place for them.
 *
 * So aggregation moved to the server. `convex/aggregate.ts` returns computed
 * read models — totals, rates, ageing buckets, a year × month pivot — and this
 * file only subscribes to them. Each screen fetches what it draws, so opening
 * Reports no longer downloads the ledger.
 *
 * Two server-side techniques keep the queries cheap rather than merely moving
 * the cost across the network; both are documented in `convex/aggregate.ts`:
 * balances come from a materialised `balances` table, and arrears read a partial
 * `by_open` index. Neither scales with history.
 *
 * ## The mode rule
 *
 * `collectionMode` decides what a fund can do. Only `fixed_monthly` funds create
 * dues, so only they can show arrears, waivers or a collection grid. The server
 * enforces this in `convex/lib/funds.ts`; the screens here simply render what
 * the read models tell them.
 */

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  orgName: string
  orgSlug: string
  /** Funds a `fund_manager` is scoped to; null for org-wide roles. */
  fundIds: string[] | null
}

/**
 * The sidebar/header summary. Small enough to load on every screen.
 *
 * Derived from the generated function reference rather than hand-written, so
 * the sidebar cannot drift from what the server actually returns.
 */
export type Shell = NonNullable<
  Awaited<ReturnType<NonNullable<(typeof api.aggregate.shell)["_fn"]>>>
>

export interface AppActions {
  setContributionStatus: (
    contributionId: string,
    status: "due" | "paid" | "partial" | "waived",
    reason?: string,
  ) => Promise<void>
  setMonthStatus: (
    year: number,
    month: number,
    status: "due" | "paid" | "partial" | "waived",
    reason?: string,
  ) => Promise<void>
  setTransactionStatus: (
    transactionId: string,
    status: "approved" | "rejected",
    note?: string,
  ) => Promise<void>
  addFund: (input: {
    name: string
    type: FundType
    collectionMode: CollectionMode
    monthlyRupees: number
    targetRupees?: number
  }) => Promise<void>
}

interface StoreValue {
  me: CurrentUser | null
  isLoading: boolean
  error: string | null
  actions: AppActions
}

/**
 * The query set, hoisted to module scope on purpose.
 *
 * `useQueries` keys its subscription on the *identity* of the object it is
 * given, not its contents. An inline literal therefore produces a new
 * subscription on every render, each one re-subscribing and firing a callback
 * that renders again — React's "Too many re-renders" loop, which unmounted the
 * whole console before a single screen could paint. A module-level constant
 * has a stable identity, so the subscription is created once.
 *
 * Identity only. The console's org-wide summary used to be in here as a second
 * entry, which meant every signed-in visitor — including a plain member with no
 * business seeing org totals — downloaded it before any screen was chosen. It now
 * lives in `AppShell`, which only a committee member ever mounts. See
 * `requireConsole` in `convex/lib/authz.ts`.
 */
const ME_QUERIES = {
  me: { query: api.data.me, args: {} },
} as const

const StoreContext = createContext<StoreValue | null>(null)

/**
 * The one read that is always live: who you are.
 *
 * `useQueries`, not `useQuery`, and the difference is not cosmetic. `useQuery`
 * **rethrows** a server error; `useQueries` hands it back as a value. Since
 * this provider wraps the whole app in `main.tsx`, a single rethrow would take
 * the entire tree down — so a signed-out visitor, whose `data:me` correctly
 * fails with "Not signed in", would get a blank page instead of the sign-in
 * form. Catching the error here and painting it in `AuthGate` is what keeps
 * `/auth` reachable. Every screen hook in `data/queries.ts` does the same.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { me } = useQueries(ME_QUERIES)

  const isLoading = me === undefined
  const error = me instanceof Error ? me.message : null

  const mutateStatus = useMutation(api.members.setContributionStatus)
  const mutateMonth = useMutation(api.members.setMonthStatus)
  const mutateApprove = useMutation(api.transactions.approveTransaction)
  const mutateReject = useMutation(api.transactions.rejectTransaction)
  const mutateCreateFund = useMutation(api.funds.createFund)

  const actions = useMemo<AppActions>(
    () => ({
      setContributionStatus: async (contributionId, status, reason) => {
        await mutateStatus({
          contributionId: contributionId as Id<"contributions">,
          status,
          reason,
        })
      },
      setMonthStatus: async (year, month, status, reason) => {
        await mutateMonth({ year, month, status, reason })
      },
      setTransactionStatus: async (transactionId, status, note) => {
        const id = transactionId as Id<"transactions">
        if (status === "approved") {
          await mutateApprove({ transactionId: id, note })
        } else {
          await mutateReject({ transactionId: id, note })
        }
      },
      addFund: async ({ name, type, collectionMode, monthlyRupees, targetRupees }) => {
        await mutateCreateFund({
          name,
          type,
          collectionMode,
          monthlyAmountPaise: Math.round(monthlyRupees * 100),
          targetAmountPaise:
            targetRupees === undefined
              ? undefined
              : Math.round(targetRupees * 100),
        })
      },
    }),
    [mutateStatus, mutateMonth, mutateApprove, mutateReject, mutateCreateFund],
  )

  const value = useMemo<StoreValue>(
    () => ({ me: me ?? null, isLoading, error, actions }),
    [me, isLoading, error, actions],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error("useStore must be used inside <DataProvider>")
  return ctx
}

/**
 * The signed-in user. Throws if called before the query has resolved — the auth
 * gate blocks rendering until it has, so by the time a screen renders this
 * always resolves.
 */
export function useCurrentUser(): CurrentUser {
  const { me } = useStore()
  if (!me) throw new Error("useCurrentUser called before the session loaded")
  return me
}

export function useActions(): AppActions {
  return useStore().actions
}
