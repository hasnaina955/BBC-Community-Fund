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

/**
 * How a fund is collected. This is the field that stops the app from treating
 * every fund as a monthly levy.
 *
 *   fixed_monthly  every active member owes a fixed amount each period.
 *                  Only this mode has dues, arrears, waivers, a grid, and
 *                  reminders.
 *   voluntary      anyone may give any amount at any time. Nobody owes it, so
 *                  arrears are meaningless — a member who never gives is not a
 *                  defaulter. Anonymous givers are allowed.
 *   pledge_based   money is promised first and paid later (a building project).
 *                  Promises are chased; there is no periodic due.
 *   donation       one-off gifts with no schedule and no member expectation.
 */
export const collectionMode = v.union(
  v.literal("fixed_monthly"),
  v.literal("voluntary"),
  v.literal("pledge_based"),
  v.literal("donation"),
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
  }).index("by_org", ["orgId"]),  funds: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    type: fundType,
    /**
     * Optional only so rows written before this field existed still validate.
     * Reads normalise a missing value to "fixed_monthly" via `modeOf()` in
     * lib/funds.ts. Once real data is loaded this can become required.
     */
    collectionMode: v.optional(collectionMode),
    description: v.optional(v.string()),
    bankId: v.optional(v.id("banks")),
    managerId: v.optional(v.id("users")),
    targetAmountPaise: v.optional(money),
    isActive: v.boolean(),
    /**
     * @deprecated Kept only for the old demo seed. `collectionMode` is the real
     * discriminator now.
     */
    isMemberContribution: v.boolean(),
    monthlyAmountPaise: v.optional(money),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_manager", ["orgId", "managerId"])
    .index("by_org_bank", ["orgId", "bankId"]),

  /**
   * A dated collection session for a fund that has no schedule — e.g. one row
   * per Friday for the voluntary fund. Gives the receipt book a unit to hang
   * off, and lets a session be totalled ("Friday 12 Sep: Rs 4,200 from 7").
   */
  collectionRounds: defineTable({
    orgId: v.id("organizations"),
    fundId: v.id("funds"),
    date: v.string(),
    label: v.string(),
    note: v.optional(v.string()),
    collectedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_org_fund_date", ["orgId", "fundId", "date"])
    .index("by_org", ["orgId"]),

  /**
   * Money promised to a fund before it is received — a reconstruction pledge.
   * This is a promise, not a periodic due, which is why it is its own table
   * rather than a contribution row.
   */
  pledges: defineTable({
    orgId: v.id("organizations"),
    fundId: v.id("funds"),
    memberId: v.optional(v.id("members")),
    amountPledgedPaise: money,
    status: v.union(
      v.literal("promised"),
      v.literal("partial"),
      v.literal("fulfilled"),
      v.literal("cancelled"),
    ),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org_fund", ["orgId", "fundId"])
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_org", ["orgId"]),

  members: defineTable({
    orgId: v.id("organizations"),
    /**
     * The signed-in account this member row belongs to, once claimed or
     * assigned. Milestone M3: this is the join between Convex Auth's identity
     * and the community's own record of a person, and it is what the portal
     * reads to answer "what do I owe?" without ever being told whose record to
     * read.
     */
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
    .index("by_org_user", ["orgId", "userId"])
    // The claim path in M3 looks a member up by the email on their row, and that
    // lookup happens on every sign-in from an unlinked account, so it is an
    // index rather than a scan of the membership.
    .index("by_email", ["orgId", "email"]),

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
    .index("by_member", ["orgId", "memberId"])
    // Arrears are read far more often than dues are written, and only unpaid
    // rows are ever wanted. This index keeps an arrears query proportional to
    // the number of defaulters rather than to eight years of history.
    .index("by_open", ["orgId", "status", "year"])
    .index("by_org", ["orgId"]),

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
    /** Which collection session this belongs to, for unscheduled funds. */
    roundId: v.optional(v.id("collectionRounds")),
    gatewayPaymentId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_member", ["orgId", "memberId"])
    .index("by_round", ["orgId", "roundId"])
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
    // The fund-detail screen's "where the money went" chart needs one year of
    // one fund's debits. Without the date in this index that is every entry the
    // fund has ever had, which at eight years is six thousand documents and
    // several seconds.
    .index("by_fund_date", ["orgId", "fundId", "effectiveDate"])
    .index("by_ref", ["orgId", "refType", "refId"])
    // Prefix-only scan of one organisation's entries. Used by the ledger
    // rebuild (`balances.recomputeAll`) and by the demo reset, both of which
    // need every entry and so cannot narrow to one fund, bank or year.
    .index("by_org", ["orgId"]),

  /**
   * A member telling us they have already paid.
   *
   * Most collection in this community is cash handed over at a meeting or to a
   * collector at someone's door. The money is real and the member's word is
   * usually right, but a product holding community money cannot take someone's
   * word for it and write it into the ledger — so this is a *request*, held
   * until a treasurer confirms it. Approval is the moment the payment, the
   * receipt and the ledger entry exist; until then nothing in the books moves.
   *
   * That is the same separation of duties `transactions` already models, applied
   * to the case where the requester is the person who paid.
   */
  paymentRequests: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    fundId: v.optional(v.id("funds")),
    amountPaise: money,
    method: v.union(
      v.literal("cash"),
      v.literal("cheque"),
      v.literal("upi"),
      v.literal("card"),
      v.literal("transfer"),
    ),
    /** When the member says they paid. ISO string, as everywhere else. */
    paidAt: v.string(),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    requestedBy: v.id("users"),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    /** Set on approval — the payment this request became. */
    paymentId: v.optional(v.id("payments")),
    createdAt: v.number(),
  })
    .index("by_org_status", ["orgId", "status"])
    .index("by_member", ["orgId", "memberId"])
    // The member's own list of requests, newest first, without reading the whole
    // org's queue.
    .index("by_requester", ["orgId", "requestedBy", "createdAt"])
    .index("by_org", ["orgId"]),

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
    .index("by_fund", ["orgId", "fundId"])
    .index("by_org", ["orgId"]),

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
  })
    .index("by_bank", ["orgId", "bankId"])
    .index("by_org", ["orgId"]),

  /**
   * Materialised balances, one row per fund, per bank, per member, and per
   * bank-year.
   *
   * This is NOT a return to the legacy `current_balance` design. The difference
   * is that these are:
   *   1. updated inside the same transaction that writes the ledger entry, so
   *      they cannot drift from the entries, and
   *   2. rebuildable from `ledgerEntries` at any time by
   *      `balances.recomputeAll`, which is also how they are verified.
   *
   * The reason for materialising: a single-pass SUM over the ledger reads every
   * entry, and Convex caps a query at 16384 documents. At eight years of history
   * the ledger is already around 13k entries, so summing on read would be at
   * the limit and would break as more years arrive.
   *
   * The invariant is unchanged and still checkable: a balance must equal the
   * sum of its entries. See docs/ARCHITECTURE.md -> "The ledger".
   */
  balances: defineTable({
    orgId: v.id("organizations"),
    // `bank_year` is a per-year movement total rather than a balance:
    // `scopeId` is `${bankId}:${year}` and the amount is the net movement
    // through that account during that year. It exists so a historical bank
    // passbook can work out its opening balance from a handful of rows instead
    // of re-reading every entry since that year — see aggregate:bankPassbook.
    // An entry only ever touches the year it is dated in, so the write path
    // stays O(1) no matter how far back it is dated.
    scope: v.union(
      v.literal("fund"),
      v.literal("bank"),
      v.literal("member"),
      v.literal("bank_year"),
    ),
    scopeId: v.string(),
    amountPaise: money,
    updatedAt: v.number(),
  })
    .index("by_scope", ["orgId", "scope"])
    .index("by_org", ["orgId"]),

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

  /**
   * Per-organisation named counters.
   *
   * A `receipt` counter is what the receipt number comes from. It exists because
   * the previous derivation — `R-${payments.length + 1}` — was wrong twice over,
   * and the second fault is the one that could not be noticed:
   *
   *   1. **It was a full-table scan on the hottest write in the app.** Recording
   *      a payment read every payment the organisation had. The seed is already at
   *      about 9,955 rows and Convex caps a query at 16,384, so at roughly twice
   *      the seeded history — 500 members over 12 months, which the roadmap names
   *      as the scale to hold — `recordPayment` would stop working entirely. The
   *      ledger and the contributions grid already avoid this limit; this one
   *      was missed, and the fact that a member's proof of payment depends on it
   *      makes it the most expensive kind of miss.
   *
   *   2. **A count is not a sequence.** Two payments recorded before either
   *      committed both read `n + 1` and both wrote `R-00n`. Convex serialises
   *      mutations per document, not across documents, so nothing stopped it. A
   *      collection round is the worst case by design: a treasurer tapping cash
   *      in a row is exactly the burst that widens the window. Two members holding
   *      the same receipt number is not a cosmetic problem in a book that has to
   *      reconcile.
   *
   * The counter is incremented and read in the same mutation that writes the
   * payment, so it cannot collide. `value` is a strictly increasing integer and
   * is never derived from a row count again.
   */
  counters: defineTable({
    orgId: v.id("organizations"),
    /** Currently only `receipt`. Named rather than a table per sequence. */
    scope: v.string(),
    value: v.number(),
    updatedAt: v.number(),
  }).index("by_org_scope", ["orgId", "scope"]),

  /**
   * An online collection attempt, created before the provider is called.
   *
   * The amount on this row is the amount *we* intend to collect, resolved on the
   * server from the member's open contributions. The amount that comes back on a
   * provider's event is a different number and is never trusted to decide what
   * was paid — this row is what a confirmation is matched against, and a
   * mismatch is an exception rather than a credit. See docs/M4-PLAN.md.
   *
   * The tables below all exist now, while the provider choice is still open, so
   * that choosing one is a dropped-in file rather than a migration. Nothing reads
   * them yet.
   */
  gatewayIntents: defineTable({
    orgId: v.id("organizations"),
    provider: v.string(),
    /** The provider's own handle — an order id, in every candidate's terms. */
    providerId: v.string(),
    memberId: v.optional(v.id("members")),
    fundId: v.optional(v.id("funds")),
    roundId: v.optional(v.id("collectionRounds")),
    amountPaise: money,
    /**
     * Which contributions this attempt is meant to settle, resolved up front.
     * Stored so the confirmation does not have to re-derive it, and so a
     * treasurer can see what a member was actually asked to pay.
     */
    contributionIds: v.array(v.id("contributions")),
    status: v.union(
      v.literal("created"),
      v.literal("captured"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_provider_id", ["orgId", "provider", "providerId"])
    .index("by_member", ["orgId", "memberId"]),

  /**
   * Every event a provider has told us about, claimed before it is acted on.
   *
   * The `eventId` is the provider's own unique id for the event and is the
   * replay key: a row is written *before* the payment is recorded, so a duplicate
   * delivery finds a row it wrote last time and is acknowledged and discarded. A
   * check performed after recording the money has a window in which two copies
   * both pass it, and that window is exactly when a duplicated webhook
   * double-counts a payment and destroys trust in the books.
   *
   * `received` / `processed` / `failed` exist so a crash between claiming an
   * event and finishing it leaves a visible leftover rather than a silently lost
   * payment.
   */
  gatewayEvents: defineTable({
    orgId: v.id("organizations"),
    provider: v.string(),
    eventId: v.string(),
    kind: v.string(),
    outcome: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("ignored"),
    ),
    intentId: v.optional(v.id("gatewayIntents")),
    providerPaymentId: v.optional(v.string()),
    amountPaise: money,
    /** Why an event was refused or ignored. Never absent for a failure. */
    reason: v.optional(v.string()),
    status: v.union(
      v.literal("received"),
      v.literal("processed"),
      v.literal("failed"),
    ),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_event", ["orgId", "provider", "eventId"])
    .index("by_org_received", ["orgId", "receivedAt"])
    .index("by_intent", ["orgId", "intentId"]),

  /**
   * Money arriving from the provider in a bank account.
   *
   * A captured online payment and a bank credit are two different moments, a day
   * or so apart, and only the second one may move a balance in a bank account.
   * The provider's payout id is the key so that re-importing an overlapping
   * settlement report writes the bank leg once — which it will, because those
   * reports overlap by design.
   */
  settlements: defineTable({
    orgId: v.id("organizations"),
    bankId: v.optional(v.id("banks")),
    provider: v.string(),
    providerPayoutId: v.string(),
    amountPaise: money,
    feePaise: money,
    /** ISO date the money landed, as the provider reports it. */
    settledOn: v.string(),
    createdAt: v.number(),
  })
    .index("by_payout", ["orgId", "provider", "providerPayoutId"])
    .index("by_bank_date", ["orgId", "bankId", "settledOn"])
    .index("by_org", ["orgId"]),
})
