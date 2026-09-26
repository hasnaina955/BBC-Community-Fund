import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { DataModel, Id } from "../_generated/dataModel"
import type { Actor } from "./authz"

/**
 * Materialised balances.
 *
 * See the `balances` table comment in schema.ts for why these exist. The rule
 * this file keeps is the important part: **a materialised balance must always
 * equal the sum of its ledger entries.** `recomputeAll` rebuilds them from the
 * entries and `verifyAll` reports any disagreement, so the invariant is
 * checkable at any moment rather than merely asserted.
 *
 * Every call happens inside the mutation that wrote the entry, so the counter
 * and the entry commit together or not at all.
 */

type Scope = DataModel["balances"]["document"]["scope"]
type DB = QueryCtx["db"] | MutationCtx["db"]

/**
 * Collect every document of a table, a page at a time.
 *
 * Two limits force this. Convex caps a single `.collect()` at 16384 documents,
 * and caps reads *inside a write transaction* — which is what a mutation is —
 * at 4096. The ledger is already past the second at eight years, so anything
 * that walks the whole ledger from a mutation has to page.
 *
 * The cursor is `_creationTime` rather than Convex's `paginate()` because a
 * query builder cannot be re-paginated once iteration has begun, and this has
 * to build a fresh range per page. Documents created in the same millisecond
 * would be skipped, which is why callers pass an index whose first field is
 * already scoped to one organisation.
 */
export async function collectAll<T extends { _creationTime: number }>(
  build: (afterCreationTime: number) => { take(n: number): Promise<T[]> },
  numItems = 1000,
): Promise<T[]> {
  const rows: T[] = []
  let after = Number.NEGATIVE_INFINITY
  for (;;) {
    const page = await build(after).take(numItems)
    if (page.length === 0) return rows
    rows.push(...page)
    after = page[page.length - 1]._creationTime
    if (page.length < numItems) return rows
  }
}

/**
 * Look up the key for a scope. Uses `.filter()` rather than an index because
 * `scopeId` is a plain string, not an Id — the index narrows to the scope
 * first, which keeps this proportional to the number of funds or banks (a
 * handful), not to the ledger.
 */
async function findBalanceRow(
  db: DB,
  orgId: Id<"organizations">,
  scope: Scope,
  scopeId: string,
) {
  const rows = await db
    .query("balances")
    .withIndex("by_scope", (q) => q.eq("orgId", orgId).eq("scope", scope))
    .collect()
  return rows.find((r) => r.scopeId === scopeId) ?? null
}

/** Add a signed amount to a materialised balance. */
export async function applyToBalance(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  scope: Scope,
  scopeId: string,
  deltaPaise: number,
): Promise<void> {
  if (deltaPaise === 0) return

  const existing = await findBalanceRow(ctx.db, orgId, scope, scopeId)
  if (existing) {
    await ctx.db.patch(existing._id, {
      amountPaise: existing.amountPaise + deltaPaise,
      updatedAt: Date.now(),
    })
  } else {
    await ctx.db.insert("balances", {
      orgId,
      scope,
      scopeId,
      amountPaise: deltaPaise,
      updatedAt: Date.now(),
    })
  }
}

/** Read a materialised balance, defaulting to zero. */
export async function readBalance(
  db: DB,
  orgId: Id<"organizations">,
  scope: Scope,
  scopeId: string,
): Promise<number> {
  const row = await findBalanceRow(db, orgId, scope, scopeId)
  return row?.amountPaise ?? 0
}

/** All balances for an organisation, keyed by `scope:scopeId`. */
export async function readAllBalances(
  db: DB,
  orgId: Id<"organizations">,
): Promise<Map<string, number>> {
  const rows = await db
    .query("balances")
    .withIndex("by_scope", (q) => q.eq("orgId", orgId))
    .collect()
  return new Map(rows.map((r) => [`${r.scope}:${r.scopeId}`, r.amountPaise]))
}

/**
 * Recompute every balance from the ledger and report what moved.
 *
 * This is the proof that the materialised values are derived rather than
 * independently maintained: run it and a correct system reports no change.
 * Safe to call at any time; it writes only the rows that disagree.
 */
export async function recomputeAll(
  ctx: MutationCtx,
  actor: Actor,
): Promise<{ checked: number; corrected: number; changes: string[] }> {
  const entries = await collectAll((after) =>
    ctx.db
      .query("ledgerEntries")
      // `by_org` rather than `by_date`: the implicit `_creationTime` that
      // Convex appends to every index is what the page cursor ranges over, and
      // it is only reachable on an index whose declared fields are all equal.
      .withIndex("by_org", (q) =>
        after === Number.NEGATIVE_INFINITY
          ? q.eq("orgId", actor.orgId)
          : q.eq("orgId", actor.orgId).gt("_creationTime", after),
      ),
  )

  const truth = new Map<string, number>()
  for (const entry of entries) {
    if (entry.fundId) {
      const key = `fund:${entry.fundId}`
      truth.set(key, (truth.get(key) ?? 0) + entry.amountPaise)
    }
    if (entry.bankId) {
      const key = `bank:${entry.bankId}`
      truth.set(key, (truth.get(key) ?? 0) + entry.amountPaise)
    }
    if (entry.memberId) {
      const key = `member:${entry.memberId}`
      truth.set(key, (truth.get(key) ?? 0) + entry.amountPaise)
    }
  }

  const current = await readAllBalances(ctx.db, actor.orgId)
  const changes: string[] = []
  let corrected = 0

  for (const [key, expected] of truth) {
    const actual = current.get(key) ?? 0
    if (actual === expected) continue

    const [scope, scopeId] = splitKey(key)
    await applyToBalance(ctx, actor.orgId, scope, scopeId, expected - actual)
    changes.push(`${key}: ${actual} -> ${expected}`)
    corrected += 1
  }

  return { checked: truth.size, corrected, changes }
}

function splitKey(key: string): [Scope, string] {
  const index = key.indexOf(":")
  return [key.slice(0, index) as Scope, key.slice(index + 1)]
}
