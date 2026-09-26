import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireTreasurer } from "./lib/authz"
import { recordAudit, AUDIT } from "./lib/audit"
import { assertPositive, assertPaise } from "./lib/money"
import { fundType, collectionMode } from "./schema"

/**
 * Fund and bank mutations.
 *
 * The legacy build had a `POST /api/admin/reset` that zeroed every balance.
 * There is deliberately no equivalent here: balances are derived from the
 * ledger and cannot be edited. See docs/RECOVERY.md -> flaw 4.
 */

export const createFund = mutation({
  args: {
    name: v.string(),
    type: fundType,
    collectionMode: collectionMode,
    description: v.optional(v.string()),
    bankId: v.optional(v.id("banks")),
    managerId: v.optional(v.id("users")),
    targetAmountPaise: v.optional(v.number()),
    monthlyAmountPaise: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)

    const name = args.name.trim()
    if (name.length < 2) throw new Error("Fund name must be at least 2 characters")

    if (args.targetAmountPaise !== undefined) {
      assertPositive(args.targetAmountPaise, "Target amount")
    }
    if (args.monthlyAmountPaise !== undefined && args.monthlyAmountPaise !== null) {
      assertPaise(args.monthlyAmountPaise, "Monthly amount")
    }

    // A fund that collects a fixed amount per member must say what it is,
    // otherwise the grid and arrears have nothing to work from.
    if (args.collectionMode === "fixed_monthly" && !args.monthlyAmountPaise) {
      throw new Error(
        "A fixed_monthly fund needs a monthly amount per member",
      )
    }
    if (args.bankId) {
      const bank = await ctx.db.get(args.bankId)
      if (!bank || bank.orgId !== actor.orgId) throw new Error("Unknown bank account")
    }
    if (args.managerId) {
      const manager = await ctx.db.get(args.managerId)
      if (!manager || manager.orgId !== actor.orgId) throw new Error("Unknown manager")
    }

    const isMemberContribution = args.collectionMode === "fixed_monthly"

    const id = await ctx.db.insert("funds", {
      orgId: actor.orgId,
      name,
      type: args.type,
      collectionMode: args.collectionMode,
      description: args.description?.trim() || undefined,
      bankId: args.bankId,
      managerId: args.managerId,
      targetAmountPaise: args.targetAmountPaise,
      isActive: true,
      isMemberContribution,
      monthlyAmountPaise: isMemberContribution
        ? args.monthlyAmountPaise
        : undefined,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: AUDIT.fundCreated,
      entityType: "fund",
      entityId: id,
      details: name,
    })

    return id
  },
})

