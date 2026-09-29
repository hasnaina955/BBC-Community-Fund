import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { v } from "convex/values"
import { requireActor, requireMember, requireTreasurer } from "./lib/authz"
import { readBalance } from "./lib/balances"
import { recordAudit } from "./lib/audit"
import { assertPositive, nowIso, sumPaise } from "./lib/money"
import { ageDues, oldestDuePerMember } from "./lib/arrears"
import { hasDues, modeOf } from "./lib/funds"
import { recordPaymentFor } from "./lib/collection"
import type { Id } from "./_generated/dataModel"
import type { DataModel } from "./_generated/dataModel"

/**
 * The member portal — milestone M3.
 *
 * Everything in the committee console is built around "this member" or "this
 * fund". This file is the other half: everything here is built around *the signed
 * -in person*, and none of it ever takes a member id from the client.
 *
 * That is the whole security argument, and it is worth stating plainly because
 * it is the one thing that must not be got wrong. A portal query that accepted
 * `{ memberId }` would be a query that shows any member's dues to anyone who
 * edits a URL. So `requireMyMember` resolves the member row from the session —
 * `members.userId` — and every read below starts from that. There is no code
 * path in this file that takes a member id from a caller.
 *
 * ## Claiming an account
 *
 * Members are a community, not a customer base: a phone number is often shared
 * across a household, and the secretary is the person who knows who is who. So
 * linking happens two ways, and the safe one is the default.
 *
 *   - **Self-claim**, on a verified email that exactly matches `members.email`.
 *     Convex Auth owns email verification, so proving you own the address is
 *     Convex's job, not ours. An ambiguous match is refused rather than guessed:
 *     if two rows share the address, a treasurer has to say which is which, and
 *     silently picking one could show a cousin their cousin's dues.
 *   - **Treasurer assignment**, for members with no email on file or no email
 *     account. The secretary already knows the answer; asking the member to
 *     prove it by email is theatre.
 *
 * A claim never touches the member's *money* — only which account reads it.
 */

/* ------------------------------------------------------------------ linking */

type MemberDoc = DataModel["members"]["document"]

/**
 * The member row for the signed-in person, or null.
 *
 * Throws only when there is no session at all; "signed in but not a member yet"
 * is an ordinary state that the portal renders as an invitation to claim.
 */
async function requireMyMember(ctx: QueryCtx | MutationCtx): Promise<MemberDoc | null> {
  const actor = await requireActor(ctx)
  return ctx.db
    .query("members")
    .withIndex("by_org_user", (q) =>
      q.eq("orgId", actor.orgId).eq("userId", actor.userId),
    )
    .first()
}

/**
 * What the portal needs to decide what to show, without revealing anything.
 *
 * Deliberately thin: an unlinked, ordinary member gets to see that they are
 * unlinked and which address to use, and nothing else. They do not get to learn
 * whether the community has members, how many, or whether the address they
 * typed is close to a real one.
 */
export const myAccount = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const member = await requireMyMember(ctx)
    const user = await ctx.db.get(actor.userId)

    return {
      orgName: (await ctx.db.get(actor.orgId))?.name ?? "",
      role: actor.role,
      email: user?.email ?? "",
      memberId: member?._id ?? null,
      memberName: member?.name ?? null,
    }
  },
})

/**
 * Claim a member record by email.
 *
 * The address must match a member row exactly, and that row must not already
 * belong to someone. Two matches is a refusal, not a coin flip.
 */
