import type { MutationCtx } from "../_generated/server"
import type { DataModel, Id } from "../_generated/dataModel"
import type { Actor } from "./authz"
import { assertPaise, nowIso } from "./money"

type EntryDoc = DataModel["ledgerEntries"]["document"]

type Category = EntryDoc["category"]
type Source = EntryDoc["source"]

/**
 * The only module permitted to write a `ledgerEntries` row.
 *
 * Every balance in the product is a sum over this table, so the invariants
 * below are what make the numbers trustworthy. Enforcing them here means a
 * new mutation cannot quietly break them:
 *
 *   1. Append-only. Corrections are reversing entries, never updates or
 *      deletes. There is no `update` or `delete` call in this file.
 *   2. Locked periods reject writes. Once a financial year is closed, an entry
 *      with an effective date inside it is refused.
 *   3. Amounts are integer paise.
 *
 * See docs/ARCHITECTURE.md -> "The ledger".
 */

export interface EntryInput {
  fundId?: Id<"funds">
  bankId?: Id<"banks">
  memberId?: Id<"members">
  /** Signed. Positive credits the fund/bank, negative debits it. */
  amountPaise: number
  category: Category
  effectiveDate?: string
  source: Source
  refType?: string
  refId?: string
  note?: string
}

/**
 * Throws when the effective date falls inside a closed period.
 *
 * The watermark is stored per organisation as the last closed year; an entry
 * dated within that year or earlier is refused.
 */
export async function assertPeriodOpen(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  effectiveDate: string,
): Promise<void> {
  const org = await ctx.db.get(orgId)
  const closedThrough = org?.closedThrough as number | undefined
  if (closedThrough === undefined) return

  const year = Number(effectiveDate.slice(0, 4))
  if (Number.isFinite(year) && year <= closedThrough) {
    throw new Error(
      `The financial year through ${closedThrough} is closed and cannot be changed`,
    )
  }
}

/** Create one entry. This is the only way a balance ever moves. */
export async function postEntry(
  ctx: MutationCtx,
  actor: Actor,
  input: EntryInput,
): Promise<Id<"ledgerEntries">> {
  assertPaise(input.amountPaise)
  if (input.amountPaise === 0) {
    throw new Error("A ledger entry cannot be zero")
  }

  const effectiveDate = input.effectiveDate ?? nowIso()
  await assertPeriodOpen(ctx, actor.orgId, effectiveDate)

  return ctx.db.insert("ledgerEntries", {
    orgId: actor.orgId,
    fundId: input.fundId,
    bankId: input.bankId,
    memberId: input.memberId,
    amountPaise: input.amountPaise,
    direction: input.amountPaise >= 0 ? "credit" : "debit",
    category: input.category,
    effectiveDate,
    source: input.source,
    refType: input.refType,
    refId: input.refId,
    note: input.note,
    actorId: actor.userId,
  })
}

/**
 * Post a balanced pair for an inter-fund transfer.
 *
 * A transfer moves value out of one fund and into another. It is written as two
 * entries that always sum to zero, so the organisation's total is unchanged and
 * neither fund is silently debited. The legacy model stored a transfer as a
 * single self-referencing row, which is not reconcilable.
 */
export async function postTransfer(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    fromFundId: Id<"funds">
    toFundId: Id<"funds">
    fromBankId?: Id<"banks">
    toBankId?: Id<"banks">
    amountPaise: number
    category: Category
    effectiveDate?: string
    refType?: string
    refId?: string
    note?: string
  },
): Promise<[Id<"ledgerEntries">, Id<"ledgerEntries">]> {
  assertPaise(input.amountPaise)
  if (input.amountPaise <= 0) {
    throw new Error("A transfer must be greater than zero")
  }
  if (input.fromFundId === input.toFundId) {
    throw new Error("A fund cannot transfer to itself")
  }

  const effectiveDate = input.effectiveDate ?? nowIso()
  await assertPeriodOpen(ctx, actor.orgId, effectiveDate)

  const outgoing = await ctx.db.insert("ledgerEntries", {
    orgId: actor.orgId,
    fundId: input.fromFundId,
    bankId: input.fromBankId,
    amountPaise: -input.amountPaise,
    direction: "debit",
    category: input.category,
    effectiveDate,
    source: "transfer",
    refType: input.refType,
    refId: input.refId,
    note: input.note ? `Transfer out — ${input.note}` : "Transfer out",
    actorId: actor.userId,
  })

  const incoming = await ctx.db.insert("ledgerEntries", {
    orgId: actor.orgId,
    fundId: input.toFundId,
    bankId: input.toBankId,
    amountPaise: input.amountPaise,
    direction: "credit",
    category: input.category,
    effectiveDate,
    source: "transfer",
    refType: input.refType,
    refId: input.refId,
    note: input.note ? `Transfer in — ${input.note}` : "Transfer in",
    actorId: actor.userId,
  })

  return [outgoing, incoming]
}

/**
 * Reverse an existing entry by writing its mirror image.
 *
 * This is how a mistake is fixed. Deleting the original would destroy the
 * history that proves what happened.
 */
export async function reverseEntry(
  ctx: MutationCtx,
  actor: Actor,
  entryId: Id<"ledgerEntries">,
  reason: string,
): Promise<Id<"ledgerEntries">> {
  const original = await ctx.db.get(entryId)
  if (!original) throw new Error("Entry not found")
  if (original.orgId !== actor.orgId) throw new Error("Entry not found")
  if (original.lockedTo !== undefined) {
    throw new Error("That entry is in a closed period and cannot be reversed")
  }

  return ctx.db.insert("ledgerEntries", {
    orgId: actor.orgId,
    fundId: original.fundId,
    bankId: original.bankId,
    memberId: original.memberId,
    amountPaise: -original.amountPaise,
    direction: original.amountPaise >= 0 ? "debit" : "credit",
    category: original.category,
    effectiveDate: nowIso(),
    source: "correction",
    refType: "reversal",
    refId: entryId,
    note: reason ? `Reversal — ${reason}` : "Reversal",
    actorId: actor.userId,
  })
}

/* ------------------------------------------------------------- derived reads */

export function sum(entries: Array<{ amountPaise: number }>): number {
  let total = 0
  for (const entry of entries) total += entry.amountPaise
  return total
}

export function fundBalance(
  entries: Array<{ fundId?: Id<"funds"> | null; amountPaise: number }>,
  fundId: Id<"funds">,
): number {
  return sum(entries.filter((e) => e.fundId === fundId))
}

export function bankBalance(
  entries: Array<{ bankId?: Id<"banks"> | null; amountPaise: number }>,
  bankId: Id<"banks">,
): number {
  return sum(entries.filter((e) => e.bankId === bankId))
}

export function memberBalance(
  entries: Array<{ memberId?: Id<"members"> | null; amountPaise: number }>,
  memberId: Id<"members">,
): number {
  return sum(entries.filter((e) => e.memberId === memberId))
}
