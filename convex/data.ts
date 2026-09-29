import { query } from "./_generated/server"
import { v } from "convex/values"
import {
  requireActor,
  requireConsole as requireMember,
  type Actor,
} from "./lib/authz"

/**
 * Read models.
 *
 * Every query resolves the actor first and filters by `orgId`, so a client
 * cannot ask for another organisation's data even by guessing an id.
 *
 * One exception, and it is `me` below: identity and role are not console data. A
 * member has to be able to learn that they are a member, and every other query
 * in this file is org-wide committee data, so they take `requireConsole` — the
 * alias means the file's default is the strong gate and the exception is visible.
 */

export const me = query({
  args: {},
  handler: async (ctx) => {
    // Not `requireMember`: this is the one query a plain member must be able to
    // read, because it is what tells them which world they are in. It exposes
    // nothing but their own identity and their own organisation's name.
    const actor = await requireActor(ctx)
    const user = await ctx.db.get(actor.userId)
    const org = await ctx.db.get(actor.orgId)
    return {
      id: user?._id ?? actor.userId,
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: actor.role,
      isActive: user?.isActive ?? true,
      orgName: org?.name ?? "",
      orgSlug: org?.slug ?? "",
      fundIds: actor.fundIds ?? null,
    }
  },
})

export const listUsers = query({
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

export const listBanks = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    return ctx.db
      .query("banks")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
      .then((banks) =>
        banks
          .map((bank) => ({
            id: bank._id,
            name: bank.name,
            branch: bank.branch ?? null,
            accountNumber: bank.accountNumber ?? null,
            ifscCode: bank.ifscCode ?? null,
            upiId: bank.upiId ?? null,
            notes: bank.notes ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
  },
})

export const listFunds = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const funds = await ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return funds
      .map((fund) => ({
        id: fund._id,
        name: fund.name,
        type: fund.type,
        description: fund.description ?? null,
        bankId: fund.bankId ?? null,
        managerId: fund.managerId ?? null,
        targetAmountPaise: fund.targetAmountPaise ?? null,
        isActive: fund.isActive,
        isMemberContribution: fund.isMemberContribution,
        monthlyAmountPaise: fund.monthlyAmountPaise ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const listMembers = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return members
      .filter((m) => args.includeInactive || m.isActive)
      .map((member) => ({
        id: member._id,
        name: member.name,
        phone: member.phone ?? null,
        email: member.email ?? null,
        relation: member.relation ?? null,
        joinedYear: member.joinedYear,
        joinedMonth: member.joinedMonth,
        isActive: member.isActive,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const listContributions = query({
  args: { year: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const contributions = await ctx.db
      .query("contributions")
      .withIndex("by_org_year", (q) =>
        args.year === undefined
          ? q.eq("orgId", actor.orgId)
          : q.eq("orgId", actor.orgId),
      )
      .collect()

    return contributions
      .filter((c) => args.year === undefined || c.year === args.year)
      .map((c) => ({
        id: c._id,
        memberId: c.memberId,
        fundId: c.fundId ?? null,
        year: c.year,
        month: c.month,
        amountPaise: c.amountPaise,
        status: c.status,
        waivedReason: c.waivedReason ?? null,
      }))
  },
})

export const listPayments = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return payments.map((p) => ({
      id: p._id,
      memberId: p.memberId ?? null,
      fundId: p.fundId ?? null,
      bankId: p.bankId ?? null,
      amountPaise: p.amountPaise,
      method: p.method,
      paidAt: p.paidAt,
      collectedBy: p.collectedBy ?? null,
      receiptNo: p.receiptNo,
      reference: p.reference ?? null,
    }))
  },
})

export const listLedgerEntries = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_date", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return entries.map((e) => ({
      id: e._id,
      fundId: e.fundId ?? null,
      bankId: e.bankId ?? null,
      memberId: e.memberId ?? null,
      amountPaise: e.amountPaise,
      direction: e.direction,
      category: e.category,
      effectiveDate: e.effectiveDate,
      source: e.source,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      note: e.note ?? null,
      actorId: e.actorId ?? null,
      lockedTo: e.lockedTo ?? null,
    }))
  },
})

export const listTransactions = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_org_status", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return transactions
      .map((t) => ({
        id: t._id,
        fundId: t.fundId,
        type: t.type,
        amountPaise: t.amountPaise,
        description: t.description,
        category: t.category,
        toFundId: t.toFundId ?? null,
        status: t.status,
        requestedBy: t.requestedBy,
        approvedBy: t.approvedBy ?? null,
        approvalNote: t.approvalNote ?? null,
        transactionDate: t.transactionDate,
      }))
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
  },
})

export const listAuditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const entries = await ctx.db
      .query("auditLog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    return entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, args.limit ?? 50)
      .map((e) => ({
        id: e._id,
        userId: e.userId ?? null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        details: e.details ?? null,
        createdAt: new Date(e.createdAt).toISOString(),
      }))
  },
})

/** Whether the signed-in account has a role that may see the console. */
export const canAccessConsole = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    try {
      await requireActor(ctx)
      return true
    } catch {
      return false
    }
  },
})

export type { Actor }