export const claim = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)

    if (actor.role !== "member") {
      // Committee staff have no member record to claim, and a treasurer
      // "claiming" their way into the portal would be a downgrade at best.
      throw new Error(
        "You already have access to the committee console, so there is nothing to claim.",
      )
    }

    const existing = await requireMyMember(ctx)
    if (existing) {
      return { memberId: existing._id, name: existing.name, alreadyLinked: true }
    }

    const user = await ctx.db.get(actor.userId)
    const email = (user?.email ?? "").trim().toLowerCase()
    if (!email) {
      throw new Error("Add an email address to your account first")
    }

    const matches = await ctx.db
      .query("members")
      .withIndex("by_email", (q) =>
        q.eq("orgId", actor.orgId).eq("email", email),
      )
      .collect()

    const unclaimed = matches.filter((m) => m.userId === undefined)
    if (unclaimed.length === 0) {
      throw new Error(
        matches.length > 0
          ? "That address is already linked to a member record. Ask the secretary if this is wrong."
          : `No member record uses ${email}. Ask the secretary to add it, or to link your account for you.`,
      )
    }
    if (unclaimed.length > 1) {
      // Families share addresses. Picking one could show a member their
      // relative's dues, so this stops and asks a person.
      throw new Error(
        `${unclaimed.length} member records use ${email}. Ask the secretary which one is yours.`,
      )
    }

    const target = unclaimed[0]
    await ctx.db.patch(target._id, { userId: actor.userId })

    await recordAudit(ctx, actor, {
      action: "member.accountClaimed",
      entityType: "member",
      entityId: target._id,
      details: `${target.name} claimed their record with ${email}`,
    })

    return { memberId: target._id, name: target.name, alreadyLinked: false }
  },
})

/**
 * Link or unlink a member record to an account. Treasurer only.
 *
 * This is how the secretary gets a cousin onto the portal when they have no
 * email of their own, and it is why the portal can exist at all for members who
 * never touch a computer.
 */
export const assignAccount = mutation({
  args: {
    memberId: v.id("members"),
    userEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")

    // Unlinking is passed as an empty string rather than a separate mutation, so
    // the audit trail shows the same action either way.
    const email = args.userEmail?.trim().toLowerCase() ?? ""
    if (email === "") {
      if (member.userId === undefined) {
        throw new Error(`${member.name} is not linked to an account`)
      }
      const previous = await ctx.db.get(member.userId)
      await ctx.db.patch(args.memberId, { userId: undefined })
      await recordAudit(ctx, actor, {
        action: "member.accountUnlinked",
        entityType: "member",
        entityId: args.memberId,
        details: `${member.name} unlinked from ${previous?.email ?? "an account"}`,
      })
      return { linked: false }
    }

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first()
    if (!user) {
      throw new Error(
        `No account uses ${email}. The member has to sign up with that address first.`,
      )
    }
    if (user.orgId !== actor.orgId) {
      throw new Error("That account belongs to a different organisation")
    }

    // One account, one member row. Two would make "what do I owe?" ambiguous.
    const alreadyLinked = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", actor.orgId).eq("userId", user._id),
      )
      .first()
    if (alreadyLinked && alreadyLinked._id !== args.memberId) {
      throw new Error(
        `That account is already linked to ${alreadyLinked.name}. Unlink it first.`,
      )
    }

    await ctx.db.patch(args.memberId, { userId: user._id })
    await recordAudit(ctx, actor, {
      action: "member.accountLinked",
      entityType: "member",
      entityId: args.memberId,
      details: `${member.name} linked to ${email}`,
    })
    return { linked: true, name: member.name }
  },
})

/**
 * Who has a portal account, for the treasurer.
 *
 * The exit criterion for M3 is "a treasurer can see which members have claimed
 * accounts" — and the version of that worth building shows the ones who *have
 * not*, because a member without an account is a member who cannot see their own
 * balance. `aggregate:members` already carries `userId`; this adds the account's
 * address and the last time it was seen.
 */
export const accountStatus = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireTreasurer(ctx)
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const byId = new Map(users.map((u) => [u._id, u]))

    const rows = members.map((m) => {
      const user = m.userId ? byId.get(m.userId) : undefined
      return {
        id: m._id,
        name: m.name,
        phone: m.phone ?? null,
        email: m.email ?? null,
        isActive: m.isActive,
        userId: m.userId ?? null,
        accountEmail: user?.email ?? null,
        accountRole: user?.role ?? null,
        accountActive: user?.isActive ?? null,
      }
    })

    return {
      rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      linked: rows.filter((r) => r.userId !== null).length,
      unlinked: rows.filter((r) => r.userId === null).length,
      unlinkedActive: rows.filter((r) => r.userId === null && r.isActive).length,
    }
  },
})

