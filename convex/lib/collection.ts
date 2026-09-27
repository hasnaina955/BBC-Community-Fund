import type { MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import type { Actor } from "./authz"
import { assertCanWriteFund } from "./authz"
import { recordAudit, AUDIT } from "./audit"
import { assertPositive } from "./money"
import { postEntry } from "./ledger"
import { hasDues } from "./funds"

/**
 * Recording a payment — the one way money arrives.
 *
 * Extracted from `transactions:recordPayment` so that the member portal's
 * mark-as-paid flow can confirm a claimed payment by going through *this* rather
 * than through a second implementation of the same accounting. That is the whole
 * reason it is a shared module and not a helper called from two mutations: a
 * treasurer confirming "yes, he paid ₹500 cash" and a treasurer typing that in at
 * the desk must produce identical rows, identical receipt numbering and identical
 * settlement of arrears. If they were separate code paths they would drift, and
 * the drift would show up as a balance that does not reconcile.
 *
 * Everything that can be wrong with a payment is checked here, once:
 * integer paise, the fund exists and belongs to this organisation, the actor may
 * write to it, the member exists, a collection round belongs to the fund, and a
 * replayed idempotency key does not record the money twice.
 */

export interface RecordPaymentInput {
  memberId?: Id<"members">
  fundId?: Id<"funds">
  amountPaise: number
  method: "cash" | "cheque" | "upi" | "card" | "transfer"
  paidAt?: string
  reference?: string
  roundId?: Id<"collectionRounds">
  idempotencyKey?: string
  note?: string
}

export async function recordPaymentFor(
  ctx: MutationCtx,
  actor: Actor,
  args: RecordPaymentInput,
): Promise<{
  paymentId: Id<"payments">
  receiptNo: string
  unallocatedPaise: number
}> {
  assertPositive(args.amountPaise)

  // A replayed request must not record the money twice.
  if (args.idempotencyKey) {
    const existing = await ctx.db
      .query("payments")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first()
    if (existing) {
      return {
        paymentId: existing._id,
        receiptNo: existing.receiptNo,
        unallocatedPaise: 0,
      }
    }
  }

  if (!args.fundId) {
    throw new Error("Choose a fund for this payment")
  }
  const fund = await ctx.db.get(args.fundId)
  if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
  assertCanWriteFund(actor, args.fundId)

  if (args.memberId) {
    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")
  }

  // A round groups receipts for an unscheduled fund. Rejecting a round on a
  // scheduled fund keeps the two collection styles from being mixed.
  if (args.roundId) {
    const round = await ctx.db.get(args.roundId)
    if (!round || round.orgId !== actor.orgId) {
      throw new Error("Collection session not found")
    }
    if (round.fundId !== args.fundId) {
      throw new Error("That session belongs to a different fund")
    }
  }

  const paidAt = args.paidAt ?? new Date().toISOString()

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
    roundId: args.roundId,
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
    note: args.note ?? `Payment received — ${receiptNo}`,
  })

  // Settle the oldest unpaid contributions first — but only for a fund that
  // actually has dues. On a voluntary or donation fund there is nothing to
  // settle against, and the whole receipt is simply a gift.
  let remaining = args.amountPaise
  if (args.memberId && hasDues(fund)) {
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
      // A part payment settles part of the month and stops there.
      if (covers) remaining -= contribution.amountPaise
      else remaining = 0
    }
  }

  await recordAudit(ctx, actor, {
    action: AUDIT.paymentRecorded,
    entityType: "payment",
    entityId: paymentId,
    details: `${receiptNo} — ${args.amountPaise} paise by ${args.method}`,
  })

  return { paymentId, receiptNo, unallocatedPaise: remaining }
}
