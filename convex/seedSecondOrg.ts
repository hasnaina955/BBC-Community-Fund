import { mutation } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { hashSecret } from "./lib/password"

/**
 * A second organisation, so org isolation can be attacked rather than assumed.
 *
 * ## Why this exists
 *
 * Every table is org-scoped and `convex/lib/authz.ts` resolves the caller's org
 * before any handler runs, so isolation is *designed* for. It was not *tested*,
 * and the M6 exit criterion is explicit about the difference: "every query is
 * provably org-scoped (tested, not assumed)".
 *
 * A test needs two orgs with data on both sides. Without this, the only
 * meaningful isolation assertion is "the handler looks like it filters by
 * orgId", which is exactly the assumption the milestone says not to rely on.
 *
 * ## Why it is tiny
 *
 * This is a *target*, not a demo. It needs one admin who can sign in, and one
 * row of each kind worth stealing — a bank, a fund, a member, a payment. It
 * deliberately does not mirror the eight years of history in the demo org: the
 * point is to hold a foreign document id and prove the demo org cannot read it.
 *
 * ## Safety
 *
 * It only ever creates the org whose slug is `SECOND_SLUG`, refuses to run twice
 * (so a re-run cannot duplicate), and never touches the demo organisation. Like
 * `resetDemo` and `seedDemo`, it is deleted before general availability —
 * tracked in docs/ROADMAP.md -> M8.
 *
 *   bunx convex run seedSecondOrg:seedSecondOrg '{"confirm":"seed second org"}'
 */

const SECOND_SLUG = "masjid-committee"
const SECOND_PASSWORD = "community123"
const SECOND_EMAIL = "chairman@masjid.example"
/** Rs 100, the same monthly figure the demo org uses, in paise. */
const MONTHLY = 100 * 100

export const seedSecondOrg = mutation({
  args: { confirm: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.confirm !== "seed second org") {
      throw new Error('Pass { "confirm": "seed second org" } to run this')
    }

    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", SECOND_SLUG))
      .first()
    if (existing) {
      // Return the existing ids rather than just "skipped". The isolation
      // suite needs a real target on every run, and a fixture that could only
      // be used once would make the suite a one-shot instead of a gate.
      const [bank, fund, member] = await Promise.all([
        ctx.db
          .query("banks")
          .withIndex("by_org", (q) => q.eq("orgId", existing._id))
          .first(),
        ctx.db
          .query("funds")
          .withIndex("by_org", (q) => q.eq("orgId", existing._id))
          .first(),
        ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", existing._id))
          .first(),
      ])
      if (!bank || !fund || !member) {
        throw new Error(
          `${SECOND_SLUG} exists but is missing rows the isolation suite needs ` +
            `(bank: ${Boolean(bank)}, fund: ${Boolean(fund)}, member: ${Boolean(member)}). ` +
            "Remove the organisation and re-seed it.",
        )
      }
      const payment = await ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("orgId", existing._id))
        .first()
      return {
        skipped: true,
        orgId: existing._id,
        signInAs: SECOND_EMAIL,
        password: SECOND_PASSWORD,
        ids: {
          bankId: bank._id,
          fundId: fund._id,
          memberId: member._id,
          paymentId: payment?._id ?? null,
        },
      }
    }

    const now = Date.now()
    const year = new Date().getUTCFullYear()
    const month = new Date().getUTCMonth() + 1

    const orgId: Id<"organizations"> = await ctx.db.insert("organizations", {
      name: "Masjid Committee",
      slug: SECOND_SLUG,
      plan: "free",
      createdAt: now,
    })

    // A real sign-in, so the isolation suite can hold a token for this org and
    // point it at the demo org's ids. An org with no account could not prove
    // anything about what its members can see.
    const secret = await hashSecret(SECOND_PASSWORD)
    const adminId: Id<"users"> = await ctx.db.insert("users", {
      name: "Chairman",
      email: SECOND_EMAIL,
      orgId,
      role: "admin",
      isActive: true,
    })
    await ctx.db.insert("authAccounts", {
      userId: adminId,
      provider: "password",
      providerAccountId: SECOND_EMAIL,
      secret,
    })

    const bankId: Id<"banks"> = await ctx.db.insert("banks", {
      orgId,
      name: "Second Org Bank",
      accountNumber: "99999999999",
      ifscCode: "SECO0000001",
      createdAt: now,
    })

    const fundId: Id<"funds"> = await ctx.db.insert("funds", {
      orgId,
      name: "Second Org Fund",
      type: "general",
      collectionMode: "fixed_monthly",
      bankId,
      isActive: true,
      isMemberContribution: true,
      monthlyAmountPaise: MONTHLY,
      createdAt: now,
    })

    const memberId: Id<"members"> = await ctx.db.insert("members", {
      orgId,
      name: "Second Org Member",
      joinedYear: year,
      joinedMonth: 1,
      isActive: true,
      createdAt: now,
    })

    await ctx.db.insert("contributions", {
      orgId,
      memberId,
      fundId,
      year,
      month,
      amountPaise: MONTHLY,
      status: "paid",
    })

    const paidAt = new Date(Date.UTC(year, 0, 15, 10, 30)).toISOString()
    const paymentId: Id<"payments"> = await ctx.db.insert("payments", {
      orgId,
      memberId,
      fundId,
      bankId,
      amountPaise: MONTHLY,
      method: "cash",
      paidAt,
      collectedBy: adminId,
      receiptNo: "S-000001",
      createdAt: Date.now(),
    })

    // The ledger entry is the thing worth stealing: it is the most sensitive
    // row in the system, and a passbook query that leaked it would leak the
    // whole financial position.
    await ctx.db.insert("ledgerEntries", {
      orgId,
      fundId,
      bankId,
      memberId,
      amountPaise: MONTHLY,
      direction: "credit",
      category: "donation",
      effectiveDate: paidAt,
      source: "payment",
      refType: "payment",
      refId: paymentId,
      note: "Second org payment — must never appear in the demo org",
      actorId: adminId,
    })

    for (const [scope, scopeId] of [
      ["fund", fundId],
      ["bank", bankId],
      ["member", memberId],
    ] as const) {
      await ctx.db.insert("balances", {
        orgId,
        scope,
        scopeId,
        amountPaise: MONTHLY,
        updatedAt: now,
      })
    }

    return {
      skipped: false,
      orgId,
      signInAs: SECOND_EMAIL,
      password: SECOND_PASSWORD,
      // The ids the suite will try to read from the other org.
      ids: { bankId, fundId, memberId, paymentId },
    }
  },
})