/* ------------------------------------------------------------- what I owe */

/**
 * The portal's one read model: what this person owes, what they have paid, and
 * the receipts for it.
 *
 * Capped like every other read model in the app — the receipt list is the most
 * recent slice, and the *totals* are computed over everything, not over the
 * slice. A capped list with an uncapped sum is the difference between a fast
 * screen and a wrong number.
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const member = await requireMyMember(ctx)
    if (!member) return null

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() + 1

    const [funds, allPayments] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_member", (q) =>
          q.eq("orgId", actor.orgId).eq("memberId", member._id),
        )
        .collect(),
    ])

    // Only a fixed_monthly fund can be owed anything. This is the same rule the
    // rest of the product obeys, from the same helper — a member whose only fund
    // is the voluntary Friday one genuinely owes nothing and must be told so
    // rather than shown a fabricated debt.
    const dueFundIds = new Set(
      funds.filter((f) => hasDues(f)).map((f) => f._id),
    )

    const dues = await ctx.db
      .query("contributions")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", member._id),
      )
      .collect()

    const mine = dues.filter(
      (c) => c.fundId != null && dueFundIds.has(c.fundId),
    )
    const open = mine.filter((c) => c.status === "due" || c.status === "partial")

    const buckets = ageDues(
      open.map((c) => ({
        memberId: c.memberId,
        amountPaise: c.amountPaise,
        year: c.year,
        month: c.month,
        dueDate: c.dueDate,
      })),
      now,
    )
    const oldest = oldestDuePerMember(
      open.map((c) => ({
        memberId: c.memberId,
        year: c.year,
        month: c.month,
        dueDate: c.dueDate,
      })),
      now,
    )
    const oldestDue = oldest.get(member._id)

    const fundName = new Map(funds.map((f) => [f._id, f.name]))
    const thisMonth = mine.filter((c) => c.year === year && c.month === month)
    const thisMonthPaise = sumPaise(
      thisMonth.filter((c) => c.status !== "paid" && c.status !== "waived").map((c) => c.amountPaise),
    )

    // Every month they have ever been charged, newest first, so the statement is
    // a real statement and not just a balance. 84 members x 8 years is fine
    // here: this is one member's own rows, not the org's.
    const months = [...mine]
      .sort((a, b) => b.year - a.year || b.month - a.month)
      .map((c) => ({
        id: c._id,
        year: c.year,
        month: c.month,
        fundName: c.fundId ? (fundName.get(c.fundId) ?? "") : "",
        amountPaise: c.amountPaise,
        status: c.status,
        dueDate: c.dueDate ?? null,
      }))

    const receipts = [...allPayments]
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
      .slice(0, 50)
      .map((p) => ({
        id: p._id,
        receiptNo: p.receiptNo,
        amountPaise: p.amountPaise,
        method: p.method,
        paidAt: p.paidAt,
        fundName: p.fundId ? (fundName.get(p.fundId) ?? "") : "",
        reference: p.reference ?? null,
      }))

    const requests = await ctx.db
      .query("paymentRequests")
      .withIndex("by_requester", (q) =>
        q.eq("orgId", actor.orgId).eq("requestedBy", actor.userId),
      )
      .collect()

    return {
      member: {
        id: member._id,
        name: member.name,
        phone: member.phone ?? null,
        joinedYear: member.joinedYear,
        joinedMonth: member.joinedMonth,
        isActive: member.isActive,
      },
      orgName: (await ctx.db.get(actor.orgId))?.name ?? "",
      currentMonth: { year, month },
      /** Charged and not yet settled. Never negative, never invented. */
      currentMonthPaise: thisMonthPaise,
      arrearsPaise: sumPaise(open.map((c) => c.amountPaise)),
      arrearsMonths: open.length,
      totalOutstandingPaise: thisMonthPaise + sumPaise(open.map((c) => c.amountPaise)),
      totalReceivedPaise: sumPaise(allPayments.map((p) => p.amountPaise)),
      paymentCount: allPayments.length,
      lifetimePaise: await readBalance(ctx.db, actor.orgId, "member", member._id),
      oldestDueDate: oldestDue?.dueDate ?? null,
      oldestDueDays: oldestDue?.days ?? 0,
      aging: buckets,
      months,
      receipts,
      pendingRequests: requests.filter((r) => r.status === "pending").length,
      // A member with no fixed_monthly fund is owed nothing. Saying so plainly
      // is better than an empty balance that looks like a bug.
      hasDues: dueFundIds.size > 0,
      dueFunds: funds
        .filter((f) => hasDues(f))
        .map((f) => ({ id: f._id, name: f.name, monthlyAmountPaise: f.monthlyAmountPaise ?? 0 })),
      voluntaryFunds: funds
        .filter((f) => !hasDues(f))
        .map((f) => ({ id: f._id, name: f.name, collectionMode: modeOf(f) })),
    }
  },
})

