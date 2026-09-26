import type { DataModel, Id } from "../_generated/dataModel"

/**
 * How a fund is collected, and the rules that follow from it.
 *
 * The single most important rule in this file: **a fund only has dues if it is
 * `fixed_monthly`**. Every path that could turn money into a debt — arrears,
 * defaulters, waivers, the collection grid, reminders — must go through
 * `hasDues` or `isScheduled`. Without that, the voluntary Friday fund gets
 * reported as ~every member being in arrears every month, which is nonsense
 * and would make the whole tool untrustworthy.
 */

type FundDoc = DataModel["funds"]["document"]

export type CollectionMode = NonNullable<FundDoc["collectionMode"]>

/** Reads normalise a missing value (rows written before the field existed). */
export function modeOf(fund: { collectionMode?: CollectionMode }): CollectionMode {
  return fund.collectionMode ?? "fixed_monthly"
}

/** True only for funds where every active member owes a fixed amount. */
export function hasDues(fund: { collectionMode?: CollectionMode }): boolean {
  return modeOf(fund) === "fixed_monthly"
}

/** True for funds with a periodic schedule worth showing as a grid. */
export function isScheduled(fund: { collectionMode?: CollectionMode }): boolean {
  return modeOf(fund) === "fixed_monthly"
}

/** True for funds where money arrives as it is given, not against a schedule. */
export function isUnscheduled(
  fund: { collectionMode?: CollectionMode },
): boolean {
  return modeOf(fund) === "voluntary" || modeOf(fund) === "donation"
}

/** True for funds where a promise precedes payment. */
export function hasPledges(
  fund: { collectionMode?: CollectionMode },
): boolean {
  return modeOf(fund) === "pledge_based"
}

/**
 * Throws if the caller tried to create a due for a fund that has no dues.
 *
 * This is the enforcement point: `generateMonth` and `createContribution` call
 * it, so an unscheduled fund can never acquire a grid or an arrears list even
 * by accident.
 */
export function assertHasDues(
  fund: { collectionMode?: CollectionMode; name?: string },
): void {
  if (!hasDues(fund)) {
    throw new Error(
      `"${fund.name ?? "This fund"}" is ${modeOf(fund)}, so members do not owe it anything. ` +
        "Only a fixed_monthly fund has dues.",
    )
  }
}

export type FundId = Id<"funds">
