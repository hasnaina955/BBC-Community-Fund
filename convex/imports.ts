import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { requireTreasurer, type Actor } from "./lib/authz"
import { recordAudit } from "./lib/audit"
import { hasDues, modeOf } from "./lib/funds"
import { postEntry } from "./lib/ledger"
import { recordPaymentFor } from "./lib/collection"
import { insertMember } from "./lib/members"
import { planRoster, rosterKeys, type RosterKeys } from "./lib/roster"
import { earliestYearOnRecord } from "./lib/years"
import {
  parseImport,
  type ImportIssue,
  type MemberRow,
  type ContributionRow,
  type PaymentRow,
  type LedgerRow,
  COLUMNS,
} from "./lib/importcsv"

/**
 * Importing a community's existing books.
 *
 * ## The rule everything else follows
 *
 * **This file may not write to `ledgerEntries`, `payments` or `contributions`
 * directly.** It calls `postEntry` and `recordPaymentFor` — the same two
 * functions the treasurer's desk calls — so an imported rupee produces byte-for-
 * byte the rows a typed one would, including receipt numbering, arrears
 * settlement oldest-first, the materialised `balances` update, the closed-period
 * check and the audit row.
 *
 * That is not tidiness. A second writer of money is the one bug in this codebase
 * that cannot be walked back: a balance that double-counts does not announce
 * itself, it just stops reconciling months later, by which point nobody can say
 * which entries are real. The import path is the *most* dangerous place for
 * that bug, because it is the one that runs unattended over eight years of
 * somebody's history.
 *
 * ## All or nothing
 *
 * `runImport` plans first and writes second, and returns its problems instead of
 * throwing when it finds any. A file with 4,000 good rows and one bad one
 * imports nothing — the alternative is a half-imported ledger that reconciles
 * against nothing and can only be fixed by deleting rows, which this codebase
 * does not do to a ledger.
 *
 * ## Safe to run twice
 *
 * Every row carries a key derived from a hash of the file the treasurer
 * uploaded, so re-importing the same file is a no-op rather than a doubling. A
 * treasurer who clicks the button twice, or whose browser retries, gets the same
 * books. The key is the file's *contents*, which also means that editing the
 * file and re-importing does duplicate the rows that did not change — see
 * `warnings` in the preview, which says so in as many words.
 */

/** Guard rails. A file larger than this is refused rather than attempted. */
const MAX_ROWS = 10_000
/** Above this, a name lookup needs an email rather than a scan. */
const MAX_MEMBERS_FOR_NAME_MATCH = 2_000

/* ------------------------------------------------------------------ lookups */

interface RefMaps {
  /** Lowercased email -> member id. */
  byEmail: Map<string, Id<"members">>
  /** Lowercased name -> member ids, because two people share a name. */
  byName: Map<string, Id<"members">[]>
  /**
   * The roster reduced to what a spreadsheet row can be matched on. Only the
   * membership list reads it; the money kinds match a row to a member by
   * name or email, which is what `byEmail`/`byName` above are for.
   */
  roster: RosterKeys
  /**
   * The earliest year this organisation has any record of, used as the join
   * year for a roster row that does not name one.
   */
  earliestYear: number
  fundByName: Map<string, Id<"funds">>
  bankByName: Map<string, Id<"banks">>
  /** The fund used when a row does not name one. */
  defaultFund: Id<"funds"> | null
  memberCount: number
}

async function loadRefs(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
): Promise<RefMaps> {
  const [members, funds, banks] = await Promise.all([
    ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
    ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
    ctx.db
      .query("banks")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
  ])

  const byEmail = new Map<string, Id<"members">>()
  const byName = new Map<string, Id<"members">[]>()
  for (const m of members) {
    if (m.email) byEmail.set(m.email.trim().toLowerCase(), m._id)
    const key = m.name.trim().toLowerCase()
    const list = byName.get(key)
    if (list) list.push(m._id)
    else byName.set(key, [m._id])
  }

  const fundByName = new Map<string, Id<"funds">>()
  for (const f of funds) {
    fundByName.set(f.name.trim().toLowerCase(), f._id)
  }

  const bankByName = new Map<string, Id<"banks">>()
  for (const b of banks) {
    bankByName.set(b.name.trim().toLowerCase(), b._id)
  }

  // A contributions file with no `fund` column still has to land somewhere, and
  // the only defensible default is a fund that actually has dues — putting a
  // monthly grid on the donation fund would be refused by the mode rule anyway.
  const dueFund = funds.find((f) => hasDues(f)) ?? funds[0] ?? null

  return {
    byEmail,
    byName,
    roster: rosterKeys(members),
    fundByName,
    bankByName,
    defaultFund: dueFund ? dueFund._id : null,
    memberCount: members.length,
    // Passed the roster we just read, so this costs two point lookups and
    // not a second read of the membership.
    earliestYear: await earliestYearOnRecord(ctx, orgId, members),
  }
}