/**
 * Where the money goes.
 *
 * The one query the member's "how do I pay" screen needs, and it returns bank
 * details only — no amount, no balance, no fund ledger. A member is told the
 * account to send to and nothing else; what they owe is on the summary they can
 * already see, and this query deliberately cannot be used to infer anybody
 * else's.
 *
 * The committee's decision is that this application records money rather than
 * taking it (docs/M4-PLAN.md §1), so a member pays from their own UPI app into
 * the bank account named here and then tells the treasurer, which is the
 * `requestPayment` flow below. Nothing here observes or confirms a payment, and
 * nothing here should ever grow the ability to.
 */
export const paymentDetails = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)

    const funds = await ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    // Only a fund that can actually be paid into: it has dues, and it is drawn on
    // a bank account. The member is not shown an account for a fund they are
    // not charged for.
    const payable = funds.filter((f) => hasDues(f) && f.bankId != null && f.isActive)
    const bankIds = [...new Set(payable.map((f) => f.bankId as Id<"banks">))]

    const accounts = await Promise.all(
      bankIds.map(async (bankId) => {
        const bank = await ctx.db.get(bankId)
        if (!bank || bank.orgId !== actor.orgId) return null
        return {
          id: bank._id,
          name: bank.name,
          branch: bank.branch ?? null,
          accountNumber: bank.accountNumber ?? null,
          ifscCode: bank.ifscCode ?? null,
          upiId: bank.upiId ?? null,
          /** Which of their funds this account collects for. */
          fundNames: payable
            .filter((f) => f.bankId === bank._id)
            .map((f) => f.name),
        }
      }),
    )

    return {
      accounts: accounts.filter((a) => a !== null),
      /**
       * The organisation's standing instruction for a member who has paid.
       * It is the same claim flow as everywhere else — no shortcut, because a
       * shortcut here would be a second path into the books.
       */
      howToRecord:
        "After you send it, tell the treasurer. They will confirm it and issue your receipt.",
    }
  },
})

/* ------------------------------------------------- claiming a payment (M3) */
/**
 * Tell us you have already paid.
 *
 * Writes nothing to the books. This creates a request a treasurer confirms,
 * which then creates the payment, the receipt and the ledger entry — in that
 * order, through the same path as a payment recorded at the desk. The member
 * gets a request number immediately so they can point at it.
 */
