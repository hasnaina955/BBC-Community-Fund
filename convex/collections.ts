import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireTreasurer, requireConsole } from "./lib/authz"
import { recordAudit } from "./lib/audit"
import { assertPositive } from "./lib/money"
import { hasPledges, isUnscheduled, modeOf } from "./lib/funds"
import { recordPaymentFor } from "./lib/collection"
import { sumPaise } from "./lib/money"

/**
 * Collection rounds and pledges.
 *
 * These exist because two of the three real funds are not periodic levies:
 *
 *   - The voluntary Friday fund is a *collection*. Nobody owes it, so the unit
 *     of record is a dated session, not a member x month cell.
 *   - The reconstruction fund runs on *promises*. A pledge is money promised
 *     before it arrives, which is a different thing from a periodic due.
 *
 * Both are enforced to only apply to the fund modes that make sense for them.
 */

export const createRound = mutation({
  args: {
    fundId: v.id("funds"),
    date: v.string(),
    label: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)

    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")

    // A round is for a fund that has no schedule. On a fixed_monthly fund it
    // would be meaningless, and would invite double counting against the grid.
    if (!isUnscheduled(fund)) {
      throw new Error(
        `"${fund.name}" is ${modeOf(fund)}, so it is collected on a schedule. ` +
          "Collection rounds are for voluntary and donation funds only.",
      )
    }

    const label = args.label.trim()
    if (label.length < 2) throw new Error("Give the session a label")

    const id = await ctx.db.insert("collectionRounds", {
      orgId: actor.orgId,
      fundId: args.fundId,
      date: args.date,
      label,
      note: args.note?.trim() || undefined,
      collectedBy: actor.userId,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: "collectionRound.created",
      entityType: "collectionRound",
      entityId: id,
      details: `${fund.name} — ${label}`,
    })

    return id
  },
})

/**
 * Record a payment into an open collection session.
 *
 * This exists as its own mutation rather than as the existing
 * `transactions.recordPayment` with a `roundId` argument, for one reason: the
 * fund is derived *from the round* instead of being supplied alongside it.
 *
 * `recordPaymentFor` does check that a round and a fund agree, and would reject
 * a mismatch — but a mismatch is only possible if the caller is given the
 * opportunity to make one. A treasurer at a meeting with a phone in one hand
 * picks a session, picks a member, types an amount. The fund is a fact about the
 * session and asking for it is asking for the wrong thing. Deriving it removes
 * the error rather than catching it.
 *
 * It writes through the same `recordPaymentFor` as the desk and the portal, so a
 * rupee collected at a meeting and a rupee typed into the grid produce identical
 * rows, identical receipt numbering and identical settlement of arrears.
 */
export const recordRoundPayment = mutation({
  args: {
    roundId: v.id("collectionRounds"),
    memberId: v.optional(v.id("members")),
    amountPaise: v.number(),
    method: v.union(
      v.literal("cash"),
      v.literal("cheque"),
      v.literal("upi"),
      v.literal("card"),
      v.literal("transfer"),
    ),
    paidAt: v.optional(v.string()),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)

    const round = await ctx.db.get(args.roundId)
    if (!round || round.orgId !== actor.orgId) {
      throw new Error("Collection session not found")
    }

    const result = await recordPaymentFor(ctx, actor, {
      memberId: args.memberId,
      fundId: round.fundId,
      amountPaise: args.amountPaise,
      method: args.method,
      paidAt: args.paidAt,
      reference: args.reference,
      roundId: round._id,
      // Cash and cheque collected in one sitting have no provider id to
      // deduplicate on, and are not duplicated by anything but a double tap, so
      // the receipt number is the only identity here. The UI disables the
      // button for the length of one request.
    })

    return { ...result, fundId: round.fundId }
  },
})

/* ------------------------------------------------------------------ reads */

