import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import {
  assertCanWriteFund,
  assertNotSelfApproval,
  requireActor,
  requireTreasurer,
} from "./lib/authz"
import { recordAudit, AUDIT } from "./lib/audit"
import { assertPaise, assertPositive, nowIso } from "./lib/money"
import { postEntry, postTransfer } from "./lib/ledger"
import { category } from "./schema"

/**
 * Transactions, payments, and the approval workflow.
 *
 * A pending transaction has never touched the ledger. Approval is the moment
 * it does. That is the rule the whole trust story rests on: a request cannot
 * move a balance, and a rejection leaves no trace in the accounts.
 */

export const createTransaction = mutation({
  args: {
    fundId: v.id("funds"),
    type: v.union(
      v.literal("deposit"),
      v.literal("withdrawal"),
      v.literal("transfer_in"),
      v.literal("transfer_out"),
    ),
    amountPaise: v.number(),
    description: v.string(),
    category: category,
    toFundId: v.optional(v.id("funds")),
    transactionDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    assertPositive(args.amountPaise)

    const description = args.description.trim()
    if (description.length < 3) {
      throw new Error("Give the transaction a description")
    }

    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
    assertCanWriteFund(actor, args.fundId)

    if (args.toFundId) {
      const toFund = await ctx.db.get(args.toFundId)
      if (!toFund || toFund.orgId !== actor.orgId) throw new Error("Destination fund not found")
      if (toFund._id === args.fundId) {
        throw new Error("A fund cannot transfer to itself")
      }
    }

    const id = await ctx.db.insert("transactions", {
      orgId: actor.orgId,
      fundId: args.fundId,
      type: args.type,
      amountPaise: args.amountPaise,
      description,
      category: args.category,
      toFundId: args.toFundId,
      status: "pending",
      requestedBy: actor.userId,
      transactionDate: args.transactionDate ?? nowIso(),
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: AUDIT.transactionCreated,
      entityType: "transaction",
      entityId: id,
      details: `${description} — awaiting approval`,
    })

    return id
  },
})

/**
 * Approve a transaction. This is the only place a request becomes a fact.
 *
 * Rejects with a clear error if it was already decided, so a double click
 * cannot post the movement twice.
 */
export const approveTransaction = mutation({
  args: { transactionId: v.id("transactions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const txn = await ctx.db.get(args.transactionId)
    if (!txn || txn.orgId !== actor.orgId) throw new Error("Transaction not found")

    if (txn.status !== "pending") {
      throw new Error(`This transaction was already ${txn.status}`)
    }
    assertNotSelfApproval(txn.requestedBy, actor.userId)
    assertPaise(txn.amountPaise)

    const fund = await ctx.db.get(txn.fundId)
    if (!fund) throw new Error("Fund not found")

    // Refuse to overdraw a fund from an approved withdrawal. Checking the
    // ledger rather than a stored balance means the check and the balance
    // cannot disagree.
    const credit = txn.type === "deposit" || txn.type === "transfer_in"
    if (!credit) {
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) =>
          q.eq("orgId", actor.orgId).eq("fundId", txn.fundId),
        )
        .collect()
      const balance = entries.reduce((acc, e) => acc + e.amountPaise, 0)
      if (balance - txn.amountPaise < 0) {
        throw new Error(
          "This withdrawal is more than the fund's ledger balance",
        )
      }
    }

    const isTransfer =
      txn.type === "transfer_in" || txn.type === "transfer_out"

    if (isTransfer) {
      if (!txn.toFundId) throw new Error("A transfer needs a destination fund")
      const toFund = await ctx.db.get(txn.toFundId)
      if (!toFund) throw new Error("Destination fund not found")
      await postTransfer(ctx, actor, {
        fromFundId: txn.type === "transfer_out" ? txn.fundId : txn.toFundId,
        toFundId: txn.type === "transfer_out" ? txn.toFundId : txn.fundId,
        fromBankId:
          txn.type === "transfer_out"
            ? fund.bankId
            : toFund.bankId,
        toBankId:
          txn.type === "transfer_out"
            ? toFund.bankId
            : fund.bankId,
        amountPaise: txn.amountPaise,
        category: txn.category,
        effectiveDate: txn.transactionDate,
        refType: "transaction",
        refId: txn._id,
        note: txn.description,
      })
    } else {
      await postEntry(ctx, actor, {
        fundId: txn.fundId,
        bankId: fund.bankId,
        amountPaise: credit ? txn.amountPaise : -txn.amountPaise,
        category: txn.category,
        effectiveDate: txn.transactionDate,
        source: "transaction",
        refType: "transaction",
        refId: txn._id,
        note: txn.description,
      })
    }

    await ctx.db.patch(args.transactionId, {
      status: "approved",
      approvedBy: actor.userId,
      approvalNote: args.note?.trim() || txn.approvalNote || undefined,
    })

    await recordAudit(ctx, actor, {
      action: AUDIT.transactionApproved,
      entityType: "transaction",
      entityId: txn._id,
      details: txn.description,
    })

    return args.transactionId
  },
})

