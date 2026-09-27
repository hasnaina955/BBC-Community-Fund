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
import { recordPaymentFor } from "./lib/collection"
import { category } from "./schema"

/**
 * Transactions, payments, and the approval workflow.
 *
 * A pending transaction has never touched the ledger. Approval is the moment
 * it does. That is the rule the whole trust story rests on: a request cannot
 * move a balance, and a rejection leaves no trace in the accounts.
 *
 * Fiscal-year close and reconciliation live in `convex/reconciliation.ts`. They
 * used to be here as bare watermark setters with no UI, no entry stamping and no
 * check that the year reconciled first; M2d gave them a home of their own.
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
 *
 * The accounting itself lives in `lib/collection.recordPaymentFor`, because the
 * member portal confirms a claimed payment through the very same function. Two
 * implementations of "money arrives" would drift, and the drift would surface
 * as a balance that does not reconcile.
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
    roundId: v.optional(v.id("collectionRounds")),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    return recordPaymentFor(ctx, actor, args)
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