/** One line per method, for "Rs 4,200 from 7 — 3,800 cash, 400 cheque". */
export interface MethodTotal {
  method: "cash" | "cheque" | "upi" | "card" | "transfer"
  amountPaise: number
  count: number
}

function summariseMethods(
  rows: { method: MethodTotal["method"]; amountPaise: number }[],
): MethodTotal[] {
  const byMethod = new Map<MethodTotal["method"], MethodTotal>()
  for (const row of rows) {
    const entry = byMethod.get(row.method) ?? {
      method: row.method,
      amountPaise: 0,
      count: 0,
    }
    entry.amountPaise += row.amountPaise
    entry.count += 1
    byMethod.set(row.method, entry)
  }
  // Cash first: in a collection session it is nearly always the majority, and
  // it is the one the treasurer is counting out in front of people.
  const order: MethodTotal["method"][] = [
    "cash",
    "cheque",
    "upi",
    "card",
    "transfer",
  ]
  return [...byMethod.values()].sort(
    (a, b) => order.indexOf(a.method) - order.indexOf(b.method),
  )
}

/**
 * The collection desk: every session for the unscheduled funds, newest first,
 * each with its own total.
 *
 * This is the read model for the screen M4a exists to deliver — a dated session
 * of cash at a meeting, with a running total and a receipt book, and nothing
 * about it requiring a phone to work or a signal to exist.
 *
 * Capped deliberately. A community that has been running for years has hundreds
 * of sessions and nobody scrolls past the last few months; the query is a
 * window, not the whole history, and it says how much it left out rather than
 * implying the list is complete.
 */
export const rounds = query({
  args: { fundId: v.optional(v.id("funds")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireConsole(ctx)

    const funds = await ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const fundById = new Map(funds.map((f) => [f._id, f]))
    const fundName = new Map(
      funds.map((f) => [f._id as string, f.name as string]),
    )

    let all = await ctx.db
      .query("collectionRounds")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    all = all.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))

    if (args.fundId) all = all.filter((r) => r.fundId === args.fundId)
    const total = all.length
    const cap = Math.min(args.limit ?? 40, total)

    // One index scan for every payment in these sessions rather than one per
    // session. At 40 sessions that is the difference between a single read and
    // forty, and a collection desk is opened in a hurry.
    const sessionIds = new Set(all.slice(0, cap).map((r) => r._id as string))
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const byRound = new Map<string, typeof payments>()
    for (const payment of payments) {
      if (!payment.roundId) continue
      const key = payment.roundId as string
      if (!sessionIds.has(key)) continue
      const list = byRound.get(key) ?? []
      list.push(payment)
      byRound.set(key, list)
    }

    return {
      rounds: all.slice(0, cap).map((round) => {
        const own = byRound.get(round._id) ?? []
        return {
          id: round._id,
          fundId: round.fundId,
          fundName: fundName.get(round.fundId) ?? "",
          date: round.date,
          label: round.label,
          note: round.note ?? null,
          collectionMode: fundById.has(round.fundId)
            ? modeOf(fundById.get(round.fundId)!)
            : ("voluntary" as const),
          totalPaise: sumPaise(own.map((p) => p.amountPaise)),
          paymentCount: own.length,
          memberCount: new Set(
            own.map((p) => p.memberId).filter((m) => m !== undefined),
          ).size,
          methods: summariseMethods(own),
          lastReceiptNo: own.length
            ? own.reduce((a, b) => (a.receiptNo > b.receiptNo ? a : b)).receiptNo
            : null,
        }
      }),
      total,
      shown: cap,
    }
  },
})

