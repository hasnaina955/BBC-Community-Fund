import { mutation } from "./_generated/server"
import { v } from "convex/values"
import { requireTreasurer } from "./lib/authz"
import { recordAudit } from "./lib/audit"
import { assertPositive } from "./lib/money"
import { hasPledges, isUnscheduled, modeOf } from "./lib/funds"

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
