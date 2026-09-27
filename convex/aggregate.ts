import { query } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { requireMember } from "./lib/authz"
import { readAllBalances } from "./lib/balances"
import { ageDues, oldestDuePerMember } from "./lib/arrears"
import { entriesBetween, nextYearStart, yearStart } from "./lib/ledger"
import { modeOf, hasDues, isUnscheduled, type CollectionMode } from "./lib/funds"
import { MONTHS_SHORT, sumPaise } from "./lib/money"

/**
 * Read models that return **computed results**, not rows.
 *
 * Milestone M1 fetched every ledger entry, contribution, and payment and
 * aggregated in the browser. That was fine for nine months of demo data
 * (~995 KB) and unusable for eight years of real history (an extrapolated
 * ~11 MB per screen load, and growing every year).
 *
 * Everything the dashboard and the reports need is now computed here, so the
 * browser receives numbers and small lists. Two techniques keep the queries
 * cheap rather than merely moving the cost:
 *
 *   1. Balances come from the materialised `balances` table, not a SUM over the
 *      ledger — see lib/balances.ts. O(funds) instead of O(entries).
 *   2. Arrears read the `by_open` index (status = due/partial), so the result
 *      is proportional to the number of defaulters rather than to the history.
 *
 * The mode rule is enforced here too: arrears and dues only ever consider
 * `fixed_monthly` funds. See lib/funds.ts.
 */

const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const CURRENT_MONTH = NOW.getMonth() + 1
const MONTHS_ELAPSED = CURRENT_MONTH

interface CollectionStats {
  expectedPaise: number
  collectedPaise: number
  paidCount: number
  dueCount: number
  partialCount: number
  waivedCount: number
  totalCount: number
  collectionRate: number
}

function emptyStats(): CollectionStats {
  return {
    expectedPaise: 0,
    collectedPaise: 0,
    paidCount: 0,
    dueCount: 0,
    partialCount: 0,
    waivedCount: 0,
    totalCount: 0,
    collectionRate: 0,
  }
}

type ContribDoc = {
  _id: string
  memberId: string
  fundId?: string
  year: number
  month: number
  amountPaise: number
  status: "due" | "paid" | "partial" | "waived"
}

function statsFor(rows: ContribDoc[]): CollectionStats {
  const stats = emptyStats()
  for (const row of rows) {
    stats.totalCount += 1
    stats.expectedPaise += row.amountPaise
    if (row.status === "paid") {
      stats.paidCount += 1
      stats.collectedPaise += row.amountPaise
    } else if (row.status === "partial") {
      stats.partialCount += 1
      // A partial payment counts as collected, but not fully — the rate is
      // deliberately "share of dues with money against them".
      stats.collectedPaise += row.amountPaise
    } else if (row.status === "waived") {
      stats.waivedCount += 1
    } else {
      stats.dueCount += 1
    }
  }
  stats.collectionRate =
    stats.expectedPaise === 0
      ? 0
      : (stats.collectedPaise / stats.expectedPaise) * 100
  return stats
}

/**
 * Ledger entries for one calendar year, selected by index range.
 *
 * This is the difference between reading ~1.2k rows for a year and reading all
 * ~10k: at eight years of history a whole-ledger scan would not just be slow, it
 * would exceed Convex's 16384-document read limit and fail outright. The range
 * is half-open and the upper bound comes from `entriesBetween`, which is where
 * the reasoning about ISO timestamps lives.
 */
async function entriesInYear(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  year: number,
) {
  return entriesBetween(ctx, orgId, yearStart(year), nextYearStart(year))
}

/* ------------------------------------------------------------------ shell */

/** Small, always-loaded summary for the sidebar and header. */
export const shell = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const [funds, banks, members, pending] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("transactions")
        .withIndex("by_org_status", (q) =>
          q.eq("orgId", actor.orgId).eq("status", "pending"),
        )
        .collect(),
    ])

    const open = await openDues(ctx, actor.orgId)
    const dueFundIds = new Set(
      funds.filter((f) => hasDues(f)).map((f) => f._id),
    )
    // Only dues belonging to a fixed_monthly fund count towards arrears.
    const realArrears = open.filter((c) =>
      c.fundId ? dueFundIds.has(c.fundId) : false,
    )

    let totalBalance = 0
    const fundList = funds.map((fund) => {
      const balancePaise = balances.get(`fund:${fund._id}`) ?? 0
      totalBalance += balancePaise
      return {
        id: fund._id,
        name: fund.name,
        type: fund.type,
        collectionMode: modeOf(fund),
        balancePaise,
      }
    })

    return {
      orgName: (await ctx.db.get(actor.orgId))?.name ?? "",
      totalBalance,
      pendingCount: pending.length,
      memberCount: members.filter((m) => m.isActive).length,
      bankCount: banks.length,
      arrearsCount: new Set(realArrears.map((c) => c.memberId)).size,
      funds: fundList,
      // Which years the grid and report pickers may offer. Derived from the
      // members (84 rows) rather than the ledger, so it costs nothing.
      yearRange: {
        from: members.reduce(
          (min, m) => Math.min(min, m.joinedYear),
          CURRENT_YEAR,
        ),
        to: CURRENT_YEAR,
      },
    }
  },
})

