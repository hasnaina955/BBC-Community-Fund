/**
 * The current collection period.
 *
 * These were constants in the old `src/data/seed.ts`. The seed data itself now
 * lives in `convex/seed.ts` and is loaded from the database, so this module is
 * only the "where are we in the year" helpers the screens need.
 *
 * `MONTHS_ELAPSED` is derived from the clock rather than hard-coded, so the
 * collection grid and reports stay correct in January as well as September.
 */

export const TODAY = new Date()

/** Collection months are 1-indexed, matching the stored `month` column. */
export const CURRENT_YEAR = TODAY.getFullYear()
export const CURRENT_MONTH = TODAY.getMonth() + 1
export const MONTHS_ELAPSED = CURRENT_MONTH

/** The two years the collection grid offers. */
export const GRID_YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR] as const