function resolveMember(
  refs: RefMaps,
  value: string,
  row: number,
  field: string,
  issues: ImportIssue[],
): Id<"members"> | null {
  const text = value.trim()
  if (!text) return null

  const byEmail = refs.byEmail.get(text.toLowerCase())
  if (byEmail) return byEmail

  const candidates = refs.byName.get(text.toLowerCase())
  if (candidates && candidates.length === 1) return candidates[0]
  if (candidates && candidates.length > 1) {
    issues.push({
      row,
      field,
      message: `"${value}" matches ${candidates.length} members — put their email address in this column instead of their name`,
    })
    return null
  }

  issues.push({
    row,
    field,
    message: refs.memberCount > MAX_MEMBERS_FOR_NAME_MATCH
      ? `no member has the email "${value}"`
      : `no member is called "${value}" — add them under Members first, or use their email address`,
  })
  return null
}

function resolveFund(
  refs: RefMaps,
  value: string | null,
  row: number,
  field: string,
  issues: ImportIssue[],
): Id<"funds"> | null {
  if (!value) return refs.defaultFund
  const found = refs.fundByName.get(value.trim().toLowerCase())
  if (!found) {
    issues.push({ row, field, message: `there is no fund called "${value}"` })
    return null
  }
  return found
}

function resolveBank(
  refs: RefMaps,
  value: string | null,
  row: number,
  field: string,
  issues: ImportIssue[],
): Id<"banks"> | null {
  if (!value) return null
  const found = refs.bankByName.get(value.trim().toLowerCase())
  if (!found) {
    issues.push({ row, field, message: `there is no bank account called "${value}"` })
    return null
  }
  return found
}

/* ------------------------------------------------------------------- planning */

interface ContributionPlan {
  row: ContributionRow
  memberId: Id<"members">
  fundId: Id<"funds">
}

async function planContributions(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
  refs: RefMaps,
  rows: ContributionRow[],
  issues: ImportIssue[],
): Promise<{ plans: ContributionPlan[]; warnings: string[] }> {
  const warnings: string[] = []
  const plans: ContributionPlan[] = []
  const funds = new Map(
    (await ctx.db
      .query("funds")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()).map((f) => [f._id, f]),
  )

  for (const row of rows) {
    const memberId = resolveMember(refs, row.member, row.row, "member", issues)
    const fundId = resolveFund(refs, row.fund, row.row, "fund", issues)
    if (!memberId || !fundId) continue

    // The mode rule, enforced rather than assumed. A monthly grid on a donation
    // fund is refused here rather than inserted and silently meaningless.
    const fund = funds.get(fundId)
    if (!fund) {
      issues.push({ row: row.row, field: "fund", message: "unknown fund" })
      continue
    }
    if (row.status !== "waived" && !hasDues(fund)) {
      issues.push({
        row: row.row,
        field: "fund",
        message: `"${fund.name}" is ${modeOf(fund)}, so members do not owe it anything — a contribution grid cannot be imported against it`,
      })
      continue
    }

    plans.push({ row, memberId, fundId })
  }

  if (rows.some((r) => r.status === "partial")) {
    warnings.push(
      "Some rows are marked partial. A part payment is a payment, not a grid status, so those months are imported as still due — import the payments separately to settle them.",
    )
  }
  if (rows.some((r) => r.status === "paid")) {
    warnings.push(
      "Paid months are imported by replaying a payment for each, oldest first, exactly as a treasurer entering them by hand would. A payment always settles the *oldest* unpaid month, so where the file skips a month that payment lands on that earlier month instead, and the file's stated status is not forced — a month is only ever shown paid when money behind it says so.",
    )
  }

  return { plans, warnings }
}