/* -------------------------------------------------------------- dashboard */

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const [funds, banks, members, users] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])

    const fundById = new Map(funds.map((f) => [f._id, f]))
    const userById = new Map(users.map((u) => [u._id, u]))

    // Only this year's entries are needed for the flow chart. At eight years of
    // history this is ~1k rows, not ~13k.
    const yearEntries = await entriesInYear(ctx, actor.orgId, CURRENT_YEAR)

    const flow = Array.from({ length: MONTHS_ELAPSED }, (_, i) => ({
      month: i + 1,
      inflowPaise: 0,
      outflowPaise: 0,
      netPaise: 0,
    }))
    for (const entry of yearEntries) {
      const index = new Date(entry.effectiveDate).getUTCMonth()
      if (index < 0 || index >= MONTHS_ELAPSED) continue
      if (entry.amountPaise >= 0) flow[index].inflowPaise += entry.amountPaise
      else flow[index].outflowPaise += -entry.amountPaise
    }
    for (const point of flow) point.netPaise = point.inflowPaise - point.outflowPaise

    const inflowYtd = sumPaise(flow.map((p) => p.inflowPaise))
    const outflowYtd = sumPaise(flow.map((p) => p.outflowPaise))

    const dueFundIds = new Set(
      funds.filter((f) => hasDues(f)).map((f) => f._id),
    )
    const open = (await openDues(ctx, actor.orgId)).filter((c) =>
      c.fundId ? dueFundIds.has(c.fundId) : false,
    )
    const arrearsByMember = new Map<string, { paise: number; months: number }>()
    for (const row of open) {
      const current = arrearsByMember.get(row.memberId) ?? { paise: 0, months: 0 }
      current.paise += row.amountPaise
      current.months += 1
      arrearsByMember.set(row.memberId, current)
    }

    // Dues for the current month and for the year so far.
    const yearDues = await ctx.db
      .query("contributions")
      .withIndex("by_org_year", (q) =>
        q.eq("orgId", actor.orgId).eq("year", CURRENT_YEAR),
      )
      .collect()
    const scopedDues = yearDues.filter((c) =>
      c.fundId ? dueFundIds.has(c.fundId) : false,
    )
    const monthStats = statsFor(
      scopedDues.filter((c) => c.month === CURRENT_MONTH),
    )
    const yearStats = statsFor(
      scopedDues.filter((c) => c.month <= MONTHS_ELAPSED),
    )

    const totalBalance = sumPaise(
      funds.map((f) => balances.get(`fund:${f._id}`) ?? 0),
    )

    const pending = (
      await ctx.db
        .query("transactions")
        .withIndex("by_org_status", (q) =>
          q.eq("orgId", actor.orgId).eq("status", "pending"),
        )
        .collect()
    )
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate))
      .slice(0, 4)
      .map((t) => ({
        id: t._id,
        description: t.description,
        amountPaise: t.amountPaise,
        date: t.transactionDate,
        fundName: fundById.get(t.fundId)?.name ?? "",
        isCredit: t.type === "deposit" || t.type === "transfer_in",
        requestedByName: userById.get(t.requestedBy)?.name ?? "",
      }))

    const recent = [...yearEntries]
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .slice(0, 7)
      .map((e) => ({
        id: e._id,
        note: e.note ?? e.source,
        source: e.source,
        date: e.effectiveDate,
        fundName: (e.fundId ? fundById.get(e.fundId)?.name : null) ?? "Unassigned",
        amountPaise: e.amountPaise,
        isCredit: e.amountPaise >= 0,
      }))

    return {
      totalBalance,
      inflowYtd,
      outflowYtd,
      arrearsTotal: sumPaise([...arrearsByMember.values()].map((a) => a.paise)),
      arrearsCount: arrearsByMember.size,
      unpaidMonths: open.length,
      monthStats,
      yearStats,
      flow,
      fundBreakdown: funds
        .map((f) => ({
          id: f._id,
          name: f.name,
          type: f.type,
          collectionMode: modeOf(f),
          balancePaise: balances.get(`fund:${f._id}`) ?? 0,
        }))
        .sort((a, b) => b.balancePaise - a.balancePaise),
      bankTotal: sumPaise(banks.map((b) => balances.get(`bank:${b._id}`) ?? 0)),
      pending,
      recent,
      totalMembers: members.filter((m) => m.isActive).length,
    }
  },
})

