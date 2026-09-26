import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useMutation, useQueries } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AuditEntry,
  Bank,
  Contribution,
  Fund,
  LedgerEntry,
  Member,
  Payment,
  Transaction,
  User,
} from "@/lib/types"

/**
 * The data layer, now backed by Convex.
 *
 * Milestone M0 assembled the same shape from local seed arrays. The hook
 * contract is deliberately unchanged — `useData()` and `useActions()` — so the
 * ten screens needed no edits, and the pure selectors in `lib/selectors.ts`
 * are unchanged too, because they are pure functions of the data.
 *
 * Reads are reactive: a mutation on the server re-renders every screen that
 * derives from it, with no cache invalidation anywhere in this file.
 *
 * Note: aggregation still happens in the client via `lib/selectors.ts`, exactly
 * as in M0. Pushing the dashboard and reporting aggregates server-side is M2
 * work, once the query patterns are known.
 */

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: User["role"]
  isActive: boolean
  orgName: string
  orgSlug: string
}

export interface AppData {
  banks: Bank[]
  funds: Fund[]
  members: Member[]
  users: User[]
  contributions: Contribution[]
  payments: Payment[]
  ledgerEntries: LedgerEntry[]
  transactions: Transaction[]
  auditLog: AuditEntry[]
  currentUser: CurrentUser
}

export interface AppActions {
  setContributionStatus: (
    contributionId: string,
    status: Contribution["status"],
    reason?: string,
  ) => Promise<void>
  setMonthStatus: (
    year: number,
    month: number,
    status: Contribution["status"],
    reason?: string,
  ) => Promise<void>
  setTransactionStatus: (
    transactionId: string,
    status: "approved" | "rejected",
    note?: string,
  ) => Promise<void>
  addFund: (input: {
    name: string
    type: Fund["type"]
    monthlyRupees: number
  }) => Promise<void>
}

interface StoreValue {
  data: AppData | null
  actions: AppActions
  isLoading: boolean
  error: string | null
}

const StoreContext = createContext<StoreValue | null>(null)

/**
 * The ten reads behind `useData()`.
 *
 * They run unconditionally. Unauthenticated they fail server-side, which is
 * harmless: the router has already sent the user to /auth, so the error state
 * below is never painted. Gating them on auth would mean re-subscribing to all
 * ten the moment a session appears.
 */
const QUERIES = {
  me: { query: api.data.me, args: {} },
  banks: { query: api.data.listBanks, args: {} },
  funds: { query: api.data.listFunds, args: {} },
  members: { query: api.data.listMembers, args: { includeInactive: true } },
  users: { query: api.data.listUsers, args: {} },
  contributions: { query: api.data.listContributions, args: {} },
  payments: { query: api.data.listPayments, args: {} },
  ledger: { query: api.data.listLedgerEntries, args: {} },
  transactions: { query: api.data.listTransactions, args: {} },
  audit: { query: api.data.listAuditLog, args: { limit: 50 } },
} as const

export function DataProvider({ children }: { children: ReactNode }) {
  const results = useQueries(QUERIES)

  const {
    me,
    banks,
    funds,
    members,
    users,
    contributions,
    payments,
    ledger,
    transactions,
    audit,
  } = results

  const values = Object.values(results)
  const isLoading = values.some((r) => r === undefined)
  const firstError = values.find((r) => r instanceof Error)
  const error = firstError instanceof Error ? firstError.message : null

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
      addFund: async ({ name, type, monthlyRupees }) => {
        await mutateCreateFund({
          name,
          type,
          monthlyAmountPaise: Math.round(monthlyRupees * 100),
        })
      },
    }),
    [mutateStatus, mutateMonth, mutateApprove, mutateReject, mutateCreateFund],
  )

  const data = useMemo<AppData | null>(() => {
    if (
      !me ||
      !banks ||
      !funds ||
      !members ||
      !users ||
      !contributions ||
      !payments ||
      !ledger ||
      !transactions ||
      !audit
    ) {
      return null
    }
    return {
      banks: banks as Bank[],
      funds: funds as Fund[],
      members: members as Member[],
      users: users as User[],
      contributions: contributions as Contribution[],
      payments: payments as Payment[],
      ledgerEntries: ledger as LedgerEntry[],
      transactions: transactions as Transaction[],
      auditLog: audit as AuditEntry[],
      currentUser: me as CurrentUser,
    }
  }, [
    me,
    banks,
    funds,
    members,
    users,
    contributions,
    payments,
    ledger,
    transactions,
    audit,
  ])

  const value = useMemo<StoreValue>(
    () => ({ data, actions, isLoading, error }),
    [data, actions, isLoading, error],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error("useStore must be used inside <DataProvider>")
  return ctx
}

/**
 * Data for a screen. Throws if called before the data has arrived — the app
 * shell gates rendering on readiness, so by the time a screen renders this
 * always resolves.
 */
export function useData(): AppData {
  const { data } = useStore()
  if (!data) throw new Error("useData called before data was loaded")
  return data
}

export function useActions(): AppActions {
  return useStore().actions
}