/** One session in full: every receipt in it, in the order they were issued. */
export const round = query({
  args: { id: v.id("collectionRounds") },
  handler: async (ctx, args) => {
    const actor = await requireConsole(ctx)

    const session = await ctx.db.get(args.id)
    if (!session || session.orgId !== actor.orgId) {
      throw new Error("Collection session not found")
    }

    const fund = await ctx.db.get(session.fundId)
    if (!fund || fund.orgId !== actor.orgId) {
      throw new Error("Fund not found")
    }

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_round", (q) =>
        q.eq("orgId", actor.orgId).eq("roundId", args.id),
      )
      .collect()
    payments.sort((a, b) => (a.receiptNo < b.receiptNo ? -1 : 1))

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const nameById = new Map(members.map((m) => [m._id as string, m.name as string]))

    return {
      id: session._id,
      fundId: fund._id,
      fundName: fund.name,
      collectionMode: modeOf(fund),
      date: session.date,
      label: session.label,
      note: session.note ?? null,
      collectedBy: session.collectedBy ?? null,
      totalPaise: sumPaise(payments.map((p) => p.amountPaise)),
      paymentCount: payments.length,
      memberCount: new Set(
        payments.map((p) => p.memberId).filter((m) => m !== undefined),
      ).size,
      methods: summariseMethods(payments),
      payments: payments.map((p) => ({
        id: p._id,
        memberId: p.memberId ?? null,
        memberName: p.memberId ? (nameById.get(p.memberId) ?? "") : null,
        amountPaise: p.amountPaise,
        method: p.method,
        paidAt: p.paidAt,
        receiptNo: p.receiptNo,
        reference: p.reference ?? null,
      })),
    }
  },
})

/**
 * The members a treasurer can attribute money to in a session.
 *
 * Active members only. In a collection session "who is in the room" is a
 * question about the living membership, and offering a name belonging to
 * somebody who left three years ago is a way to record a payment against the
 * wrong person.
 */
export const roundMembers = query({
  args: { search: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireTreasurer(ctx)
    const me = await requireConsole(ctx)

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", me.orgId))
      .collect()

    const term = args.search?.trim().toLowerCase() ?? ""
    const matched = members
      .filter((m) => m.isActive)
      .filter(
        (m) =>
          term === "" ||
          m.name.toLowerCase().includes(term) ||
          (m.phone ?? "").toLowerCase().includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.min(args.limit ?? 20, 50))

    return matched.map((m) => ({
      id: m._id,
      name: m.name,
      phone: m.phone ?? null,
    }))
  },
})

export const createPledge = mutation({
  args: {
    fundId: v.id("funds"),
    memberId: v.optional(v.id("members")),
    amountPledgedPaise: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    assertPositive(args.amountPledgedPaise, "Pledged amount")

    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")

    if (!hasPledges(fund)) {
      throw new Error(
        `"${fund.name}" is ${modeOf(fund)}, so it is not raised on pledges.`,
      )
    }

    if (args.memberId) {
      const member = await ctx.db.get(args.memberId)
      if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")
    }

    const id = await ctx.db.insert("pledges", {
      orgId: actor.orgId,
      fundId: args.fundId,
      memberId: args.memberId,
      amountPledgedPaise: args.amountPledgedPaise,
      status: "promised",
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: "pledge.created",
      entityType: "pledge",
      entityId: id,
      details: `${fund.name} — ${args.amountPledgedPaise} paise`,
    })

    return id
  },
})

/**
 * Close a pledge out.
 *
 * Marking it fulfilled does not move money — the money moves when a payment is
 * recorded. This only records that the promise is settled, so a pledge list
 * does not keep nagging about money that has already arrived.
 */
export const setPledgeStatus = mutation({
  args: {
    pledgeId: v.id("pledges"),
    status: v.union(
      v.literal("promised"),
      v.literal("partial"),
      v.literal("fulfilled"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const pledge = await ctx.db.get(args.pledgeId)
    if (!pledge || pledge.orgId !== actor.orgId) throw new Error("Pledge not found")

    await ctx.db.patch(args.pledgeId, { status: args.status })

    await recordAudit(ctx, actor, {
      action: "pledge.status",
      entityType: "pledge",
      entityId: args.pledgeId,
      details: `marked ${args.status}`,
    })

    return args.pledgeId
  },
})