/* ------------------------------------------------------------------ funds */

export const funds = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const [fundsList, banks, users] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])
    const bankById = new Map(banks.map((b) => [b._id, b]))
    const userById = new Map(users.map((u) => [u._id, u]))

    return fundsList
      .map((fund) => {
        const balancePaise = balances.get(`fund:${fund._id}`) ?? 0
        const target = fund.targetAmountPaise ?? null
        return {
          id: fund._id,
          name: fund.name,
          type: fund.type,
          collectionMode: modeOf(fund),
          description: fund.description ?? null,
          bankId: fund.bankId ?? null,
          bankName: fund.bankId ? (bankById.get(fund.bankId)?.name ?? null) : null,
          managerName: fund.managerId
            ? (userById.get(fund.managerId)?.name ?? null)
            : null,
          targetAmountPaise: target,
          balancePaise,
          progressPaise:
            target && target > 0 ? Math.min(100, (balancePaise / target) * 100) : null,
          isActive: fund.isActive,
          monthlyAmountPaise: fund.monthlyAmountPaise ?? null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const fundDetail = query({
  args: { fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) return null

    const bank = fund.bankId ? await ctx.db.get(fund.bankId) : null
    const manager = fund.managerId ? await ctx.db.get(fund.managerId) : null

    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_fund", (q) =>
        q.eq("orgId", actor.orgId).eq("fundId", args.fundId),
      )
      .collect()
      .then((rows) =>
        rows
          .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
          // A decade of requests is more than any screen can usefully show, and
          // the point of the page is what is happening now.
          .slice(0, 50)
          .map((t) => ({
            id: t._id,
            description: t.description,
            amountPaise: t.amountPaise,
            date: t.transactionDate,
            category: t.category,
            status: t.status,
            isCredit: t.type === "deposit" || t.type === "transfer_in",
          })),
      )

    // Spend by category needs this year's debits for this fund only. The
    // (orgId, fundId, effectiveDate) index makes that a key range rather than
    // every entry the fund has ever had.
    const yearEntries = (
      await entriesBetween(
        ctx,
        actor.orgId,
        yearStart(CURRENT_YEAR),
        nextYearStart(CURRENT_YEAR),
      )
    ).filter((e) => e.fundId === args.fundId && e.amountPaise < 0)
    const categoryTotals = new Map<string, number>()
    for (const entry of yearEntries) {
      categoryTotals.set(
        entry.category,
        (categoryTotals.get(entry.category) ?? 0) + -entry.amountPaise,
      )
    }

    const balancePaise = balances.get(`fund:${args.fundId}`) ?? 0
    const bankBalancePaise = fund.bankId
      ? (balances.get(`bank:${fund.bankId}`) ?? 0)
      : null

    // For pledge-based funds, compare what was promised with what arrived.
    let pledgedPaise: number | null = null
    if (modeOf(fund) === "pledge_based") {
      const pledges = await ctx.db
        .query("pledges")
        .withIndex("by_org_fund", (q) =>
          q.eq("orgId", actor.orgId).eq("fundId", args.fundId),
        )
        .collect()
      pledgedPaise = sumPaise(
        pledges
          .filter((p) => p.status !== "cancelled")
          .map((p) => p.amountPledgedPaise),
      )
    }

    return {
      id: fund._id,
      name: fund.name,
      type: fund.type,
      collectionMode: modeOf(fund),
      description: fund.description ?? null,
      isActive: fund.isActive,
      bankId: fund.bankId ?? null,
      targetAmountPaise: fund.targetAmountPaise ?? null,
      monthlyAmountPaise: fund.monthlyAmountPaise ?? null,
      balancePaise,
      bankBalancePaise,
      bank: bank
        ? {
            id: bank._id,
            name: bank.name,
            branch: bank.branch ?? null,
            ifscCode: bank.ifscCode ?? null,
          }
        : null,
      managerName: manager?.name ?? null,
      transactions,
      spendByCategory: [...categoryTotals.entries()]
        .map(([category, totalPaise]) => ({ category, totalPaise }))
        .sort((a, b) => b.totalPaise - a.totalPaise),
      pledgedPaise,
      pendingCount: transactions.filter((t) => t.status === "pending").length,
    }
  },
})

/* ------------------------------------------------------------------ banks */

export const banks = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const [bankList, fundsList] = await Promise.all([
      ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])

    return bankList
      .map((bank) => ({
        id: bank._id,
        name: bank.name,
        branch: bank.branch ?? null,
        accountNumber: bank.accountNumber ?? null,
        ifscCode: bank.ifscCode ?? null,
        notes: bank.notes ?? null,
        balancePaise: balances.get(`bank:${bank._id}`) ?? 0,
        allocation: fundsList
          .filter((f) => f.bankId === bank._id)
          .map((f) => ({
            fundId: f._id,
            name: f.name,
            collectionMode: modeOf(f),
            balancePaise: balances.get(`fund:${f._id}`) ?? 0,
          })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

/** Passbook for one bank account, with a running balance for the given year. */
export const bankPassbook = query({
  args: {
    bankId: v.id("banks"),
    year: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)
    const year = args.year ?? CURRENT_YEAR

    // effectiveDate is an ISO string, so the by_date index range-selects one
    // year. Both bounds matter: without the upper one, asking for 2018 returned
    // every entry from 2018 to today and labelled nine years of transactions
    // "entries in 2018".
    const entries = (
      await entriesBetween(
        ctx,
        actor.orgId,
        yearStart(year),
        nextYearStart(year),
      )
    ).filter((e) => e.bankId === args.bankId)

    // Opening and closing for the year, from the materialised per-year movement
    // totals rather than by re-reading the ledger. `movementThisYear` is this
    // account's net movement in `year`; everything after it is what the account
    // has earned since, so subtracting that from today's balance gives the
    // balance at the end of `year`. O(years) rows read, not O(entries) — which
    // is the difference between 100ms and 6.6s for the oldest year.
    const prefix = `bank_year:${args.bankId}:`
    let movementThisYear = 0
    let movementSince = 0
    for (const [key, amountPaise] of balances) {
      if (!key.startsWith(prefix)) continue
      const keyYear = Number(key.slice(prefix.length))
      if (!Number.isFinite(keyYear)) continue
      if (keyYear === year) movementThisYear = amountPaise
      else if (keyYear > year) movementSince += amountPaise
    }

    const closingAllTime = balances.get(`bank:${args.bankId}`) ?? 0
    const closingThisYear = closingAllTime - movementSince
    const openingPaise = closingThisYear - movementThisYear

    const ascending = [...entries].sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate),
    )
    let running = openingPaise
    const rows = ascending.map((e) => {
      running += e.amountPaise
      return {
        id: e._id,
        date: e.effectiveDate,
        note: e.note ?? e.source,
        source: e.source,
        amountPaise: e.amountPaise,
        closingPaise: running,
      }
    })

    return {
      year,
      openingPaise,
      closingPaise: closingThisYear,
      totalCreditPaise: sumPaise(
        rows.filter((r) => r.amountPaise > 0).map((r) => r.amountPaise),
      ),
      totalDebitPaise: sumPaise(
        rows.filter((r) => r.amountPaise < 0).map((r) => -r.amountPaise),
      ),
      entries: rows.slice(-(args.limit ?? 40)).reverse(),
    }
  },
})

/* ---------------------------------------------------------------- members */

/**
 * Members with their dues position.
 *
 * `arrearsPaise` and `unpaidMonths` are only populated for `fixed_monthly`
 * funds. For a voluntary or donation fund a member who has never given is not a
 * defaulter, and this query returns zero rather than inventing a debt.
 */
export const members = query({
  args: {
    filter: v.optional(
      v.union(
        v.literal("all"),
        v.literal("active"),
        v.literal("inactive"),
        v.literal("arrears"),
        v.literal("clear"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)

    const [memberList, fundsList] = await Promise.all([
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])

    const dueFundIds = new Set(
      fundsList.filter((f) => hasDues(f)).map((f) => f._id),
    )

    const open = (await openDues(ctx, actor.orgId)).filter((c) =>
      c.fundId ? dueFundIds.has(c.fundId) : false,
    )
    const byMember = new Map<string, { paise: number; months: number }>()
    for (const row of open) {
      const current = byMember.get(row.memberId) ?? { paise: 0, months: 0 }
      current.paise += row.amountPaise
      current.months += 1
      byMember.set(row.memberId, current)
    }

    // Months settled this year, per member, for a quick "how do they pay" hint.
    const yearDues = await ctx.db
      .query("contributions")
      .withIndex("by_org_year", (q) =>
        q.eq("orgId", actor.orgId).eq("year", CURRENT_YEAR),
      )
      .collect()
    const paidByMember = new Map<string, number>()
    for (const row of yearDues) {
      if (row.status !== "paid" && row.status !== "partial") continue
      if (row.fundId && !dueFundIds.has(row.fundId)) continue
      paidByMember.set(row.memberId, (paidByMember.get(row.memberId) ?? 0) + 1)
    }

    const filter = args.filter ?? "all"
    return memberList
      .map((m) => {
        const position = byMember.get(m._id) ?? { paise: 0, months: 0 }
        return {
          id: m._id,
          name: m.name,
          phone: m.phone ?? null,
          email: m.email ?? null,
          relation: m.relation ?? null,
          joinedYear: m.joinedYear,
          joinedMonth: m.joinedMonth,
          isActive: m.isActive,
          arrearsPaise: position.paise,
          unpaidMonths: position.months,
          paidMonthsThisYear: paidByMember.get(m._id) ?? 0,
        }
      })
      .filter((m) => {
        switch (filter) {
          case "active":
            return m.isActive
          case "inactive":
            return !m.isActive
          case "arrears":
            return m.arrearsPaise > 0
          case "clear":
            return m.arrearsPaise === 0
          default:
            return true
        }
      })
      .sort((a, b) => b.arrearsPaise - a.arrearsPaise || a.name.localeCompare(b.name))
  },
})

/** A member's own statement: payments received, and what is still owed. */
export const memberPassbook = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) return null

    const fundsList = await ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const fundName = new Map(fundsList.map((f) => [f._id, f.name]))
    const dueFundIds = new Set(
      fundsList.filter((f) => hasDues(f)).map((f) => f._id),
    )

    // The receipt list is capped, but the lifetime total is not: it is the sum
    // of every payment this member has ever made, and a member who joined in
    // 2018 has around a hundred of them.
    const allPayments = await ctx.db
      .query("payments")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", args.memberId),
      )
      .collect()
    const totalReceivedPaise = sumPaise(
      allPayments.map((p) => p.amountPaise),
    )
    const payments = [...allPayments]
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
      .slice(0, 60)
      .map((p) => ({
        id: p._id,
        receiptNo: p.receiptNo,
        amountPaise: p.amountPaise,
        method: p.method,
        paidAt: p.paidAt,
        reference: p.reference ?? null,
        fundName: p.fundId ? (fundName.get(p.fundId) ?? "") : "",
      }))

    const open = (await openDues(ctx, actor.orgId)).filter(
      (c) =>
        c.memberId === args.memberId &&
        (c.fundId ? dueFundIds.has(c.fundId) : false),
    )

    return {
      member: {
        id: member._id,
        name: member.name,
        phone: member.phone ?? null,
        relation: member.relation ?? null,
        joinedYear: member.joinedYear,
        joinedMonth: member.joinedMonth,
        isActive: member.isActive,
      },
      payments,
      paymentCount: allPayments.length,
      totalReceivedPaise,
      outstandingPaise: sumPaise(open.map((c) => c.amountPaise)),
      unpaidMonths: open.length,
      lifetimePaise: balances.get(`member:${args.memberId}`) ?? 0,
    }
  },
})

