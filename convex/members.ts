import { mutation } from "./_generated/server"
import { v } from "convex/values"
import { requireTreasurer, assertCanWriteFund } from "./lib/authz"
import { recordAudit, AUDIT } from "./lib/audit"
import { assertMonth, assertPaise, assertYear } from "./lib/money"
import { insertMember } from "./lib/members"
import { assertHasDues } from "./lib/funds"

/**
 * Members and the contributions they owe.
 *
 * A contribution is the *obligation*. Recording that money arrived is a
 * payment, and it lives in transactions.ts — the split the legacy model was
 * missing. See docs/ARCHITECTURE.md -> "The three-table split".
 */

export const createMember = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    relation: v.optional(v.string()),
    joinedYear: v.number(),
    joinedMonth: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)

    // The row is written by `insertMember`, which the CSV import calls too —
    // see lib/members.ts. The audit row stays here, because a member added by
    // hand is one event and a batch of two hundred is another.
    const id = await insertMember(ctx, actor.orgId, args)

    await recordAudit(ctx, actor, {
      action: AUDIT.memberCreated,
      entityType: "member",
      entityId: id,
      details: args.name.trim(),
    })

    return id
  },
})

export const updateMember = mutation({
  args: {
    memberId: v.id("members"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    relation: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")

    const patch: Record<string, unknown> = {}
    if (args.name !== undefined) {
      const name = args.name.trim()
      if (name.length < 2) {
        throw new Error("Member name must be at least 2 characters")
      }
      patch.name = name
    }
    if (args.phone !== undefined) patch.phone = args.phone || undefined
    if (args.email !== undefined) patch.email = args.email?.toLowerCase() || undefined
    if (args.relation !== undefined) patch.relation = args.relation || undefined
    if (args.isActive !== undefined) patch.isActive = args.isActive

    await ctx.db.patch(args.memberId, patch)

    await recordAudit(ctx, actor, {
      action: AUDIT.memberUpdated,
      entityType: "member",
      entityId: args.memberId,
      details: Object.keys(patch).join(", "),
    })

    return args.memberId
  },
})

/** Mark a member inactive. Their history is kept, never deleted. */
export const deactivateMember = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")

    await ctx.db.patch(args.memberId, { isActive: false })
    await recordAudit(ctx, actor, {
      action: AUDIT.memberUpdated,
      entityType: "member",
      entityId: args.memberId,
      details: "Marked inactive",
    })

    return args.memberId
  },
})

/** Create one member's obligation for a month. */
export const createContribution = mutation({
  args: {
    memberId: v.id("members"),
    fundId: v.optional(v.id("funds")),
    year: v.number(),
    month: v.number(),
    amountPaise: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")

    assertYear(args.year)
    assertMonth(args.month)
    assertPaise(args.amountPaise, "Contribution amount")
    if (args.amountPaise <= 0) {
      throw new Error("Contribution amount must be greater than zero")
    }
    if (args.fundId) assertCanWriteFund(actor, args.fundId)

    // Only a fund that actually collects a fixed amount may accrue dues. This
    // is what stops a voluntary fund from acquiring a grid or arrears.
    if (args.fundId) {
      const fund = await ctx.db.get(args.fundId)
      if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
      assertHasDues(fund)
    }

    // Proration: a member who joined this year owes nothing for the months
    // before they joined. The legacy model stored `joinedYear` and never used
    // it. See docs/RECOVERY.md -> flaw 3.
    if (
      args.year === member.joinedYear &&
      args.month < member.joinedMonth
    ) {
      throw new Error(
        `${member.name} joined in month ${member.joinedMonth} and owes nothing before then`,
      )
    }

    const existing = await ctx.db
      .query("contributions")
      .withIndex("by_grid", (q) =>
        args.fundId
          ? q.eq("orgId", actor.orgId).eq("year", args.year).eq("fundId", args.fundId)
          : q.eq("orgId", actor.orgId).eq("year", args.year),
      )
      .collect()

    const duplicate = existing.find(
      (c) => c.memberId === args.memberId && c.month === args.month,
    )
    if (duplicate) {
      throw new Error("That contribution already exists for this month")
    }

    const id = await ctx.db.insert("contributions", {
      orgId: actor.orgId,
      memberId: args.memberId,
      fundId: args.fundId,
      year: args.year,
      month: args.month,
      amountPaise: args.amountPaise,
      status: "due",
    })

    await recordAudit(ctx, actor, {
      action: AUDIT.contributionStatus,
      entityType: "contribution",
      entityId: id,
      details: `Created for ${args.year}-${String(args.month).padStart(2, "0")}`,
    })

    return id
  },
})

/**
 * Set a contribution's status.
 *
 * This changes the *obligation*, not the money. Marking a contribution paid
 * does not move a balance — a payment recorded in transactions.ts does. That
 * separation is what lets a member pay two months at once.
 */