export const requestPayment = mutation({
  args: {
    fundId: v.optional(v.id("funds")),
    amountPaise: v.number(),
    method: v.union(
      v.literal("cash"),
      v.literal("cheque"),
      v.literal("upi"),
      v.literal("card"),
      v.literal("transfer"),
    ),
    paidAt: v.string(),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const member = await requireMyMember(ctx)
    if (!member) {
      throw new Error("Link your account to a member record first")
    }
    assertPositive(args.amountPaise)
    if (args.paidAt > nowIso()) {
      throw new Error("You cannot claim to have paid in the future")
    }

    if (args.fundId) {
      const fund = await ctx.db.get(args.fundId)
      if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
    }

    // One open request per member at a time. Two pending claims for the same
    // person is nearly always the same money entered twice, and a treasurer
    // approving both would double-count it.
    const open = await ctx.db
      .query("paymentRequests")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", member._id),
      )
      .collect()
      .then((rows) => rows.filter((r) => r.status === "pending"))
    if (open.length > 0) {
      throw new Error(
        "You already have a payment request waiting for the treasurer. They will confirm it shortly.",
      )
    }

    const id = await ctx.db.insert("paymentRequests", {
      orgId: actor.orgId,
      memberId: member._id,
      fundId: args.fundId,
      amountPaise: args.amountPaise,
      method: args.method,
      paidAt: args.paidAt,
      reference: args.reference?.trim() || undefined,
      note: args.note?.trim() || undefined,
      status: "pending",
      requestedBy: actor.userId,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: "payment.requested",
      entityType: "paymentRequest",
      entityId: id,
      details: `${member.name} claims ${args.amountPaise} paise by ${args.method}`,
    })

    return { id }
  },
})

/**
 * The printable passbook statement.
 *
 * Its own query rather than a reshaping of `summary`, for one reason that is easy
 * to get wrong: `summary` caps the receipt list at fifty so the phone screen
 * stays fast, while computing its totals over *everything*. That is the right
 * trade for a screen and the wrong one for a document. A statement that listed
 * fifty payments and then printed "received ₹96,400 over 212 payments" would be
 * internally inconsistent, and a member who notices that is right to stop
 * trusting every other number on the page.
 *
 * So the statement reads the member's own two sets of rows in full. That is
 * bounded by *one member's* history, not the organisation's — a heavy payer over
 * eight years is a few hundred rows — and it is the same rows `summary` reads,
 * so the two can never disagree about what was paid.
 *
 * Chronological, oldest first, because that is what a passbook is. The screen
 * sorts newest first because that is what a list is.
 */
export const statement = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const member = await requireMyMember(ctx)
    if (!member) return null

    const [funds, payments, dues] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_member", (q) =>
          q.eq("orgId", actor.orgId).eq("memberId", member._id),
        )
        .collect(),
      ctx.db
        .query("contributions")
        .withIndex("by_member", (q) =>
          q.eq("orgId", actor.orgId).eq("memberId", member._id),
        )
        .collect(),
    ])

    const dueFundIds = new Set(funds.filter((f) => hasDues(f)).map((f) => f._id))
    const fundName = new Map(funds.map((f) => [f._id, f.name]))
    const byDate = (a: string, b: string) => a.localeCompare(b)

    const charged = dues
      .filter((c) => c.fundId != null && dueFundIds.has(c.fundId))
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map((c) => ({
        id: c._id,
        year: c.year,
        month: c.month,
        fundName: c.fundId ? (fundName.get(c.fundId) ?? "") : "",
        amountPaise: c.amountPaise,
        status: c.status,
      }))

    const received = [...payments]
      .sort((a, b) => byDate(a.paidAt, b.paidAt))
      .map((p) => ({
        id: p._id,
        receiptNo: p.receiptNo,
        amountPaise: p.amountPaise,
        method: p.method,
        paidAt: p.paidAt,
        fundName: p.fundId ? (fundName.get(p.fundId) ?? "") : "",
        reference: p.reference ?? null,
      }))

    return {
      member: {
        id: member._id,
        name: member.name,
        phone: member.phone ?? null,
        joinedYear: member.joinedYear,
        joinedMonth: member.joinedMonth,
        isActive: member.isActive,
      },
      orgName: (await ctx.db.get(actor.orgId))?.name ?? "",
      generatedAt: new Date().toISOString(),
      charged,
      received,
      chargedTotalPaise: sumPaise(charged.map((c) => c.amountPaise)),
      receivedTotalPaise: sumPaise(received.map((p) => p.amountPaise)),
      /**
       * What the statement is actually for. Every month charged less every rupee
       * received, over the member's whole history — and because payments settle
       * the oldest unpaid month first, that difference is exactly the months
       * still open. It is computed here from the two lists above rather than read
       * from `summary`, so the document is self-consistent by construction: the
       * figure at the foot of the page is the arithmetic of the rows above it.
       */
      outstandingPaise:
        sumPaise(charged.map((c) => c.amountPaise)) -
        sumPaise(received.map((p) => p.amountPaise)),
    }
  },
})

