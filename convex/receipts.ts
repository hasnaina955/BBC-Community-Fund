import { query } from "./_generated/server"
import { v } from "convex/values"
import { requireMember } from "./lib/authz"

/**
 * The data behind a printable receipt, and the only place that decides whether
 * the caller may have it.
 *
 * ## Why a query and not an HTTP route
 *
 * This started life as an `httpAction` on `/receipt/:id`, which is the obvious
 * shape for "give me a document at a URL". It does not work here, and the reason
 * is worth keeping: **the local Convex backend this project develops against
 * serves no HTTP routes at all.** A trivial `path: "/ping"` route returning a
 * fixed string 404s, as do Convex Auth's own registered HTTP routes, so the
 * absence is not a bug in this app's router. (Convex documents local deployments
 * as having "no public URL" and being for local use only.) A receipt that only
 * works against a cloud deployment is a receipt that only works for the
 * deployment, which is the wrong trade for a community office.
 *
 * Going through a normal query is also the better experience for the person
 * holding the phone. A receipt is a *document*, and what a member wants from a
 * document on Android is the system print sheet — Save as PDF, Share, Send to
 * WhatsApp — which `window.print()` hands them directly. Fetching an HTML blob
 * and saving it by hand gets none of that, and would need an `Authorization`
 * header that a plain `<a href>` cannot send.
 *
 * ## Authorization
 *
 * The caller is resolved from the session, never from the arguments. A member may
 * have their own receipts; a treasurer may have any. Both checks resolve through
 * the same `members.userId` join the portal read models use.
 *
 * A receipt that exists but is not yours returns `null`, exactly as one that does
 * not exist does. Distinguishing them would let someone probe for valid payment
 * ids and learn that a payment exists, for whom, and when.
 */
export const receiptData = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const payment = await ctx.db.get(args.paymentId)
    if (!payment || payment.orgId !== actor.orgId) return null

    const isTreasurer =
      actor.role === "admin" ||
      actor.role === "treasurer" ||
      actor.role === "fund_manager"

    if (!isTreasurer) {
      const own = await ctx.db
        .query("members")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", actor.orgId).eq("userId", actor.userId),
        )
        .first()
      if (!own || own._id !== payment.memberId) return null
    }

    const [org, member, fund] = await Promise.all([
      ctx.db.get(payment.orgId),
      payment.memberId ? ctx.db.get(payment.memberId) : null,
      payment.fundId ? ctx.db.get(payment.fundId) : null,
    ])

    return {
      receiptNo: payment.receiptNo,
      amountPaise: payment.amountPaise,
      method: payment.method,
      paidAt: payment.paidAt,
      reference: payment.reference ?? null,
      memberName: member?.name ?? null,
      fundName: fund?.name ?? null,
      orgName: org?.name ?? null,
      // Printed on the document so a member can tell at a glance whether the
      // sheet in their hand is the current one.
      printedAt: new Date().toISOString(),
    }
  },
})