export const setContributionStatus = mutation({
  args: {
    contributionId: v.id("contributions"),
    status: v.union(
      v.literal("due"),
      v.literal("paid"),
      v.literal("partial"),
      v.literal("waived"),
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const contribution = await ctx.db.get(args.contributionId)
    if (!contribution || contribution.orgId !== actor.orgId) {
      throw new Error("Contribution not found")
    }
    if (contribution.fundId) assertCanWriteFund(actor, contribution.fundId)

    // Waiving is meaningless for a fund nobody owes.
    if (contribution.fundId) {
      const fund = await ctx.db.get(contribution.fundId)
      if (fund) assertHasDues(fund)
    }

    // A waiver is a decision the committee records, so it needs a reason.
    if (args.status === "waived" && !args.reason?.trim()) {
      throw new Error("A waiver needs a reason")
    }

    const patch: Record<string, unknown> = { status: args.status }
    if (args.status === "waived") {
      patch.waivedReason = args.reason?.trim()
      patch.waivedBy = actor.userId
    } else {
      patch.waivedReason = undefined
      patch.waivedBy = undefined
    }

    await ctx.db.patch(args.contributionId, patch)

    await recordAudit(ctx, actor, {
      action: AUDIT.contributionStatus,
      entityType: "contribution",
      entityId: args.contributionId,
      details: `${contribution.year}-${String(contribution.month).padStart(2, "0")} marked ${args.status}`,
    })

    return args.contributionId
  },
})

/** Bulk update a month, for the "mark everyone paid" button. */
export const setMonthStatus = mutation({
  args: {
    year: v.number(),
    month: v.number(),
    status: v.union(
      v.literal("due"),
      v.literal("paid"),
      v.literal("partial"),
      v.literal("waived"),
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    assertYear(args.year)
    assertMonth(args.month)

    const rows = await ctx.db
      .query("contributions")
      .withIndex("by_org_year", (q) =>
        q.eq("orgId", actor.orgId).eq("year", args.year),
      )
      .collect()

    const targets = rows.filter(
      (c) => c.month === args.month && c.status === "due",
    )
    if (targets.length === 0) {
      throw new Error(`Nothing is unpaid for ${args.month}/${args.year}`)
    }

    for (const row of targets) {
      await ctx.db.patch(row._id, {
        status: args.status,
        waivedReason: args.status === "waived" ? args.reason?.trim() : undefined,
        waivedBy: args.status === "waived" ? actor.userId : undefined,
      })
    }

    await recordAudit(ctx, actor, {
      action: AUDIT.contributionStatus,
      entityType: "contribution",
      details: `${targets.length} contributions for ${args.month}/${args.year} marked ${args.status}`,
    })

    return targets.length
  },
})

/** Build a month of obligations for every active member of a fund. */
export const generateMonth = mutation({
  args: {
    fundId: v.id("funds"),
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    assertCanWriteFund(actor, args.fundId)
    assertYear(args.year)
    assertMonth(args.month)

    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
    // The hard gate: no dues row is ever created for a fund that is not
    // `fixed_monthly`.
    assertHasDues(fund)
    if (!fund.monthlyAmountPaise) {
      throw new Error(
        `"${fund.name}" has no monthly amount set, so there is nothing to charge.`,
      )
    }

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    const existing = await ctx.db
      .query("contributions")
      .withIndex("by_grid", (q) =>
        q.eq("orgId", actor.orgId).eq("year", args.year).eq("fundId", args.fundId),
      )
      .collect()

    const existingKeys = new Set(
      existing.map((c) => `${c.memberId}:${c.month}`),
    )

    const dueDate = new Date(Date.UTC(args.year, args.month - 1, 10))
      .toISOString()
      .slice(0, 10)

    let created = 0
    for (const member of members) {
      if (!member.isActive) continue
      // Proration: skip anyone who had not joined yet.
      if (
        args.year === member.joinedYear &&
        args.month < member.joinedMonth
      ) {
        continue
      }
      const key = `${member._id}:${args.month}`
      if (existingKeys.has(key)) continue

      await ctx.db.insert("contributions", {
        orgId: actor.orgId,
        memberId: member._id,
        fundId: args.fundId,
        year: args.year,
        month: args.month,
        amountPaise: fund.monthlyAmountPaise,
        status: "due",
        dueDate,
      })
      created += 1
    }

    if (created > 0) {
      await recordAudit(ctx, actor, {
        action: AUDIT.contributionStatus,
        entityType: "contribution",
        entityId: args.fundId,
        details: `${created} contributions generated for ${args.month}/${args.year}`,
      })
    }

    return { created, skipped: members.filter((m) => m.isActive).length - created }
  },
})
