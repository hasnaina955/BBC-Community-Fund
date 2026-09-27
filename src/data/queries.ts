import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { yearsInRange } from "@/data/period"

/**
 * One hook per screen, one Convex query per hook.
 *
 * Each of these is a *read model*: the server has already done the arithmetic
 * and sends back numbers, not rows. That is the whole point of moving
 * aggregation into `convex/aggregate.ts` — the alternative was every screen
 * downloading the ledger in order to count it.
 *
 * ## Errors
 *
 * `useQuery` rethrows a server error, which is normally what you want. Here a
 * screen query can fail for ordinary reasons — a fund id that no longer
 * resolves, a year with nothing in it — and the right response is to explain
 * that on the screen, not to unmount the app. So a read model has no error
 * field of its own; `ErrorBoundary` in the app shell catches the rethrow and
 * renders the failure in place of the screen. See
 * `components/layout/error-boundary.tsx`.
 *
 * The always-on shell queries in `data/store.tsx` are the exception: they run
 * before any boundary exists, so they use `useQueries`, which returns errors
 * instead of throwing. Getting that backwards is what makes a signed-out
 * visitor see a blank page instead of the sign-in form.
 *
 * The `skip` token is Convex's way of not running a query whose arguments are
 * not known yet (a fund id from the URL, a bank the user has not clicked). It
 * must be a stable string, which is why these hooks derive it from a boolean
 * rather than from the value itself.
 */

/* -------------------------------------------------------------- dashboard */

export function useDashboard() {
  return useQuery(api.aggregate.dashboard)
}

/* ------------------------------------------------------------------ funds */

export function useFunds() {
  return useQuery(api.aggregate.funds)
}

export function useFundDetail(fundId: string | undefined) {
  return useQuery(
    api.aggregate.fundDetail,
    fundId ? { fundId: fundId as Id<"funds"> } : "skip",
  )
}

/* ------------------------------------------------------------------ banks */

export function useBanks() {
  return useQuery(api.aggregate.banks)
}

export function useBankPassbook(bankId: string | null, year: number) {
  return useQuery(
    api.aggregate.bankPassbook,
    bankId ? { bankId: bankId as Id<"banks">, year, limit: 40 } : "skip",
  )
}

/* --------------------------------------------------------- reconciliation */

/**
 * Every account with its last filed statement, plus the close watermark.
 *
 * One query for the whole screen rather than one per account, because the screen
 * always draws all of them — N subscriptions would be N round trips for a screen
 * the treasurer opens once a month.
 */
export function useReconciliation() {
  return useQuery(api.reconciliation.status)
}

/* ---------------------------------------------------------------- members */

export type MemberFilter = "all" | "active" | "inactive" | "arrears" | "clear"

export function useMembers(filter: MemberFilter) {
  return useQuery(api.aggregate.members, { filter })
}

export function useMemberPassbook(memberId: string | null) {
  return useQuery(
    api.aggregate.memberPassbook,
    memberId ? { memberId: memberId as Id<"members"> } : "skip",
  )
}

/* ------------------------------------------------------------------- grid */

export function useCollectionGrid(year: number, fundId: string | null) {
  return useQuery(
    api.aggregate.grid,
    fundId ? { year, fundId: fundId as Id<"funds"> } : { year },
  )
}

/* ----------------------------------------------------------- transactions */

export type TransactionFilter =
  | "all"
  | "pending"
  | "approved"
  | "completed"
  | "rejected"

export function useTransactions(status: TransactionFilter, fundId: string | null) {
  return useQuery(api.aggregate.transactions, {
    status,
    fundId: fundId ? (fundId as Id<"funds">) : undefined,
  })
}

export function useApprovals() {
  return useQuery(api.aggregate.approvals)
}

/* ---------------------------------------------------------------- reports */

export function useReports(year: number) {
  return useQuery(api.aggregate.reports, { year })
}

/* -------------------------------------------------------------- year range */

/**
 * Which years the year pickers may offer.
 *
 * Backed by the console's org summary, which is where the range is derived. All
 * three callers ask for the identical query with identical arguments, so Convex
 * serves them one subscription and one payload rather than three — subscribing to
 * the whole summary here is not the same cost as three separate fetches.
 *
 * Returns `undefined` while loading, so a screen must handle that; the fallbacks
 * at the call sites all collapse to the current year, which is the only year
 * guaranteed to exist.
 */
export function useYearRange(): number[] | undefined {
  const shell = useQuery(api.aggregate.shell)
  return shell ? yearsInRange(shell.yearRange.from, shell.yearRange.to) : undefined
}

/* --------------------------------------------------- directory and audit */

export function useDirectory() {
  return useQuery(api.aggregate.directory)
}

export function useAuditLog() {
  return useQuery(api.aggregate.audit, { limit: 60 })
}

/* --------------------------------------------------------- member portal */

/**
 * The three questions the portal has to answer before it can draw anything: am I
 * linked to a member record, what do I owe, and what have I asked for.
 *
 * `myAccount` is separate from `summary` on purpose. `summary` returns `null` for
 * an unlinked account, which is a legitimate state and not a failure — so the
 * claim screen needs to ask "am I linked?" without having to distinguish that
 * `null` from a query that has not resolved yet or one that threw.
 */
export function useMyAccount() {
  return useQuery(api.portal.myAccount)
}

/** What I owe, month by month, with the receipts behind it. Null until claimed. */
export function usePortalSummary() {
  return useQuery(api.portal.summary)
}

/**
 * The full passbook: every month ever charged and every payment ever received.
 *
 * Separate from `usePortalSummary` because the screen caps its receipt list and
 * the document must not. See `portal:statement`.
 */
export function useStatement() {
  return useQuery(api.portal.statement)
}

/** One receipt, for the printable document. Null when it is not the caller's. */
export function useReceipt(paymentId: string | null) {
  return useQuery(
    api.receipts.receiptData,
    paymentId ? { paymentId: paymentId as Id<"payments"> } : "skip",
  )
}

/** Payments I have claimed, and what the treasurer decided about them. */
export function useMyRequests() {
  return useQuery(api.portal.myRequests)
}

/* ------------------------------------------- treasurer: the portal's back office */

/** Who has a portal account, and who cannot see their own balance because of it. */
export function useAccountStatus() {
  return useQuery(api.portal.accountStatus)
}

/** Cash collected offline that members have claimed, waiting to be confirmed. */
export function usePaymentRequests() {
  return useQuery(api.portal.requestsQueue)
}
