import { query } from "./_generated/server"
import { v } from "convex/values"
import type { QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { requireTreasurer } from "./lib/authz"
import { EXPORT_FILES, type ExportKey } from "./lib/exportfiles"
import { modeOf } from "./lib/funds"

/**
 * Taking a community's records away.
 *
 * ## One file per call, and that is not a UI preference
 *
 * M2b exists because M1 shipped eight years of history to the browser and two of
 * its read models stopped returning at all. An export is the one screen that has
 * to send the history *by definition* — that is what a community is asking for —
 * so the only thing that keeps it honest is granularity: a treasurer asks for one
 * file, and the response carries one file. Asking for the ledger does not also
 * ship the audit log.
 *
 * The screen therefore loads none of this on mount. It renders the list from
 * `files`, which is a few strings per file, and rows are fetched when a button is
 * pressed.
 *
 * ## Reads, never writes, and never a second rule
 *
 * Nothing here writes. `contributions.csv` reports the status the grid holds
 * rather than recomputing what it should be, and the ledger is exported as
 * stored — a debit is already a negative amount, because `postEntry` derives
 * `direction` from the sign, so the ledger column is the number the ledger
 * holds, which is what makes it re-importable.
 */

const exportKey = v.union(
  v.literal("members"),
  v.literal("contributions"),
  v.literal("payments"),
  v.literal("ledger"),
  v.literal("funds"),
  v.literal("banks"),
  v.literal("transactions"),
  v.literal("audit"),
)

type Row = Record<string, string | number | boolean | null>

/**
 * Paise as rupees, for a column a spreadsheet has to be able to sum.
 *
 * `null` when there is no amount at all, which writes an empty cell: a fund with
 * no target has no target, and writing `0` would say it had one and had reached
 * it. Not a formatted string — the check suite already asserts that a money
 * column a spreadsheet cannot add up is a broken export.
 */
function rupees(paise: number | undefined | null): number | null {
  return paise === undefined || paise === null ? null : paise / 100
}

/** Everything the name lookups need. Four small reads, whatever the file. */
async function loadNames(ctx: { db: QueryCtx["db"] }, orgId: Id<"organizations">) {
  const [funds, banks, members, users] = await Promise.all([
    ctx.db.query("funds").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("banks").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("users").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ])

  return {
    funds,
    banks,
    fundName: new Map(funds.map((f) => [f._id, f.name])),
    bankName: new Map(banks.map((b) => [b._id, b.name])),
    memberName: new Map(members.map((m) => [m._id, m.name])),
    userName: new Map(users.map((u) => [u._id, u.name ?? u.email ?? ""])),
  }
}

/** One row per record, in the columns `lib/exportfiles.ts` declares. */
async function rowsFor(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
  key: ExportKey,
  names: Names,
): Promise<Row[]> {
  const { fundName, bankName, memberName, userName } = names

  switch (key) {
    case "members": {
      const rows = await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
      return rows.map((m) => ({
        name: m.name,
        email: m.email ?? null,
        phone: m.phone ?? null,
        relation: m.relation ?? null,
        joined_year: m.joinedYear,
        joined_month: m.joinedMonth,
      }))
    }

    case "contributions": {
      const rows = await ctx.db
        .query("contributions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
      return rows.map((c) => ({
        member: memberName.get(c.memberId) ?? null,
        fund: c.fundId ? (fundName.get(c.fundId) ?? null) : null,
        year: c.year,
        month: c.month,
        amount: rupees(c.amountPaise),
        // The status the grid holds, not one recomputed from payments. A month
        // marked paid by hand has no payment behind it, and that is a fact about
        // this community's records rather than a fault to correct on the way out.
        status: c.status,
        due_date: c.dueDate ?? null,
        waived_reason: c.waivedReason ?? null,
      }))
    }

    case "payments": {
      const rows = await ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
      return rows.map((p) => ({
        amount: rupees(p.amountPaise),
        // The date as stored. The import reads a date and records the payment at
        // noon on it, so a round trip preserves the day and not the clock time —
        // which is what the import does with any file it reads.
        paid_at: p.paidAt,
        member: p.memberId ? (memberName.get(p.memberId) ?? null) : null,
        fund: p.fundId ? (fundName.get(p.fundId) ?? null) : null,
        bank: p.bankId ? (bankName.get(p.bankId) ?? null) : null,
        method: p.method,
        receipt: p.receiptNo,
        reference: p.reference ?? null,
      }))
    }

    case "ledger": {
      const rows = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
      return rows.map((e) => ({
        // Signed, as stored — see the note at the top of this file.
        amount: e.amountPaise / 100,
        date: e.effectiveDate,
        fund: e.fundId ? (fundName.get(e.fundId) ?? null) : null,
        bank: e.bankId ? (bankName.get(e.bankId) ?? null) : null,
        member: e.memberId ? (memberName.get(e.memberId) ?? null) : null,
        category: e.category,
        note: e.note ?? null,
        source: e.source,
      }))
    }

    case "funds":
      return names.funds.map((f) => ({
        name: f.name,
        type: f.type,
        collection_mode: modeOf(f),
        description: f.description ?? null,
        bank: f.bankId ? (bankName.get(f.bankId) ?? null) : null,
        target_amount: rupees(f.targetAmountPaise),
        monthly_amount: rupees(f.monthlyAmountPaise),
        member_contribution: f.isMemberContribution,
        is_active: f.isActive,
      }))

    case "banks":
      return names.banks.map((b) => ({
        name: b.name,
        branch: b.branch ?? null,
        account_number: b.accountNumber ?? null,
        ifsc_code: b.ifscCode ?? null,
        upi_id: b.upiId ?? null,
        notes: b.notes ?? null,
      }))

    case "transactions": {
      const rows = await ctx.db
        .query("transactions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
      return rows.map((t) => ({
        fund: fundName.get(t.fundId) ?? null,
        type: t.type,
        amount: rupees(t.amountPaise),
        category: t.category,
        description: t.description,
        status: t.status,
        requested_by: userName.get(t.requestedBy) ?? null,
        approved_by: t.approvedBy ? (userName.get(t.approvedBy) ?? null) : null,
        transaction_date: t.transactionDate,
        approval_note: t.approvalNote ?? null,
      }))
    }

    case "audit": {
      // Oldest first, which is the order the index already holds.
      const rows = await ctx.db
        .query("auditLog")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
      return rows.map((a) => ({
        when: new Date(a.createdAt).toISOString(),
        actor: a.userId ? (userName.get(a.userId) ?? null) : null,
        action: a.action,
        entity_type: a.entityType,
        entity_id: a.entityId ?? null,
        details: a.details ?? null,
        ip: a.ip ?? null,
        user_agent: a.userAgent ?? null,
      }))
    }
  }
}


type Names = Awaited<ReturnType<typeof loadNames>>

/**
 * What can be taken away, without taking any of it.
 *
 * The screen renders from this: the files, what is in each, and whether it can
 * be imported somewhere else. No rows, so opening the screen costs nothing
 * however long the books are.
 */
export const files = query({
  args: {},
  handler: async (ctx) => {
    await requireTreasurer(ctx)
    return EXPORT_FILES.map((f) => ({
      key: f.key,
      filename: f.filename,
      title: f.title,
      description: f.description,
      // The kind that reads it back rather than a boolean, so the screen can say
      // *what* reads it — "payments" tells a treasurer more than "yes".
      readsBackAs: f.readsBackAs,
      notImportableBecause: f.notImportableBecause ?? null,
    }))
  },
})

/**
 * One file's rows.
 *
 * The columns come from the same definitions the check suite holds the import
 * to, so the file and the contract cannot disagree.
 */
export const file = query({
  args: { key: exportKey },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const spec = EXPORT_FILES.find((f) => f.key === args.key)
    if (!spec) throw new Error("No such file")

    const names = await loadNames(ctx, actor.orgId)
    const rows = await rowsFor(ctx, actor.orgId, args.key, names)

    return { filename: spec.filename, columns: spec.columns, rows }
  },
})