/* -------------------------------------------------------- collection grid */

export const grid = query({
  args: { year: v.number(), fundId: v.optional(v.id("funds")) },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)

    const fundsList = await ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    // Default to the fund that actually has dues.
    const target =
      args.fundId ??
      fundsList.find((f) => hasDues(f) && f.isActive)?._id ??
      fundsList[0]?._id
    if (!target) return null

    const fund = await ctx.db.get(target)
    if (!fund || fund.orgId !== actor.orgId) return null

    // A grid only makes sense for a fund where every member owes something.
    // Refusing here is what stops a voluntary fund acquiring arrears.
    if (!hasDues(fund)) {
      return {
        fundId: fund._id,
        fundName: fund.name,
        collectionMode: modeOf(fund),
        applicable: false as const,
        reason: `"${fund.name}" is ${modeOf(fund)} — members do not owe it anything, so there is no grid to show.`,
        year: args.year,
        collectableMonths: 0,
        monthlyAmountPaise: 0,
        rows: [],
        monthTotals: [],
        yearStats: emptyStats(),
      }
    }

    const [membersList, dues] = await Promise.all([
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("contributions")
        .withIndex("by_grid", (q) =>
          q
            .eq("orgId", actor.orgId)
            .eq("year", args.year)
            .eq("fundId", target),
        )
        .collect(),
    ])

    const byKey = new Map(dues.map((d) => [`${d.memberId}:${d.month}`, d]))
    const collectableMonths =
      args.year === CURRENT_YEAR ? MONTHS_ELAPSED : 12

    const rows = membersList
      .filter((m) => m.isActive)
      .map((m) => {
        const cells = Array.from({ length: 12 }, (_, i) => {
          const month = i + 1
          const due = byKey.get(`${m._id}:${month}`)
          if (!due) return null
          return {
            month,
            contributionId: due._id,
            amountPaise: due.amountPaise,
            status: due.status,
          }
        })
        let paidCount = 0
        let paidPaise = 0
        for (const cell of cells) {
          if (cell && (cell.status === "paid" || cell.status === "partial")) {
            paidCount += 1
            paidPaise += cell.amountPaise
          }
        }
        return {
          memberId: m._id,
          name: m.name,
          joinedYear: m.joinedYear,
          joinedMonth: m.joinedMonth,
          cells,
          paidCount,
          paidPaise,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const monthTotals = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      expectedPaise: 0,
      collectedPaise: 0,
      rate: 0,
    }))
    for (const row of rows) {
      for (const cell of row.cells) {
        if (!cell) continue
        const bucket = monthTotals[cell.month - 1]
        bucket.expectedPaise += cell.amountPaise
        if (cell.status === "paid" || cell.status === "partial") {
          bucket.collectedPaise += cell.amountPaise
        }
      }
    }
    for (const bucket of monthTotals) {
      bucket.rate =
        bucket.expectedPaise === 0
          ? 0
          : (bucket.collectedPaise / bucket.expectedPaise) * 100
    }

    return {
      fundId: fund._id,
      fundName: fund.name,
      collectionMode: modeOf(fund) as CollectionMode,
      applicable: true as const,
      reason: null as string | null,
      year: args.year,
      collectableMonths,
      monthlyAmountPaise: fund.monthlyAmountPaise ?? 0,
      rows,
      monthTotals,
      yearStats: statsFor(dues as ContribDoc[]),
    }
  },
})

