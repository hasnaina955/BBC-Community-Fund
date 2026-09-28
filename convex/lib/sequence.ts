import type { MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"

/**
 * Per-organisation counters, and the receipt number that comes out of one.
 *
 * ## Why this exists
 *
 * The receipt number used to be `R-${payments.length + 1}`, computed by
 * collecting every payment in the organisation. That was wrong twice:
 *
 *   1. It is a full-table scan on the hottest write in the app. The seed is at
 *      about 9,955 payments and Convex caps a query at 16,384 documents, so
 *      recording a payment would have started failing outright at roughly twice
 *      the seeded history. The ledger, the contributions grid and the balances
 *      materialisation all already avoid that limit; this path was the one that
 *      was missed, and a member's proof of payment depends on it.
 *
 *   2. A count is not a sequence. Two payments recorded before either committed
 *      both read `n + 1` and both wrote `R-00n`. Convex serialises mutations per
 *      document, not across documents, so nothing prevented it — and a
 *      collection round is the worst possible case, because a treasurer tapping
 *      cash payments in a row is precisely the burst that widens the window. Two
 *      members holding the same receipt number is not a cosmetic problem in a
 *      book that has to reconcile against a bank statement.
 *
 * ## How the first number is chosen
 *
 * Existing organisations already have receipts, and the new sequence must not
 * collide with them. So the first call scans once to find the highest receipt
 * number already issued, and caches it. After that the counter is O(1) and the
 * scan never happens again.
 *
 * The scan is deliberately lazy rather than done in a migration: an
 * organisation with no payments skips it entirely, and one with payments pays
 * for it exactly once.
 */

const RECEIPT_PREFIX = "R-"

/** Parse `R-00123` into 123. Returns null for anything else. */
function parseReceiptNo(receiptNo: string | undefined | null): number | null {
  if (!receiptNo) return null
  if (!receiptNo.startsWith(RECEIPT_PREFIX)) return null
  const n = Number(receiptNo.slice(RECEIPT_PREFIX.length))
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** The highest receipt number already issued in this organisation, or 0. */
async function highestExistingReceipt(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<number> {
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()

  let max = 0
  for (const payment of payments) {
    const n = parseReceiptNo(payment.receiptNo)
    if (n !== null && n > max) max = n
  }
  return max
}

/**
 * Claim the next receipt number for this organisation.
 *
 * The counter row is read, incremented and written inside the caller's mutation,
 * so the read-modify-write is serialised with the payment insert that follows
 * it. Two concurrent callers cannot both be handed the same number.
 *
 * Returns the zero-padded number, e.g. `R-09956`.
 */
export async function nextReceiptNo(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<string> {
  const existing = await ctx.db
    .query("counters")
    .withIndex("by_org_scope", (q) =>
      q.eq("orgId", orgId).eq("scope", "receipt"),
    )
    .first()

  if (!existing) {
    // First ever call for this organisation. Start above everything already
    // issued, so a number is never reused even if a payment was ever removed.
    const seed = await highestExistingReceipt(ctx, orgId)
    const value = seed + 1
    await ctx.db.insert("counters", {
      orgId,
      scope: "receipt",
      value,
      updatedAt: Date.now(),
    })
    return format(value)
  }

  const value = existing.value + 1
  await ctx.db.patch(existing._id, { value, updatedAt: Date.now() })
  return format(value)
}

function format(value: number): string {
  // Five digits matches the width the seed already used, so a 100,000th receipt
  // grows the string rather than silently losing a leading zero.
  return `${RECEIPT_PREFIX}${String(value).padStart(5, "0")}`
}
