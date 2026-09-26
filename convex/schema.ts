import { authTables } from "@convex-dev/auth/server"
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

/**
 * CommunityFund v2 schema — milestone M1.
 *
 * Changes from the legacy Drizzle model (see docs/RECOVERY.md):
 *   - `funds.currentBalance` and `banks.currentBalance` are gone. Balances are
 *     derived from `ledgerEntries`, which is append-only.
 *   - Every money field is integer paise, never a float.
 *   - Everything is scoped to an `organization`, even while there is only one.
 *   - `contributions` (the obligation) is split from `payments` (the payment).
 *   - `auditLog` is a first-class, queryable table.
 *   - The `users` table is Convex Auth's, extended with org scope and role. The
 *     legacy hand-rolled `password` column is gone.
 */

const money = v.number()

export const role = v.union(
  v.literal("admin"),
  v.literal("treasurer"),
  v.literal("fund_manager"),
  v.literal("viewer"),
  v.literal("member"),
)

export const fundType = v.union(
  v.literal("general"),
  v.literal("zakat"),
  v.literal("charity"),
  v.literal("emergency"),
  v.literal("project"),
  v.literal("operational"),
  v.literal("investment"),
)

export const category = v.union(
  v.literal("operations"),
  v.literal("emergency"),
  v.literal("investment"),
  v.literal("donation"),
  v.literal("salary"),
  v.literal("maintenance"),
  v.literal("other"),
)

export default defineSchema({
  ...authTables,

  // Convex Auth's user table, extended with application fields. `orgId`,
  // `role` and `isActive` are optional because Auth creates the row first and
  // the organisation binds it afterwards.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),

    orgId: v.optional(v.id("organizations")),
    role: v.optional(role),
    isActive: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_org", ["orgId"])
    .index("by_org_role", ["orgId", "role"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    plan: v.optional(v.union(v.literal("free"), v.literal("paid"))),
    /**
     * Financial-year close watermark. An entry with an effective date in or
     * before this year is refused by the ledger. Milestone M2.
     */
    closedThrough: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"]),

  banks: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    branch: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    ifscCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  funds: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    type: fundType,
    description: v.optional(v.string()),
    bankId: v.optional(v.id("banks")),
    managerId: v.optional(v.id("users")),
    targetAmountPaise: v.optional(money),
    isActive: v.boolean(),
    isMemberContribution: v.boolean(),
    monthlyAmountPaise: v.optional(money),
    createdAt: v.number(),  })
    .index("by_org", ["orgId"])
    .index("by_org_manager", ["orgId", "managerId"])
    .index("by_org_bank", ["orgId", "bankId"]),

  members: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    relation: v.optional(v.string()),
    joinedYear: v.number(),
    joinedMonth: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_user", ["orgId", "userId"]),

  // The obligation: a member owes this much for this month.
  contributions: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    fundId: v.optional(v.id("funds")),
    year: v.number(),
    month: v.number(),
    amountPaise: money,
    status: v.union(
      v.literal("due"),
      v.literal("paid"),
      v.literal("partial"),
      v.literal("waived"),
    ),
    dueDate: v.optional(v.string()),
    waivedReason: v.optional(v.string()),
    waivedBy: v.optional(v.id("users")),
  })
    .index("by_org_year", ["orgId", "year"])
    .index("by_grid", ["orgId", "year", "fundId"])
    .index("by_member", ["orgId", "memberId"]),

  // The payment: money actually received, and how.
  payments: defineTable({
    orgId: v.id("organizations"),
    memberId: v.optional(v.id("members")),
    fundId: v.optional(v.id("funds")),
    bankId: v.optional(v.id("banks")),
    amountPaise: money,
    method: v.union(
      v.literal("cash"),
      v.literal("cheque"),
      v.literal("upi"),
      v.literal("card"),
      v.literal("transfer"),
    ),
    paidAt: v.string(),
    collectedBy: v.optional(v.id("users")),
    receiptNo: v.string(),
    reference: v.optional(v.string()),
    gatewayPaymentId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_member", ["orgId", "memberId"])
    .index("by_gateway", ["gatewayPaymentId"])
    .index("by_idempotency", ["idempotencyKey"]),

  // The only source of every balance. Append-only.
  ledgerEntries: defineTable({
    orgId: v.id("organizations"),
    fundId: v.optional(v.id("funds")),
    bankId: v.optional(v.id("banks")),
    memberId: v.optional(v.id("members")),
    amountPaise: money,
    direction: v.union(v.literal("credit"), v.literal("debit")),
    category: category,
    effectiveDate: v.string(),
    source: v.union(
      v.literal("opening"),
      v.literal("transaction"),
      v.literal("payment"),
      v.literal("correction"),
      v.literal("transfer"),
    ),
    refType: v.optional(v.string()),
    refId: v.optional(v.string()),
    note: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
    lockedTo: v.optional(v.number()),
  })
    .index("by_fund", ["orgId", "fundId"])
    .index("by_bank", ["orgId", "bankId"])
    .index("by_member", ["orgId", "memberId"])
    .index("by_date", ["orgId", "effectiveDate"])
    .index("by_ref", ["orgId", "refType", "refId"]),

  transactions: defineTable({
    orgId: v.id("organizations"),
    fundId: v.id("funds"),
    type: v.union(
      v.literal("deposit"),
      v.literal("withdrawal"),
      v.literal("transfer_in"),
      v.literal("transfer_out"),
    ),
    amountPaise: money,
    description: v.string(),
    category: category,
    toFundId: v.optional(v.id("funds")),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("completed"),
    ),
    requestedBy: v.id("users"),
    approvedBy: v.optional(v.id("users")),
    approvalNote: v.optional(v.string()),
    transactionDate: v.string(),
    createdAt: v.number(),
  })
    .index("by_org_status", ["orgId", "status"])
    .index("by_fund", ["orgId", "fundId"]),

  reconciliations: defineTable({
    orgId: v.id("organizations"),
    bankId: v.id("banks"),
    statementDate: v.string(),
    statementBalancePaise: money,
    ledgerBalancePaise: money,
    differencePaise: money,
    note: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_bank", ["orgId", "bankId"]),

  auditLog: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    details: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId", "createdAt"])
    .index("by_entity", ["orgId", "entityType", "entityId"]),
})
