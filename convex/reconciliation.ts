import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireMember, requireTreasurer } from "./lib/authz"
import { bankBalanceAsOf, readAllBalances } from "./lib/balances"
import { recordAudit } from "./lib/audit"
import { assertPaise, nowIso } from "./lib/money"
import { postEntry } from "./lib/ledger"
import { category } from "./schema"

/**
 * Reconciliation, fiscal-year close, and the opening balance.
 *
 * ## What reconciliation is for
 *
 * A ledger balance is a claim about a bank account. The only way to know the
 * claim is true is to ask the bank. So the treasurer reads the balance off the
 * passbook or the statement, types it in here, and the app compares it against
 * what the ledger says the same account held **on that date** — not today. A
 * statement from January cannot be checked against a balance that has had six
 * more months of giving added to it; that comparison would report a difference
 * every single time and be meaningless.
 *
 * The difference is therefore stored, not just displayed. A history of
 * reconciliations is the evidence that the books were checked, and when they
 * were — which is what an auditor or a new treasurer asks first.
 *
 * ## Why the date-bound balance is cheap
 *
 * `bankBalanceAsOf` walks backwards from today's balance using the materialised
 * per-year movement totals, so a statement from 2018 costs the same as one from
 * last week. See `convex/lib/balances.ts`.
 *
 * ## Close
 *
 * Closing a year sets a watermark on the organisation. From that moment the
 * ledger writer refuses any entry dated in or before it (`assertPeriodOpen`), and
 * a year that has been closed and signed off cannot be quietly re-opened by a
 * stray backdated entry six months later. Reopening is admin-only and audited,
 * because it is the one operation here that undoes a sign-off.
 */

/** A statement date is a plain calendar day; time of day is meaningless here. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function assertStatementDate(statementDate: string): void {
  if (!ISO_DAY.test(statementDate)) {
    throw new Error("Statement date must be a date like 2025-03-31")
  }
  if (Number.isNaN(Date.parse(`${statementDate}T00:00:00.000Z`))) {
    throw new Error("That is not a real date")
  }
  if (statementDate > nowIso().slice(0, 10)) {
    throw new Error("A bank statement cannot be dated in the future")
  }
}

/**
 * Newest reconciliation first.
 *
 * The date alone is not enough to order by. The most common correction a
 * treasurer makes is re-reading a statement they mistyped, and that produces a
 * *second* row for the *same* date — so ordering on `statementDate` alone left
 * the two in whatever order the index returned them, and the summary card kept
 * showing the figure that had just been corrected. `createdAt` breaks the tie, so
 * the later filing is the one on screen and the earlier one stays in the history
 * as the record of what was first claimed.
 */
function newestFirst(
  a: { statementDate: string; createdAt: number },
  b: { statementDate: string; createdAt: number },
): number {
  return (
    b.statementDate.localeCompare(a.statementDate) || b.createdAt - a.createdAt
  )
}

/* -------------------------------------------------------------- read models */

/**
 * Everything the reconciliation screen draws: one card per bank, plus the
 * organisation's close state.
 *
 * A single query rather than one per bank, because the screen always shows all
 * of them and N subscriptions would be N round trips for a screen the treasurer
 * opens monthly.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const balances = await readAllBalances(ctx.db, actor.orgId)

    const [org, bankList, reconciliations] = await Promise.all([
      ctx.db.get(actor.orgId),
      ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("reconciliations")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])

    const byBank = new Map<string, typeof reconciliations>()
    for (const row of reconciliations) {
      const list = byBank.get(row.bankId) ?? []
      list.push(row)
      byBank.set(row.bankId, list)
    }

    /**
     * How many statements the status read model carries per account.
     *
     * The screen draws a recent-history table, not the whole archive, and this
     * query runs on every visit. A community that reconciles monthly for eight
     * years has around a hundred statements per account, and sending all of
     * them to draw a dozen rows would make the one screen in the milestone whose
     * cost grows with usage. The full history is still available, one account at
     * a time, through `reconciliation:history` — and `historyCount` says how much
     * is being held back so the screen can say so rather than quietly truncating.
     */
    const HISTORY_LIMIT = 12

    // Newest statement first — the one the treasurer is looking at is the last
    // one they filed, not the first.
    for (const list of byBank.values()) {
      list.sort(newestFirst)
    }

    const accounts = await Promise.all(
      bankList.map(async (bank) => {
        const all = byBank.get(bank._id) ?? []
        const history = all.slice(0, HISTORY_LIMIT).map((row) => ({
          id: row._id,
          statementDate: row.statementDate,
          statementBalancePaise: row.statementBalancePaise,
          ledgerBalancePaise: row.ledgerBalancePaise,
          differencePaise: row.differencePaise,
          note: row.note ?? null,
          resolvedAt: row.resolvedAt ?? null,
          createdAt: row.createdAt,
        }))
        const latest = history[0] ?? null
        return {
          id: bank._id,
          name: bank.name,
          branch: bank.branch ?? null,
          accountNumber: bank.accountNumber ?? null,
          balancePaise: balances.get(`bank:${bank._id}`) ?? 0,
          latest,
          // How much the books have moved on since the statement was filed. A
          // statement that agrees with the ledger is only meaningful up to this
          // point; beyond it, the account has drifted for ordinary reasons.
          movedSincePaise: latest
            ? (balances.get(`bank:${bank._id}`) ?? 0) -
              latest.ledgerBalancePaise
            : null,
          history,
          historyCount: all.length,
        }
      }),
    )

    return {
      orgName: org?.name ?? "",
      closedThrough: org?.closedThrough ?? null,
      currentYear: new Date().getUTCFullYear(),
      accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)),
      reconciledCount: accounts.filter((a) => a.latest !== null).length,
      // A difference that has been closed off is *explained*, not settled: the
      // money still does not match, we just know why. Counting it as
      // outstanding anyway left the screen reporting two unresolved
      // discrepancies immediately after closing both of them, and contradicted
      // the badge on the same card.
      outstandingCount: accounts.filter(
        (a) =>
          a.latest !== null &&
          a.latest.differencePaise !== 0 &&
          a.latest.resolvedAt == null,
      ).length,
      explainedCount: accounts.filter(
        (a) =>
          a.latest !== null &&
          a.latest.differencePaise !== 0 &&
          a.latest.resolvedAt != null,
      ).length,
    }
  },
})