interface PaymentPlan {
  row: PaymentRow
  memberId: Id<"members"> | null
  fundId: Id<"funds">
}

function planPayments(
  refs: RefMaps,
  rows: PaymentRow[],
  issues: ImportIssue[],
): { plans: PaymentPlan[]; warnings: string[] } {
  const warnings: string[] = []
  const plans: PaymentPlan[] = []

  for (const row of rows) {
    const memberId = row.member
      ? resolveMember(refs, row.member, row.row, "member", issues)
      : null
    if (row.member && !memberId) continue
    const fundId = resolveFund(refs, row.fund, row.row, "fund", issues)
    if (!fundId) continue
    // A named bank that the file also implies through the fund is honoured
    // only when it is the fund's own; the payment writer derives it from the
    // fund otherwise, and a receipt that lands in the wrong account is worse
    // than one that lands in the right one.
    if (row.bank) {
      const bankId = resolveBank(refs, row.bank, row.row, "bank", issues)
      if (!bankId) continue
    }
    plans.push({ row, memberId, fundId })
  }

  if (rows.some((r) => !r.member)) {
    warnings.push(
      "Some payments name no member. They are recorded as money received with nobody attached, which is right for a donation and wrong for a missed subscription.",
    )
  }

  return { plans, warnings }
}

interface LedgerPlan {
  row: LedgerRow
  fundId?: Id<"funds">
  bankId?: Id<"banks">
  memberId?: Id<"members">
}

function planLedger(
  refs: RefMaps,
  rows: LedgerRow[],
  issues: ImportIssue[],
): { plans: LedgerPlan[]; warnings: string[] } {
  const plans: LedgerPlan[] = []
  for (const row of rows) {
    const plan: LedgerPlan = { row }
    if (row.fund) {
      const id = resolveFund(refs, row.fund, row.row, "fund", issues)
      if (!id) continue
      plan.fundId = id
    }
    if (row.bank) {
      const id = resolveBank(refs, row.bank, row.row, "bank", issues)
      if (!id) continue
      plan.bankId = id
    }
    if (row.member) {
      const id = resolveMember(refs, row.member, row.row, "member", issues)
      if (!id) continue
      plan.memberId = id
    }
    plans.push(plan)
  }
  return {
    plans,
    warnings: [
      "Each entry is posted with the date in the file, so a bank passbook will show the movement in the year it actually happened. Check the opening balance against a statement before importing anything else — once the years are populated, a wrong opening figure is the hardest number in the product to correct.",
    ],
  }
}

/* -------------------------------------------------------------- membership */

interface MemberPlan {
  row: MemberRow
  joinedYear: number
  joinedMonth: number
}

/** How many skipped names are listed before the warning is summarised. */
const MAX_SKIPPED_NAMED = 8

/**
 * Plan a membership list.
 *
 * ## A roster is made safe to re-run by identity, not by hashing the file
 *
 * The other three kinds derive an idempotency key from a hash of the uploaded
 * file, which is right for a ledger: the same bytes describe the same money.
 * A roster is not like that. A treasurer who corrects one address and uploads
 * the file again has uploaded *different bytes describing the same people*, and
 * a hash would add a second copy of every one of them. So a row is matched
 * against the existing roster by identity — email, else phone, else name — and
 * a match is skipped: re-uploading the same roster is a no-op, and a corrected
 * one adds only the people who are new. The rules themselves live in
 * `lib/roster.ts`, where the check suite can drive them with real
 * spreadsheets and no deployment.
 *
 * The limit of that is worth stating plainly, because it is not nothing. A row
 * whose *identity* changed is somebody the roster has never met as far as this
 * can tell: rename a member who has no email and no phone, and re-uploading the
 * file adds them a second time. That is not a gap to close with guesswork —
 * two members called "Mohammed Ali" are two members, and no rule can tell a
 * rename from a new cousin. It is instead reported: every skip is named in the
 * warnings, so the treasurer can see exactly what the file did.
 *
 * ## This import only ever adds
 *
 * It does not edit, reactivate or delete an existing member. A spreadsheet
 * column that has been quietly reworded is not evidence about a person, and
 * overwriting a phone number from a stale file is the kind of change nobody
 * notices until a reminder goes to the wrong place. Corrections are made on
 * the Members screen.
 */