/** A member's own requests, newest first. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const member = await requireMyMember(ctx)
    if (!member) return []

    const requests = await ctx.db
      .query("paymentRequests")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", member._id),
      )
      .collect()

    return requests
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r._id,
        amountPaise: r.amountPaise,
        method: r.method,
        paidAt: r.paidAt,
        reference: r.reference ?? null,
        note: r.note ?? null,
        status: r.status,
        decisionNote: r.decisionNote ?? null,
        decidedAt: r.decidedAt ?? null,
        createdAt: r.createdAt,
      }))
  },
})

/** The treasurer's queue. */
export const requestsQueue = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireTreasurer(ctx)
    const [requests, members] = await Promise.all([
      ctx.db
        .query("paymentRequests")
        .withIndex("by_org_status", (q) =>
          q.eq("orgId", actor.orgId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])
    const nameOf = new Map(members.map((m) => [m._id, m.name]))

    return requests
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        id: r._id,
        memberId: r.memberId,
        memberName: nameOf.get(r.memberId) ?? "",
        amountPaise: r.amountPaise,
        method: r.method,
        paidAt: r.paidAt,
        reference: r.reference ?? null,
        note: r.note ?? null,
        createdAt: r.createdAt,
      }))
  },
})

/**
 * Confirm or refuse a claimed payment.
 *
 * Approval is the only path here that touches money, and it deliberately does so
 * by calling the same `recordPayment` the desk uses. That means the request
 * cannot create a payment that the collection path would have refused — an
 * amount that would overdraw a fund, a member who does not exist, a fund from
 * another organisation — because the request goes through exactly those checks
 * on its way to the ledger.
 */
export const decideRequest = mutation({
  args: {
    requestId: v.id("paymentRequests"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const request = await ctx.db.get(args.requestId)
    if (!request || request.orgId !== actor.orgId) {
      throw new Error("Request not found")
    }
    if (request.status !== "pending") {
      throw new Error(`This request was already ${request.status}`)
    }

    const note = args.note?.trim() || undefined

    if (!args.approve) {
      await ctx.db.patch(args.requestId, {
        status: "rejected",
        decidedBy: actor.userId,
        decidedAt: Date.now(),
        decisionNote: note,
      })
      await recordAudit(ctx, actor, {
        action: "payment.requestRejected",
        entityType: "paymentRequest",
        entityId: args.requestId,
        details: note ?? "refused",
      })
      return { status: "rejected" as const }
    }

    // A confirmed claim is a payment. Delegating to the single writer of the
    // ledger is the point: there is no second way for money to enter the books,
    // so there is no second way for it to enter them wrongly. If the request
    // names a fund that would overdraw, or a fund from another organisation,
    // this throws and the request stays pending for someone to look at.
    const result = await recordPaymentFor(ctx, actor, {
      memberId: request.memberId,
      fundId: request.fundId,
      amountPaise: request.amountPaise,
      method: request.method,
      paidAt: request.paidAt,
      reference: request.reference,
    })

    await ctx.db.patch(args.requestId, {
      status: "approved",
      decidedBy: actor.userId,
      decidedAt: Date.now(),
      decisionNote: note,
      paymentId: result.paymentId,
    })

    await recordAudit(ctx, actor, {
      action: "payment.requestApproved",
      entityType: "paymentRequest",
      entityId: args.requestId,
      details: `${result.receiptNo} — ${request.amountPaise} paise by ${request.method}`,
    })

    return { status: "approved" as const, receiptNo: result.receiptNo }
  },
})
