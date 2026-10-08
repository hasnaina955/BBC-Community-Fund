import type { QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"

/**
 * The earliest year an organisation has any record of.
 *
 * ## Why this is not derived from the members alone
 *
 * `yearRange` decides which years the contributions grid and the reports offer
 * to the treasurer, and it used to be the earliest member join date. That was
 * true for exactly as long as a member's join date was the earliest thing an
 * organisation could know — which stopped being true at M6, when a community
 * began arriving with a spreadsheet. A community that imports its members and
 * then imports 2019–2024 of history would have been offered **only the current
 * year** in the pickers, with eight years of correctly imported contributions
 * sitting in the database and no way to select them. The books were the thing
 * that knew, so the books are asked.
 *
 * ## Why it is cheap
 *
 * Both reads are point lookups on an index whose second column is the date
 * (`contributions.by_org_year`, `ledgerEntries.by_date`), so the first document
 * in index order is the earliest one and nothing else is read. This does not
 * scan eight years of history to find out where it starts. Payments are not
 * queried separately because `recordPaymentFor` posts a ledger entry, so the
 * ledger already covers them.
 *
 * The roster is small (tens or hundreds of rows) and callers that have already
 * loaded it pass it in, so the dashboard does not read it twice.
 */
export async function earliestYearOnRecord(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
  knownMembers?: Array<{ joinedYear: number }>,
): Promise<number> {
  const [firstContribution, firstEntry, members] = await Promise.all([
    ctx.db
      .query("contributions")
      .withIndex("by_org_year", (q) => q.eq("orgId", orgId))
      .first(),
    ctx.db
      .query("ledgerEntries")
      .withIndex("by_date", (q) => q.eq("orgId", orgId))
      .first(),
    knownMembers
      ? Promise.resolve(knownMembers)
      : ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect(),
  ])

  let earliest = CURRENT_YEAR
  if (firstContribution) earliest = Math.min(earliest, firstContribution.year)
  if (firstEntry) {
    const year = Number(firstEntry.effectiveDate.slice(0, 4))
    if (Number.isFinite(year)) earliest = Math.min(earliest, year)
  }
  for (const member of members) earliest = Math.min(earliest, member.joinedYear)

  return earliest
}

const NOW = new Date()

/** The year the application treats as the current one. */
export const CURRENT_YEAR = NOW.getFullYear()