export const updateFund = mutation({
  args: {
    fundId: v.id("funds"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    bankId: v.optional(v.id("banks")),
    managerId: v.optional(v.id("users")),
    targetAmountPaise: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    collectionMode: v.optional(collectionMode),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")

    if (args.targetAmountPaise !== undefined) {
      assertPositive(args.targetAmountPaise, "Target amount")
    }

    const patch: Record<string, unknown> = {}
    if (args.name !== undefined) {
      const name = args.name.trim()
      if (name.length < 2) {
        throw new Error("Fund name must be at least 2 characters")
      }
      patch.name = name
    }
    if (args.description !== undefined) patch.description = args.description || undefined
    if (args.bankId !== undefined) patch.bankId = args.bankId
    if (args.managerId !== undefined) patch.managerId = args.managerId
    if (args.targetAmountPaise !== undefined) {
      patch.targetAmountPaise = args.targetAmountPaise
    }
    if (args.isActive !== undefined) patch.isActive = args.isActive
    if (args.collectionMode !== undefined) {
      patch.collectionMode = args.collectionMode
      // Switching to a periodic fund needs an amount to charge, and switching
      // away from one means the old flag is meaningless.
      patch.isMemberContribution = args.collectionMode === "fixed_monthly"
    }

    await ctx.db.patch(args.fundId, patch)

    await recordAudit(ctx, actor, {
      action: AUDIT.fundUpdated,
      entityType: "fund",
      entityId: args.fundId,
      details: Object.keys(patch).join(", "),
    })

    return args.fundId
  },
})

/**
 * Deactivate rather than delete.
 *
 * A fund with history must not disappear from the books; its transactions and
 * ledger entries keep referring to it.
 */
export const deactivateFund = mutation({
  args: { fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const fund = await ctx.db.get(args.fundId)
    if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")

    await ctx.db.patch(args.fundId, { isActive: false })
    await recordAudit(ctx, actor, {
      action: AUDIT.fundUpdated,
      entityType: "fund",
      entityId: args.fundId,
      details: "Deactivated",
    })

    return args.fundId
  },
})

export const createBank = mutation({
  args: {
    name: v.string(),
    branch: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    ifscCode: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const name = args.name.trim()
    if (name.length < 2) throw new Error("Bank name must be at least 2 characters")

    const id = await ctx.db.insert("banks", {
      orgId: actor.orgId,
      name,
      branch: args.branch?.trim() || undefined,
      accountNumber: args.accountNumber?.trim() || undefined,
      ifscCode: args.ifscCode?.trim().toUpperCase() || undefined,
      notes: args.notes?.trim() || undefined,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: AUDIT.bankCreated,
      entityType: "bank",
      entityId: id,
      details: name,
    })

    return id
  },
})

export const updateBank = mutation({
  args: {
    bankId: v.id("banks"),
    name: v.optional(v.string()),
    branch: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    ifscCode: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const bank = await ctx.db.get(args.bankId)
    if (!bank || bank.orgId !== actor.orgId) throw new Error("Bank not found")

    const patch: Record<string, unknown> = {}
    if (args.name !== undefined) {
      const name = args.name.trim()
      if (name.length < 2) {
        throw new Error("Bank name must be at least 2 characters")
      }
      patch.name = name
    }
    if (args.branch !== undefined) patch.branch = args.branch || undefined
    if (args.accountNumber !== undefined) patch.accountNumber = args.accountNumber || undefined
    if (args.ifscCode !== undefined) {
      patch.ifscCode = args.ifscCode?.trim().toUpperCase() || undefined
    }
    if (args.notes !== undefined) patch.notes = args.notes || undefined

    await ctx.db.patch(args.bankId, patch)
    await recordAudit(ctx, actor, {
      action: AUDIT.bankUpdated,
      entityType: "bank",
      entityId: args.bankId,
      details: Object.keys(patch).join(", "),
    })

    return args.bankId
  },
})

/** Record a reconciliation: ledger balance against a bank statement. */
export const recordReconciliation = mutation({
  args: {
    bankId: v.id("banks"),
    statementDate: v.string(),
    statementBalancePaise: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const bank = await ctx.db.get(args.bankId)
    if (!bank || bank.orgId !== actor.orgId) throw new Error("Bank not found")
    assertPaise(args.statementBalancePaise, "Statement balance")

    // The ledger balance is computed here, server-side, from the entries. It is
    // never accepted from the client — that is the whole point.
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_bank", (q) =>
        q.eq("orgId", actor.orgId).eq("bankId", args.bankId),
      )
      .collect()
    const ledgerBalancePaise = entries.reduce(
      (acc, e) => acc + e.amountPaise,
      0,
    )

    const id = await ctx.db.insert("reconciliations", {
      orgId: actor.orgId,
      bankId: args.bankId,
      statementDate: args.statementDate,
      statementBalancePaise: args.statementBalancePaise,
      ledgerBalancePaise,
      differencePaise: args.statementBalancePaise - ledgerBalancePaise,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: "reconciliation.recorded",
      entityType: "bank",
      entityId: args.bankId,
      details: `Statement ${args.statementBalancePaise} vs ledger ${ledgerBalancePaise}`,
    })

    return { id, ledgerBalancePaise }
  },
})

export const listReconciliations = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireTreasurer(ctx)
    const rows = await ctx.db
      .query("reconciliations")
      .withIndex("by_bank", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return rows
      .sort((a, b) => b.statementDate.localeCompare(a.statementDate))
      .map((r) => ({
        id: r._id,
        bankId: r.bankId,
        statementDate: r.statementDate,
        statementBalancePaise: r.statementBalancePaise,
        ledgerBalancePaise: r.ledgerBalancePaise,
        differencePaise: r.differencePaise,
      }))
  },
})