/** One bank's full reconciliation history, newest first. */
export const history = query({
  args: { bankId: v.id("banks") },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)
    const bank = await ctx.db.get(args.bankId)
    if (!bank || bank.orgId !== actor.orgId) return []

    return ctx.db
      .query("reconciliations")
      .withIndex("by_bank", (q) =>
        q.eq("orgId", actor.orgId).eq("bankId", args.bankId),
      )
      .collect()
      .then((rows) =>
        rows
          .sort(newestFirst)
          .map((row) => ({
            id: row._id,
            statementDate: row.statementDate,
            statementBalancePaise: row.statementBalancePaise,
            ledgerBalancePaise: row.ledgerBalancePaise,
            differencePaise: row.differencePaise,
            note: row.note ?? null,
            resolvedAt: row.resolvedAt ?? null,
            createdAt: row.createdAt,
          })),
      )
  },
})

/* ---------------------------------------------------------------- mutations */

/**
 * File a bank statement against the books.
 *
 * The ledger figure is computed here rather than passed in, so a client cannot
 * assert that the books agree with the bank. Whatever the server derives is what
 * gets stored; the difference is the whole point of the record.
 */
export const record = mutation({
  args: {
    bankId: v.id("banks"),
    statementDate: v.string(),
    statementBalancePaise: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    assertStatementDate(args.statementDate)
    assertPaise(args.statementBalancePaise, "Statement balance")

    const bank = await ctx.db.get(args.bankId)
    if (!bank || bank.orgId !== actor.orgId) throw new Error("Account not found")

    const balances = await readAllBalances(ctx.db, actor.orgId)
    const ledgerBalancePaise = await bankBalanceAsOf(
      ctx,
      actor.orgId,
      args.bankId,
      balances,
      args.statementDate,
    )
    const differencePaise = args.statementBalancePaise - ledgerBalancePaise

    const id = await ctx.db.insert("reconciliations", {
      orgId: actor.orgId,
      bankId: args.bankId,
      statementDate: args.statementDate,
      statementBalancePaise: args.statementBalancePaise,
      ledgerBalancePaise,
      differencePaise,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    })

    await recordAudit(ctx, actor, {
      action: "reconciliation.recorded",
      entityType: "reconciliation",
      entityId: id,
      details:
        differencePaise === 0
          ? `${bank.name} agrees with the ledger at ${args.statementDate}`
          : `${bank.name} differs from the ledger by ${differencePaise} paise at ${args.statementDate}`,
    })

    return { id, ledgerBalancePaise, differencePaise }
  },
})

/**
 * Close off a difference once it has been explained.
 *
 * A non-zero difference is not a failure — unrecorded cash, a bank charge, a
 * transfer in flight. What matters is that it was *looked at*, so this stamps the
 * reconciliation rather than deleting it, and the history keeps the amount.
 */
