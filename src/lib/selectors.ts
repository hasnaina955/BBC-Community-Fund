import type {
  Bank,
  Contribution,
  Fund,
  LedgerEntry,
  Member,
  Payment,
  Transaction,
  TransactionStatus,
} from "@/lib/types"

/**
 * Every balance and total in the app is computed here from ledger entries.
 *
 * There are deliberately no stored balance counters: the legacy model kept
 * `funds.current_balance` and `banks.current_balance` in sync by hand, which
 * drifts. A balance is a sum, so it cannot disagree with its own entries.
 * See docs/ARCHITECTURE.md -> "The ledger".
 */

export const sum = (values: number[]): number =>
  values.reduce((acc, v) => acc + v, 0)

export function fundBalance(
  entries: LedgerEntry[],
  fundId: string | null,
): number {
  if (!fundId) return 0
  return sum(
    entries.filter((e) => e.fundId === fundId).map((e) => e.amountPaise),
  )
}

export function bankBalance(entries: LedgerEntry[], bankId: string): number {
  return sum(
    entries.filter((e) => e.bankId === bankId).map((e) => e.amountPaise),
  )
}

export function memberBalance(
  entries: LedgerEntry[],
  memberId: string,
): number {
  return sum(
    entries.filter((e) => e.memberId === memberId).map((e) => e.amountPaise),
  )
}

export function entriesForBank(entries: LedgerEntry[], bankId: string) {
  return entries
    .filter((e) => e.bankId === bankId)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
}

/** Funds with their derived balances and progress toward target. */
export function fundSummaries(entries: LedgerEntry[], funds: Fund[]) {
  return funds.map((fund) => {
    const balancePaise = fundBalance(entries, fund.id)
    const targetPaise = fund.targetPaise
    return {
      ...fund,
      balancePaise,
      targetPaise,
      progressPaise:
        targetPaise && targetPaise > 0
          ? Math.min(100, (balancePaise / targetPaise) * 100)
          : null,
    }
  })
}

export function bankSummaries(entries: LedgerEntry[], banks: Bank[]) {
  return banks.map((bank) => ({
    ...bank,
    balancePaise: bankBalance(entries, bank.id),
  }))
}

export interface CollectionStats {
  expectedPaise: number
  collectedPaise: number
  paidCount: number
  dueCount: number
  partialCount: number
  waivedCount: number
  totalCount: number
  collectionRate: number
}

export function collectionStats(
  contributions: Contribution[],
  year: number,
  month?: number,
): CollectionStats {
  const scoped = contributions.filter(
    (c) => c.year === year && (month === undefined || c.month === month),
  )
  const expectedPaise = sum(scoped.map((c) => c.amountPaise))
  const collectedPaise = sum(
    scoped
      .filter((c) => c.status === "paid" || c.status === "partial")
      .map((c) => c.amountPaise),
  )
  return {
    expectedPaise,
    collectedPaise,
    paidCount: scoped.filter((c) => c.status === "paid").length,
    dueCount: scoped.filter((c) => c.status === "due").length,
    partialCount: scoped.filter((c) => c.status === "partial").length,
    waivedCount: scoped.filter((c) => c.status === "waived").length,
    totalCount: scoped.length,
    collectionRate:
      expectedPaise === 0 ? 0 : (collectedPaise / expectedPaise) * 100,
  }
}

export interface MonthlyFlowPoint {
  month: number
  inflowPaise: number
  outflowPaise: number
  netPaise: number
}

export function monthlyFlow(entries: LedgerEntry[], year: number): MonthlyFlowPoint[] {
  const points: MonthlyFlowPoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    inflowPaise: 0,
    outflowPaise: 0,
    netPaise: 0,
  }))

  for (const entry of entries) {
    const date = new Date(entry.effectiveDate)
    if (date.getUTCFullYear() !== year) continue
    const index = date.getUTCMonth()
    if (entry.amountPaise >= 0) points[index].inflowPaise += entry.amountPaise
    else points[index].outflowPaise += -entry.amountPaise
  }

  for (const p of points) p.netPaise = p.inflowPaise - p.outflowPaise
  return points
}

export interface CategoryTotal {
  category: string
  totalPaise: number
}

export function spendByCategory(
  entries: LedgerEntry[],
  fundId?: string,
): CategoryTotal[] {
  const totals = new Map<string, number>()
  for (const entry of entries) {
    if (entry.amountPaise >= 0) continue
    if (fundId && entry.fundId !== fundId) continue
    totals.set(
      entry.category,
      (totals.get(entry.category) ?? 0) + -entry.amountPaise,
    )
  }
  return [...totals.entries()]
    .map(([category, totalPaise]) => ({ category, totalPaise }))
    .sort((a, b) => b.totalPaise - a.totalPaise)
}

/** Members with outstanding dues, oldest first. */
export interface Defaulter {
  member: Member
  outstandingPaise: number
  months: number[]
  oldestMonth: number
}

export function defaulters(
  contributions: Contribution[],
  members: Member[],
  year: number,
  asOfMonth: number,
): Defaulter[] {
  const byMember = new Map<string, Contribution[]>()
  for (const c of contributions) {
    if (c.year !== year || c.month > asOfMonth) continue
    if (c.status !== "due") continue
    const list = byMember.get(c.memberId) ?? []
    list.push(c)
    byMember.set(c.memberId, list)
  }

  const result: Defaulter[] = []
  for (const [memberId, list] of byMember) {
    const member = members.find((m) => m.id === memberId)
    if (!member) continue
    const months = list.map((c) => c.month).sort((a, b) => a - b)
    result.push({
      member,
      outstandingPaise: sum(list.map((c) => c.amountPaise)),
      months,
      oldestMonth: months[0],
    })
  }
  return result.sort(
    (a, b) => b.outstandingPaise - a.outstandingPaise || a.oldestMonth - b.oldestMonth,
  )
}

export const APPROVED_STATUSES: readonly TransactionStatus[] = [
  "approved",
  "completed",
]

export function transactionsForFund(
  transactions: Transaction[],
  fundId: string,
): Transaction[] {
  return transactions
    .filter((t) => t.fundId === fundId)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
}

export function paymentsForMember(
  payments: Payment[],
  memberId: string,
): Payment[] {
  return payments
    .filter((p) => p.memberId === memberId)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
}

/** Build the year x month pivot the collection grid renders. */
export function contributionGrid(
  contributions: Contribution[],
  members: Member[],
  year: number,
) {
  const key = (memberId: string, month: number) => `${memberId}:${month}`
  const index = new Map<string, Contribution>()
  for (const c of contributions) {
    if (c.year === year) index.set(key(c.memberId, c.month), c)
  }
  return members.map((member) => ({
    member,
    cells: Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      return index.get(key(member.id, month)) ?? null
    }),
  }))
}