/* ---------------------------------------------------------- transactions */

export const transactions = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("all"),
        v.literal("pending"),
        v.literal("approved"),
        v.literal("completed"),
        v.literal("rejected"),
      ),
    ),
    fundId: v.optional(v.id("funds")),
  },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)

    // `transactions` is a request log, not the ledger — it grows with the
    // community's decisions rather than with its daily takings, so reading it
    // whole and filtering here is what lets the stat tiles stay correct
    // whatever status filter is selected.
    const [rows, fundsList, users] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_org_status", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])

    const fundById = new Map(fundsList.map((f) => [f._id, f]))
    const userById = new Map(users.map((u) => [u._id, u]))

    // Only money that was actually approved has moved a balance; pending and
    // rejected requests never touched the ledger.
    const settled = rows.filter(
      (t) => t.status === "approved" || t.status === "completed",
    )
    const credit = (t: (typeof settled)[number]) =>
      t.type === "deposit" || t.type === "transfer_in"
    const stats = {
      inflowPaise: sumPaise(settled.filter(credit).map((t) => t.amountPaise)),
      outflowPaise: sumPaise(
        settled.filter((t) => !credit(t)).map((t) => t.amountPaise),
      ),
      pendingCount: rows.filter((t) => t.status === "pending").length,
      pendingPaise: sumPaise(
        rows.filter((t) => t.status === "pending").map((t) => t.amountPaise),
      ),
      pendingWithdrawalCount: rows.filter(
        (t) => t.status === "pending" && !credit(t),
      ).length,
      pendingDepositCount: rows.filter(
        (t) => t.status === "pending" && credit(t),
      ).length,
    }

    const filtered = rows.filter((t) => {
      if (args.status && args.status !== "all" && t.status !== args.status) {
        return false
      }
      if (args.fundId && t.fundId !== args.fundId) return false
      return true
    })

    return {
      stats,
      // The stats above describe every request ever made; the table only needs
      // the recent ones. The cap is what stops this read model from becoming
      // the next thing that grows with history.
      truncated: filtered.length > 200,
      rows: filtered
        .slice(0, 200)
        .map((t) => ({
          id: t._id,
          description: t.description,
          amountPaise: t.amountPaise,
          category: t.category,
          status: t.status,
          date: t.transactionDate,
          fundId: t.fundId,
          fundName: fundById.get(t.fundId)?.name ?? "",
          toFundName: t.toFundId
            ? (fundById.get(t.toFundId)?.name ?? null)
            : null,
          requestedByName: userById.get(t.requestedBy)?.name ?? "",
          approvedByName: t.approvedBy
            ? (userById.get(t.approvedBy)?.name ?? null)
            : null,
          approvalNote: t.approvalNote ?? null,
          isCredit: credit(t),
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    }
  },
})