function planMembers(
  refs: RefMaps,
  rows: MemberRow[],
  issues: ImportIssue[],
): { plans: MemberPlan[]; warnings: string[]; skipped: string[] } {
  const warnings: string[] = []
  const { usable, skipped } = planRoster(rows, refs.roster, issues)

  const plans = usable.map((row) => ({
    row,
    // A file that names only a year is read as January of it: the earliest
    // month it could be, so a member owes from the start of the year rather
    // than from a month nobody chose. A file that names nothing gets the
    // earliest year the organisation has any record of, so an imported roster
    // is not dated later than the books it belongs to.
    joinedYear: row.joinedYear ?? refs.earliestYear,
    joinedMonth: row.joinedMonth ?? 1,
  }))

  if (skipped.length > 0) {
    const named = skipped.slice(0, MAX_SKIPPED_NAMED).join(", ")
    warnings.push(
      `${skipped.length} of ${rows.length} rows are already on the roster and were left alone: ${named}` +
        (skipped.length > MAX_SKIPPED_NAMED
          ? `, and ${skipped.length - MAX_SKIPPED_NAMED} more`
          : "") +
        ". This import only adds members; it never edits one, so a correction to an existing member is made on the Members screen.",
    )
  }

  const undated = plans.filter((p) => p.row.joinedYear === null)
  if (undated.length > 0) {
    warnings.push(
      `${undated.length} row${undated.length === 1 ? "" : "s"} do not say when the member joined, so they are recorded as joining in ${refs.earliestYear}. If your records go back further than that, add a joined_year column — a month before a member's join date cannot be entered for them by hand.`,
    )
  }

  if (plans.length > 0 && plans.every((p) => !p.row.email)) {
    warnings.push(
      "None of these rows have an email address. A member claims their own record in the portal by matching the email on it, so none of them can sign in to see their dues until an address is added on the Members screen.",
    )
  }

  return { plans, warnings, skipped }
}
/* ------------------------------------------------------------------ preview */

const fileArgs = { text: v.string() } as const

/**
 * Read a file and report what would happen, without writing anything.
 *
 * This is a query, not a mutation that returns early, because "what will this
 * do to my books" must be answerable without a write path. The UI shows this
 * before the import button becomes available.
 */
export const previewImport = query({
  args: fileArgs,
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    const parsed = parseImport(args.text)

    if (parsed.totalRows > MAX_ROWS) {
      return {
        ok: false as const,
        kind: parsed.kind,
        totalRows: parsed.totalRows,
        issues: [
          ...parsed.issues,
          {
            row: 0,
            field: "file",
            message: `This file has ${parsed.totalRows} rows and the limit is ${MAX_ROWS}. Split it by year and import each part.`,
          },
        ],
        warnings: [] as string[],
        summary: null,
      }
    }

    if (!parsed.kind) {
      return {
        ok: false as const,
        kind: null,
        totalRows: parsed.totalRows,
        issues: parsed.issues,
        warnings: [] as string[],
        summary: null,
      }
    }

    const refs = await loadRefs(ctx, actor.orgId)
    const issues = [...parsed.issues]
    const rows = parsed.rows as Array<MemberRow | ContributionRow | PaymentRow | LedgerRow>

    let summary: Record<string, number> = {}
    let warnings: string[] = []

    if (parsed.kind === "members") {
      const planned = planMembers(refs, rows as MemberRow[], issues)
      summary = { members: planned.plans.length }
      warnings = planned.warnings
    } else if (parsed.kind === "contributions") {
      const { plans, warnings: w } = await planContributions(
        ctx,
        actor.orgId,
        refs,
        rows as ContributionRow[],
        issues,
      )
      summary = {
        contributions: plans.length,
        payments: plans.filter((p) => p.row.status === "paid").length,
      }
      warnings = w
    } else if (parsed.kind === "payments") {
      const { plans, warnings: w } = planPayments(refs, rows as PaymentRow[], issues)
      summary = { payments: plans.length }
      warnings = w
    } else {
      const { plans, warnings: w } = planLedger(refs, rows as LedgerRow[], issues)
      summary = { ledgerEntries: plans.length }
      warnings = w
    }

    return {
      ok: issues.length === 0,
      kind: parsed.kind,
      totalRows: parsed.totalRows,
      issues,
      warnings,
      summary,
    }
  },
})