export const rejectTransaction = mutation({
  args: { transactionId: v.id("transactions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const txn = await ctx.db.get(args.transactionId)
    if (!txn || txn.orgId !== actor.orgId) throw new Error("Transaction not found")
    if (txn.status !== "pending") {
      throw new Error(`This transaction was already ${txn.status}`)
    }

    // Nothing was ever posted, so rejecting is a status change only.
    await ctx.db.patch(args.transactionId, {
      status: "rejected",
      approvedBy: actor.userId,
      approvalNote: args.note?.trim() || undefined,
    })

    await recordAudit(ctx, actor, {
      action: AUDIT.transactionRejected,
      entityType: "transaction",
      entityId: txn._id,
      details: args.note?.trim() || txn.description,
    })

    return args.transactionId
  },
})

/**
 * Record a payment received — the usual path, cash collected at a meeting.
 *
 * Creates a `payment`, writes the ledger entry that makes the balance true,
 * and settles the member's oldest unpaid contributions against it, oldest
 * first. Allocating to specific months is what allows a member to pay two
 * months at once, which the legacy schema could not represent.
 */
export const recordPayment = mutation({
  args: {
    memberId: v.optional(v.id("members")),
    fundId: v.id("funds"),
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
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    assertPositive(args.amountPaise)

    // A replayed request must not record the money twice.
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("payments")
        .withIndex("by_idempotency", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey),
        )
        .first()
      if (existing) return { paymentId: existing._id, receiptNo: existing.receiptNo }
    }

    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
    assertCanWriteFund(actor, args.fundId)

    if (args.memberId) {
      const member = await ctx.db.get(args.memberId)
      if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")
    }

    const paidAt = args.paidAt ?? nowIso()

    // Receipt numbers are sequential per organisation.
    const recent = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const receiptNo = `R-${String(recent.length + 1).padStart(5, "0")}`

    const paymentId = await ctx.db.insert("payments", {
      orgId: actor.orgId,
      memberId: args.memberId,
      fundId: args.fundId,
      bankId: fund.bankId,
      amountPaise: args.amountPaise,
      method: args.method,
      paidAt,
      collectedBy: actor.userId,
      receiptNo,
      reference: args.reference?.trim() || undefined,
      idempotencyKey: args.idempotencyKey,
      createdAt: Date.now(),
    })

    await postEntry(ctx, actor, {
      fundId: args.fundId,
      bankId: fund.bankId,
      memberId: args.memberId,
      amountPaise: args.amountPaise,
      category: "donation",
      effectiveDate: paidAt,
      source: "payment",
      refType: "payment",
      refId: paymentId,
      note: `Payment received — ${receiptNo}`,
    })

    // Settle the oldest unpaid contributions first.
    let remaining = args.amountPaise
    if (args.memberId) {
      const open = await ctx.db
        .query("contributions")
        .withIndex("by_member", (q) =>
          q.eq("orgId", actor.orgId).eq("memberId", args.memberId!),
        )
        .collect()

      const unpaid = open
        .filter((c) => c.status === "due")
        .sort((a, b) =>
          a.year === b.year ? a.month - b.month : a.year - b.year,
        )

      for (const contribution of unpaid) {
        if (remaining <= 0) break
        const covers = remaining >= contribution.amountPaise
        await ctx.db.patch(contribution._id, {
          status: covers ? "paid" : "partial",
        })
        if (covers) {
          remaining -= contribution.amountPaise
        } else {
          // A part payment settles part of the month and stops there.
          remaining = 0
        }
      }
    }

    await recordAudit(ctx, actor, {
      action: AUDIT.paymentRecorded,
      entityType: "payment",
      entityId: paymentId,
      details: `${receiptNo} — ${args.amountPaise} paise by ${args.method}`,
    })

    return { paymentId, receiptNo, unallocatedPaise: remaining }
  },
})

/**
 * Close a financial year.
 *
 * Sets the organisation watermark. After this, the ledger refuses any entry
 * dated in or before the closed year. Milestone M2 exposes this in the UI.
 */
export const closeFinancialYear = mutation({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100) {
      throw new Error("Year must be between 2000 and 2100")
    }

    const org = await ctx.db.get(actor.orgId)
    if (!org) throw new Error("Organisation not found")

    const current = org.closedThrough ?? 0
    if (args.year <= current) {
      throw new Error(`The books are already closed through ${current}`)
    }
    if (args.year > new Date().getUTCFullYear()) {
      throw new Error("You cannot close a year that has not happened")
    }

    await ctx.db.patch(actor.orgId, { closedThrough: args.year })

    await recordAudit(ctx, actor, {
      action: "financialYear.closed",
      entityType: "organization",
      entityId: actor.orgId,
      details: `Books closed through ${args.year}`,
    })

    return args.year
  },
})

/** Reopen a closed year. Audited, and reserved for admins. */
export const reopenFinancialYear = mutation({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    if (actor.role !== "admin") {
      throw new Error("Only an admin can reopen a closed year")
    }
    const org = await ctx.db.get(actor.orgId)
    if (!org) throw new Error("Organisation not found")
    const current = org.closedThrough ?? 0
    if (args.year !== current) {
      throw new Error(`The books are closed through ${current}`)
    }

    await ctx.db.patch(actor.orgId, { closedThrough: args.year - 1 })

    await recordAudit(ctx, actor, {
      action: "financialYear.reopened",
      entityType: "organization",
      entityId: actor.orgId,
      details: `Books reopened for ${args.year}`,
    })

    return args.year
  },
})

/** Visible to any signed-in user, so a member can read their own passbook. */
export const myMemberRecord = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx)
    const user = await ctx.db.get(actor.userId)
    if (!user) throw new Error("Not signed in")

    const member = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", actor.orgId).eq("userId", actor.userId),
      )
      .first()

    return { memberId: member?._id ?? null, email: user.email ?? "" }
  },
})