/* --------------------------------------------------------------- directory */

/** Who can use the console. Small, and needed by several screens. */
export const directory = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return users
      .filter((u) => u.role)
      .map((u) => ({
        id: u._id,
        name: u.name ?? "",
        email: u.email ?? "",
        role: u.role ?? "viewer",
        isActive: u.isActive ?? true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

/** The audit log, with the actor's name resolved. */
export const audit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const limit = args.limit ?? 60
    const [entries, users] = await Promise.all([
      ctx.db
        .query("auditLog")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .order("desc")
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])
    const userName = new Map(users.map((u) => [u._id, u.name ?? ""]))

    return entries.slice(0, limit).map((e) => ({
      id: e._id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      details: e.details ?? null,
      actorName: e.userId ? (userName.get(e.userId) ?? "system") : "system",
      createdAt: new Date(e.createdAt).toISOString(),
    }))
  },
})

/** The approvals queue, with fund and requester names resolved. */
export const approvals = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const [rows, fundsList, users] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_org_status", (q) =>
          q.eq("orgId", actor.orgId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])
    const fundById = new Map(fundsList.map((f) => [f._id, f]))
    const userById = new Map(users.map((u) => [u._id, u]))

    return rows
      .map((t) => {
        const fund = fundById.get(t.fundId)
        return {
          id: t._id,
          description: t.description,
          amountPaise: t.amountPaise,
          category: t.category,
          date: t.transactionDate,
          fundName: fund?.name ?? "",
          fundType: fund?.type ?? null,
          // The approver can see at a glance whether the request touches a fund
          // that can hold dues or one that simply collects what is offered.
          collectionMode: fund ? modeOf(fund) : null,
          toFundName: t.toFundId
            ? (fundById.get(t.toFundId)?.name ?? null)
            : null,
          requestedBy: t.requestedBy,
          requestedByName: userById.get(t.requestedBy)?.name ?? "",
          isCredit: t.type === "deposit" || t.type === "transfer_in",
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  },
})