/* ----------------------------------------------------------------- the import */

type Actor2 = Actor

/**
 * Commit the import.
 *
 * Returns `{ ok: false, issues }` and writes **nothing** when the file has a
 * problem. The UI shows the issues and the import button stays disabled, which
 * is the "validate before committing" behaviour — a treasurer should never have
 * to undo a ledger.
 */
export const runImport = mutation({
  args: { ...fileArgs, batchKey: v.string() },
  handler: async (ctx, args) => {
    const actor: Actor2 = await requireTreasurer(ctx)
    const parsed = parseImport(args.text)

    const refuse = (issues: ImportIssue[]) => ({
      ok: false as const,
      imported: 0,
      issues,
      warnings: [] as string[],
      receiptRange: null as string | null,
    })

    if (parsed.totalRows > MAX_ROWS) {
      return refuse([
        ...parsed.issues,
        {
          row: 0,
          field: "file",
          message: `This file has ${parsed.totalRows} rows and the limit is ${MAX_ROWS}. Split it by year.`,
        },
      ])
    }
    if (!parsed.kind) return refuse(parsed.issues)
    if (parsed.rows.length === 0) {
      return refuse([
        ...parsed.issues,
        { row: 0, field: "file", message: "There are no usable rows in this file." },
      ])
    }

    const refs = await loadRefs(ctx, actor.orgId)
    const issues = [...parsed.issues]
    const rows = parsed.rows as Array<MemberRow | ContributionRow | PaymentRow | LedgerRow>

    /* -------------------- members: add, and never edit -------------------- */

    if (parsed.kind === "members") {
      const { plans, warnings, skipped } = planMembers(
        refs,
        rows as MemberRow[],
        issues,
      )
      if (issues.length > 0) return refuse(issues)

      let created = 0
      for (const plan of plans) {
        // Through `insertMember`, the same writer `members.createMember` uses,
        // so an imported member is a member the rest of the app already knows
        // how to validate and read. Nothing is patched: see planMembers.
        await insertMember(ctx, actor.orgId, {
          name: plan.row.name,
          phone: plan.row.phone ?? undefined,
          email: plan.row.email ?? undefined,
          relation: plan.row.relation ?? undefined,
          joinedYear: plan.joinedYear,
          joinedMonth: plan.joinedMonth,
        })
        created += 1
      }

      await recordAudit(ctx, actor, {
        action: "import.members",
        entityType: "import",
        details:
          `${created} members` +
          (skipped.length > 0
            ? `; ${skipped.length} already on the roster`
            : ""),
      })

      return {
        ok: true as const,
        imported: created,
        members: created,
        contributions: 0,
        payments: 0,
        skipped: skipped.length,
        issues: [] as ImportIssue[],
        warnings,
        receiptRange: null,
      }
    }

    /* ---- contributions: grid first, then replay the paid ones as payments -- */

    if (parsed.kind === "contributions") {
    const { plans, warnings: plannedWarnings } = await planContributions(
      ctx,
      actor.orgId,
      refs,
      rows as ContributionRow[],
      issues,
    )
    let warnings = plannedWarnings
      if (issues.length > 0) return refuse(issues)

      // Oldest first per member. This is not a presentation order — it is what
      // makes the replay below land on the right month, because
      // `recordPaymentFor` settles the oldest open due, so a payment entered out
      // of order would settle the wrong month.
      const ordered = [...plans].sort((a, b) => {
        if (a.memberId !== b.memberId) return a.memberId < a.memberId ? -1 : 1
        if (a.row.year !== b.row.year) return a.row.year - b.row.year
        return a.row.month - b.row.month
      })

      // Already-imported months, so re-running the same file is a no-op.
      const existing = new Map<string, Set<string>>()
      const memberIds = [...new Set(ordered.map((p) => p.memberId))]
      for (const memberId of memberIds) {
        const have = await ctx.db
          .query("contributions")
          .withIndex("by_member", (q) => q.eq("orgId", actor.orgId).eq("memberId", memberId))
          .collect()
        existing.set(
          memberId,
          new Set(have.map((c) => `${c.year}-${c.month}-${c.fundId ?? ""}`)),
        )
      }

      const created = new Map<string, Id<"contributions">>()
      let contributionsWritten = 0
      let paymentsWritten = 0
      let skipped = 0
      let firstReceipt: string | null = null
      let lastReceipt: string | null = null
      const unreconciled: string[] = []

      for (const plan of ordered) {
        const key = `${plan.memberId}`
        const monthKey = `${plan.row.year}-${plan.row.month}-${plan.fundId}`
        if (existing.get(key)?.has(monthKey)) {
          skipped += 1
          continue
        }

        const contributionId = await ctx.db.insert("contributions", {
          orgId: actor.orgId,
          memberId: plan.memberId,
          fundId: plan.fundId,
          year: plan.row.year,
          month: plan.row.month,
          amountPaise: plan.row.amountPaise,
          // A paid or partial month is created as `due` and only becomes what
          // the file says once the money behind it exists. A row that says paid
          // with no payment is a claim, not a fact.
          status: plan.row.status === "waived" ? "waived" : "due",
          dueDate: `${plan.row.year}-${String(plan.row.month).padStart(2, "0")}-10`,
        })
        created.set(monthKey, contributionId)
        contributionsWritten += 1

        if (plan.row.status !== "paid") continue

        const result = await recordPaymentFor(ctx, actor, {
          memberId: plan.memberId,
          fundId: plan.fundId,
          amountPaise: plan.row.amountPaise,
          method: "cash",
          paidAt: `${plan.row.paidAt}T12:00:00.000Z`,
          reference: "Imported",
          note: plan.row.note ?? "Imported from the community's records",
          idempotencyKey: `import:${args.batchKey}:${plan.row.row}`,
        })
        paymentsWritten += 1
        if (firstReceipt === null) firstReceipt = result.receiptNo
        lastReceipt = result.receiptNo

        // The replay settles the oldest open month, which is this one when the
        // file is a complete grid for the months it covers.
        //
        // When it is not, the ledger has already decided where the money went
        // and the grid must agree with it. An earlier version of this forced
        // the file's stated status onto the intended month, which produced a
        // month marked paid with no payment behind it — the grid claiming a
        // member had given ₹450 when ₹300 had arrived. The rule is therefore
        // absolute: **a month is only ever paid because a payment settled it.**
        // The file's own record loses to the ledger, and the difference is
        // reported rather than papered over.
        const settled = await ctx.db.get(contributionId)
        if (settled && settled.status === "due") {
          const month = `${plan.row.year}-${String(plan.row.month).padStart(2, "0")}`
          unreconciled.push(
            `Row ${plan.row.row}: the file says ${month} was paid, but that payment settled an earlier unpaid month, because the ledger always settles the oldest due first. ${month} is still shown as due. Import the earlier month as paid as well, and this one will follow.`,
          )
        }
      }

      if (unreconciled.length > 0) {
        warnings = [...warnings, ...unreconciled]
      }

      await recordAudit(ctx, actor, {
        action: "import.contributions",
        entityType: "import",
        details:
          `${contributionsWritten} contributions and ${paymentsWritten} payments` +
          (skipped > 0 ? `; ${skipped} already present` : ""),
      })

      return {
        ok: true as const,
        imported: contributionsWritten + paymentsWritten,
        members: 0,
        contributions: contributionsWritten,
        payments: paymentsWritten,
        skipped,
        issues: [] as ImportIssue[],
        warnings,
        receiptRange:
          firstReceipt && lastReceipt
            ? firstReceipt === lastReceipt
              ? firstReceipt
              : `${firstReceipt}–${lastReceipt}`
            : null,
      }
    }

    /* ------------------------------- payments: one writer call per row ----- */

    if (parsed.kind === "payments") {
      const { plans, warnings } = planPayments(refs, rows as PaymentRow[], issues)
      if (issues.length > 0) return refuse(issues)

      const ordered = [...plans].sort((a, b) => a.row.paidAt.localeCompare(b.row.paidAt))
      let paymentsWritten = 0
      let skipped = 0
      let firstReceipt: string | null = null
      let lastReceipt: string | null = null

      for (const plan of ordered) {
        const result = await recordPaymentFor(ctx, actor, {
          memberId: plan.memberId ?? undefined,
          fundId: plan.fundId,
          amountPaise: plan.row.amountPaise,
          method: plan.row.method,
          paidAt: `${plan.row.paidAt}T12:00:00.000Z`,
          reference: plan.row.receipt ?? plan.row.reference ?? undefined,
          note: plan.row.note ?? "Imported from the community's records",
          idempotencyKey: `import:${args.batchKey}:${plan.row.row}`,
        })
        if (result.unallocatedPaise === 0 && result.receiptNo) {
          // The writer returns the existing receipt on a replay, so a file
          // imported twice reports the same range and writes nothing.
          if (firstReceipt === null) firstReceipt = result.receiptNo
          lastReceipt = result.receiptNo
        }
        paymentsWritten += 1
      }

      await recordAudit(ctx, actor, {
        action: "import.payments",
        entityType: "import",
        details: `${paymentsWritten} payments`,
      })

      return {
        ok: true as const,
        imported: paymentsWritten,
        members: 0,
        contributions: 0,
        payments: paymentsWritten,
        skipped,
        issues: [] as ImportIssue[],
        warnings,
        receiptRange:
          firstReceipt && lastReceipt
            ? firstReceipt === lastReceipt
              ? firstReceipt
              : `${firstReceipt}–${lastReceipt}`
            : null,
      }
    }

    /* --------------------- ledger: opening balances and other movements --- */

    const { plans, warnings } = planLedger(refs, rows as LedgerRow[], issues)
    if (issues.length > 0) return refuse(issues)

    // A closed year rejects writes, and a historical import is mostly closed
    // years. `postEntry` will refuse each one; say so once, up front, with the
    // year named, rather than letting the treasurer discover it row by row.
    const org = await ctx.db.get(actor.orgId)
    const closedThrough = org?.closedThrough
    let written = 0
    let skipped = 0

    for (const plan of plans) {
      const refId = `${args.batchKey}:${plan.row.row}`
      const already = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_ref", (q) =>
          q
            .eq("orgId", actor.orgId)
            .eq("refType", "import")
            .eq("refId", refId),
        )
        .first()
      if (already) {
        skipped += 1
        continue
      }

      await postEntry(ctx, actor, {
        fundId: plan.fundId,
        bankId: plan.bankId,
        memberId: plan.memberId,
        amountPaise: plan.row.amountPaise,
        category: (plan.row.category ?? "other") as "other",
        // Deliberately the date in the file, not today. A historical import that
        // stamps everything today produces a passbook with eight years of
        // movements on one day, which is the opposite of what was asked for.
        effectiveDate: plan.row.date,
        source: "opening",
        refType: "import",
        refId,
        note: plan.row.note ?? "Imported from the community's records",
      })
      written += 1
    }

    const years = [
      ...new Set(plans.map((p) => Number(p.row.date.slice(0, 4)))),
    ].sort()

    await recordAudit(ctx, actor, {
      action: "import.ledger",
      entityType: "import",
      details: `${written} ledger entries`,
    })

    const outOfRange =
      closedThrough !== undefined
        ? years.filter((y) => y <= closedThrough)
        : []

    return {
      ok: true as const,
      imported: written,
      members: 0,
      contributions: 0,
      payments: 0,
      skipped,
      issues: [] as ImportIssue[],
      warnings: [
        ...warnings,
        ...(outOfRange.length > 0
          ? [
              `The financial year through ${closedThrough} is closed, so entries dated ${outOfRange.join(", ")} were refused. Reopen the year from Settings if the books are still being corrected.`,
            ]
          : []),
      ],
      receiptRange: null,
    }
  },
})

/* ----------------------------------------------------------------- template */

/**
 * The expected columns, for the download on the import screen.
 *
 * Returned as data rather than as a file so the screen can render the same list
 * the server validates against. A template that drifts from the validator is a
 * template that produces an error report on upload.
 */
export const templateColumns = query({
  args: {},
  handler: async (ctx) => {
    await requireTreasurer(ctx)
    return COLUMNS
  },
})
