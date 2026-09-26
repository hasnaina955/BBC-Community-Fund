import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireTreasurer } from "./lib/authz"
import { recomputeAll, readAllBalances } from "./lib/balances"
import { recordAudit } from "./lib/audit"

/**
 * The balance invariant, made checkable.
 *
 * Materialised balances are only trustworthy if they can be re-derived from the
 * ledger. `verify` reports any drift without changing anything; `recompute`
 * repairs it. After an eight-year import, running `verify` is how you know the
 * numbers landed correctly.
 */

export const verify = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireTreasurer(ctx)

    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_date", (q) => q.eq("orgId", actor.orgId))
      .collect()

    const truth = new Map<string, number>()
    for (const entry of entries) {
      if (entry.fundId) {
        const key = `fund:${entry.fundId}`
        truth.set(key, (truth.get(key) ?? 0) + entry.amountPaise)
      }
      if (entry.bankId) {
        const key = `bank:${entry.bankId}`
        truth.set(key, (truth.get(key) ?? 0) + entry.amountPaise)
      }
      if (entry.memberId) {
        const key = `member:${entry.memberId}`
        truth.set(key, (truth.get(key) ?? 0) + entry.amountPaise)
      }
    }

    const current = await readAllBalances(ctx.db, actor.orgId)
    const mismatches: Array<{
      scope: string
      materialised: number
      computed: number
      difference: number
    }> = []

    for (const [key, computed] of truth) {
      const materialised = current.get(key) ?? 0
      if (materialised !== computed) {
        mismatches.push({
          scope: key,
          materialised,
          computed,
          difference: materialised - computed,
        })
      }
    }

    return {
      ok: mismatches.length === 0,
      scopesChecked: truth.size,
      ledgerEntries: entries.length,
      mismatches,
    }
  },
})

export const recompute = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireTreasurer(ctx)
    const result = await recomputeAll(ctx, actor)

    if (result.corrected > 0) {
      await recordAudit(ctx, actor, {
        action: "balances.recomputed",
        entityType: "organization",
        entityId: actor.orgId,
        details: `${result.corrected} of ${result.checked} balances corrected from the ledger`,
      })
    }

    return result
  },
})

/** Materialised balances, for the diagnostics screen. */
export const listAll = query({
  args: { scope: v.optional(v.union(v.literal("fund"), v.literal("bank"))) },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const rows = await ctx.db
      .query("balances")
      .withIndex("by_scope", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return rows
      .filter((r) => !args.scope || r.scope === args.scope)
      .map((r) => ({
        id: r._id,
        scope: r.scope,
        scopeId: r.scopeId,
        amountPaise: r.amountPaise,
        updatedAt: r.updatedAt,
      }))
  },
})