export const resolve = mutation({
  args: { reconciliationId: v.id("reconciliations"), note: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const row = await ctx.db.get(args.reconciliationId)
    if (!row || row.orgId !== actor.orgId) {
      throw new Error("Reconciliation not found")
    }
    if (row.resolvedAt !== undefined) {
      throw new Error("That difference was already closed off")
    }

    const note = args.note.trim()
    if (note.length < 3) {
      throw new Error("Say how the difference was explained")
    }

    await ctx.db.patch(args.reconciliationId, {
      resolvedAt: Date.now(),
      note: row.note ? `${row.note} — ${note}` : note,
    })

    await recordAudit(ctx, actor, {
      action: "reconciliation.resolved",
      entityType: "reconciliation",
      entityId: args.reconciliationId,
      details: note,
    })

    return args.reconciliationId
  },
})

/**
 * Close a financial year.
 *
 * Two things happen, and the second is the one that used to be missing: the
 * entries dated in the year are stamped `lockedTo`, so they cannot be reversed
 * even though a reversal is dated *today* and would therefore slip past the
 * date-based watermark on its own. Without the stamp, "the books are closed" and
 * "an entry from March can still be quietly backed out" were both true at once.
 *
 * Stamping is bounded work: a year of entries, in pages. It is deliberately not
 * done for the whole history at once — Convex caps a mutation at 4096 documents
 * read, and eight years of this community's ledger is well past that.
 */
export const closeYear = mutation({
  args: { year: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100) {
      throw new Error("Year must be between 2000 and 2100")
    }
    const thisYear = new Date().getUTCFullYear()
    if (args.year >= thisYear) {
      throw new Error("You cannot close a year that has not finished")
    }

    const org = await ctx.db.get(actor.orgId)
    if (!org) throw new Error("Organisation not found")
    const current = org.closedThrough
    if (current !== undefined && args.year <= current) {
      throw new Error(`The books are already closed through ${current}`)
    }

    // Needed for the error message naming the account that is blocking.
    const bankList = await ctx.db
      .query("banks")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    // A close is a statement that the year reconciles. Refusing while a
    // difference is unexplained is the entire reason this screen exists: a year
    // closed over an unreconciled bank balance is worse than one left open,
    // because it looks settled.
    //
    // Any unexplained difference blocks, whatever date its statement carries.
    // An earlier version only looked at statements dated in or before the year
    // being closed, on the reasoning that a later statement could not speak to
    // it — but a statement filed in September about a balance that does not
    // match is an open question about the books *now*, and closing a year while
    // the bank and the ledger are known to disagree is exactly the mistake this
    // guard exists to prevent.
    const open = await ctx.db
      .query("reconciliations")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const latestByBank = new Map<string, (typeof open)[number]>()
    for (const row of open) {
      const held = latestByBank.get(row.bankId)
      if (!held || newestFirst(row, held) < 0) {
        latestByBank.set(row.bankId, row)
      }
    }
    const bankName = new Map(bankList.map((b) => [b._id, b.name]))
    const unexplained = [...latestByBank.values()].filter(
      (row) => row.differencePaise !== 0 && row.resolvedAt === undefined,
    )
    if (unexplained.length > 0) {
      const names = unexplained
        .map((row) => bankName.get(row.bankId) ?? "an account")
        .join(", ")
      throw new Error(
        `${names} ${unexplained.length === 1 ? "has" : "have"} an unexplained ` +
          `difference of ${unexplained
            .map((r) => `${r.differencePaise} paise`)
            .join(", ")}. Close ${unexplained.length === 1 ? "it" : "them"} off on the ` +
          "Reconciliation screen first.",
      )
    }

    let locked = 0
    let cursor = `${args.year}-01-01`
    const toExclusive = `${args.year + 1}-01-01`
    for (;;) {
      const page = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_date", (q) =>
          q
            .eq("orgId", actor.orgId)
            .gte("effectiveDate", cursor)
            .lt("effectiveDate", toExclusive),
        )
        .take(400)
      if (page.length === 0) break
      for (const entry of page) {
        if (entry.lockedTo !== undefined) continue
        await ctx.db.patch(entry._id, { lockedTo: args.year })
        locked += 1
      }
      cursor = page[page.length - 1].effectiveDate
      if (page.length < 400) break
    }

    await ctx.db.patch(actor.orgId, { closedThrough: args.year })

    await recordAudit(ctx, actor, {
      action: "financialYear.closed",
      entityType: "organization",
      entityId: actor.orgId,
      details: `Books closed through ${args.year}; ${locked} entries locked${
        args.note?.trim() ? ` — ${args.note.trim()}` : ""
      }`,
    })

    return { year: args.year, locked }
  },
})