/* ---------------------------------------------------------------- reports */

export const reports = query({
  args: { year: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const year = args.year ?? CURRENT_YEAR
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const [fundsList, dues, yearEntries, membersList] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("contributions")
        .withIndex("by_org_year", (q) =>
          q.eq("orgId", actor.orgId).eq("year", year),
        )
        .collect(),
      entriesInYear(ctx, actor.orgId, year),
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])

    const dueFundIds = new Set(
      fundsList.filter((f) => hasDues(f)).map((f) => f._id),
    )
    const scopedDues = dues.filter((c) =>
      c.fundId ? dueFundIds.has(c.fundId) : false,
    )

    // Monthly collection efficiency, for the scheduled funds only.
    const efficiency = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      const monthDues = scopedDues.filter((c) => c.month === month)
      const s = statsFor(monthDues as ContribDoc[])
      return {
        month,
        label: MONTHS_SHORT[month - 1],
        rate: Number(s.collectionRate.toFixed(1)),
        collectedPaise: s.collectedPaise,
        expectedPaise: s.expectedPaise,
      }
    })

    // Expenditure by category.
    const categoryTotals = new Map<string, number>()
    for (const entry of yearEntries) {
      if (entry.amountPaise >= 0) continue
      categoryTotals.set(
        entry.category,
        (categoryTotals.get(entry.category) ?? 0) + -entry.amountPaise,
      )
    }
    const totalSpend = sumPaise([...categoryTotals.values()])

    // Arrears aging, again only for scheduled funds.
    //
    // Ageing is by days past due, not by how many months a member happens to
    // owe. The old buckets ("1 month", "2 months", "3+ months") put someone
    // owing ₹100 from 2019 and someone owing ₹1,000 from last month in the same
    // row, which is not a decision anyone can act on. See convex/lib/arrears.ts.
    const open = (await openDues(ctx, actor.orgId)).filter((c) =>
      c.fundId ? dueFundIds.has(c.fundId) : false,
    )
    const buckets = ageDues(
      open.map((c) => ({
        memberId: c.memberId,
        amountPaise: c.amountPaise,
        year: c.year,
        month: c.month,
        dueDate: c.dueDate,
      })),
      NOW,
    )
    const oldest = oldestDuePerMember(
      open.map((c) => ({
        memberId: c.memberId,
        year: c.year,
        month: c.month,
        dueDate: c.dueDate,
      })),
      NOW,
    )

    const byMember = new Map<Id<"members">, number[]>()
    for (const row of open) {
      if (!row.memberId) continue
      const list = byMember.get(row.memberId) ?? []
      list.push(row.amountPaise)
      byMember.set(row.memberId, list)
    }
    const memberName = new Map(membersList.map((m) => [m._id, m.name]))
    const aged = [...byMember.entries()].map(([id, amounts]) => {
      const oldestDue = oldest.get(id)
      return {
        memberId: id,
        name: memberName.get(id) ?? "",
        months: amounts.length,
        totalPaise: sumPaise(amounts),
        oldestDueDate: oldestDue?.dueDate ?? null,
        oldestDays: oldestDue?.days ?? 0,
      }
    })
    const totalArrears = sumPaise(aged.map((a) => a.totalPaise))

    // Voluntary funds are reported by what was collected, never as arrears.
    const unscheduledFundIds = new Set(
      fundsList.filter((f) => isUnscheduled(f)).map((f) => f._id),
    )
    const collectionRounds = await ctx.db
      .query("collectionRounds")
      .withIndex("by_org_fund_date", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const roundTotals = collectionRounds
      .filter((r) => r.date.startsWith(String(year)))
      .map((r) => {
        const fund = fundsList.find((f) => f._id === r.fundId)
        return {
          id: r._id,
          date: r.date,
          label: r.label ?? null,
          fundId: r.fundId,
          fundName: fund?.name ?? "",
          collectionMode: fund ? modeOf(fund) : ("voluntary" as const),
        }
      })
      .reverse()

    // The month-to-date cut-off belongs to the *current* year only. Applying it
    // to a completed year dropped October onwards, so the 2024 report headlined
    // ₹69,700 while the efficiency chart directly beside it totalled ₹93,300.
    const yearStats = statsFor(
      (year === CURRENT_YEAR
        ? scopedDues.filter((c) => c.month <= MONTHS_ELAPSED)
        : scopedDues) as ContribDoc[],
    )

    return {
      year,
      yearStats,
      totalSpend,
      efficiency,
      spendByCategory: [...categoryTotals.entries()]
        .map(([category, totalPaise]) => ({ category, totalPaise }))
        .sort((a, b) => b.totalPaise - a.totalPaise),
      aging: buckets,
      totalArrears,
      arrearsCount: aged.length,
      worst: aged.sort((a, b) => b.totalPaise - a.totalPaise).slice(0, 5),
      fundProgress: fundsList.map((f) => {
        const balancePaise = balances.get(`fund:${f._id}`) ?? 0
        const target = f.targetAmountPaise ?? null
        return {
          id: f._id,
          name: f.name,
          type: f.type,
          collectionMode: modeOf(f),
          balancePaise,
          targetAmountPaise: target,
          progressPaise:
            target && target > 0
              ? Math.min(100, (balancePaise / target) * 100)
              : null,
        }
      }),
      collectionRounds: roundTotals,
      // Voluntary and donation funds are reported by what has actually been
      // collected, and for *this year* — the card sits next to "N collection
      // rounds in {year}", so an all-time fund balance beside a year-scoped
      // count was answering a different question than the one asked. The year's
      // credits are already in `yearEntries`, so this costs nothing extra.
      roundFundTotal: sumPaise(
        yearEntries
          .filter(
            (e) =>
              e.fundId !== undefined &&
              e.fundId !== null &&
              unscheduledFundIds.has(e.fundId) &&
              e.amountPaise > 0,
          )
          .map((e) => e.amountPaise),
      ),
    }
  },
})

/* --------------------------------------------------------------- helpers */

/**
 * Currently unpaid dues, read through the `by_open` index.
 *
 * This is the one query that would otherwise grow with history. The index is
 * (orgId, status, year); matching only the first two fields selects every
 * outstanding due regardless of year, which keeps this proportional to the
 * number of defaulters rather than to eight years of history.
 */
async function openDues(ctx: QueryCtx, orgId: Id<"organizations">) {
  return ctx.db
    .query("contributions")
    .withIndex("by_open", (q) =>
      q.eq("orgId", orgId).eq("status", "due"),
    )
    .collect()
}