/** Reopen the most recently closed year. Admin only, and audited. */
export const reopenYear = mutation({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    if (actor.role !== "admin") {
      throw new Error("Only an admin can reopen a closed year")
    }
    const org = await ctx.db.get(actor.orgId)
    if (!org) throw new Error("Organisation not found")
    const current = org.closedThrough
    if (current === undefined) throw new Error("No year is closed")
    if (args.year !== current) {
      throw new Error(`The books are closed through ${current}`)
    }

    // Unlock the year being reopened, so the state after an admin's correction
    // is the state before the close rather than a half-closed mixture.
    let unlocked = 0
    let cursor = `${args.year}-01-01`
    const toExclusive = `${args.year + 1}-01-01`
    for (;;) {
      const page = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_date", (q) =>
          q
            .eq("orgId", actor.orgId)
            .gte("effectiveDate", cursor)
            .lt("effectiveDate", toExclusive),
        )
        .take(400)
      if (page.length === 0) break
      for (const entry of page) {
        if (entry.lockedTo !== args.year) continue
        await ctx.db.patch(entry._id, { lockedTo: undefined })
        unlocked += 1
      }
      cursor = page[page.length - 1].effectiveDate
      if (page.length < 400) break
    }

    await ctx.db.patch(actor.orgId, {
      closedThrough: args.year > 2000 ? args.year - 1 : undefined,
    })

    await recordAudit(ctx, actor, {
      action: "financialYear.reopened",
      entityType: "organization",
      entityId: actor.orgId,
      details: `Books reopened for ${args.year}; ${unlocked} entries unlocked`,
    })

    return { year: args.year, unlocked }
  },
})

/**
 * Post an opening balance — the first entry of an imported ledger.
 *
 * The community kept its books in a spreadsheet, so the real history does not
 * start at zero: on the day the ledger begins, each account already held money.
 * An imported ledger that starts at zero is *wrong*, not merely incomplete, and
 * every balance derived from it is wrong by the same amount forever.
 *
 * So the opening balance is an ordinary ledger entry, dated the day before the
 * history starts, carrying `source: "opening"`. It goes through `postEntry`, so
 * it moves the same materialised balances every other entry does and the
 * `balances:verify` invariant covers it like any other. There is no special
 * "set the balance" path, and no way for the opening figure to disagree with the
 * sum of the entries.
 *
 * Guarded to the case it exists for: a fund or account that has no entries yet.
 * Re-posting onto a live ledger would double the money, so it is refused rather
 * than left to the caller to notice.
 */
export const postOpeningBalance = mutation({
  args: {
    fundId: v.optional(v.id("funds")),
    bankId: v.optional(v.id("banks")),
    amountPaise: v.number(),
    asOf: v.string(),
    category: v.optional(category),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    if (!args.fundId && !args.bankId) {
      throw new Error("Choose a fund or a bank account")
    }
    if (args.fundId && args.bankId) {
      throw new Error("An opening balance belongs to a fund or an account, not both")
    }
    assertStatementDate(args.asOf)
    if (args.amountPaise === 0) {
      throw new Error("An opening balance cannot be zero")
    }
    assertPaise(args.amountPaise, "Opening balance")

    if (args.fundId) {
      const fund = await ctx.db.get(args.fundId)
      if (!fund || fund.orgId !== actor.orgId) throw new Error("Fund not found")
      const existing = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) =>
          q.eq("orgId", actor.orgId).eq("fundId", args.fundId!),
        )
        .first()
      if (existing) {
        throw new Error(
          `"${fund.name}" already has ledger entries, so an opening balance would ` +
            "double the money. Correct it with a reversing entry instead.",
        )
      }
    } else {
      const bank = await ctx.db.get(args.bankId!)
      if (!bank || bank.orgId !== actor.orgId) {
        throw new Error("Account not found")
      }
      const existing = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_bank", (q) =>
          q.eq("orgId", actor.orgId).eq("bankId", args.bankId!),
        )
        .first()
      if (existing) {
        throw new Error(
          `"${bank.name}" already has ledger entries, so an opening balance would ` +
            "double the money. Correct it with a reversing entry instead.",
        )
      }
    }

    const id = await postEntry(ctx, actor, {
      fundId: args.fundId,
      bankId: args.bankId,
      amountPaise: args.amountPaise,
      category: args.category ?? "other",
      effectiveDate: args.asOf,
      source: "opening",
      note:
        args.note?.trim() ||
        `Opening balance carried over from the spreadsheet — ${args.asOf}`,
    })

    await recordAudit(ctx, actor, {
      action: "ledger.openingPosted",
      entityType: "ledgerEntry",
      entityId: id,
      details: `Opening balance of ${args.amountPaise} paise as at ${args.asOf}`,
    })

    return id
  },
})
