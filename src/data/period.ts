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

/**
 * Every year the year-pickers may offer, oldest first.
 *
 * This community started in 2018, so a two-year picker would hide almost all of
 * its history — the year a fund was founded, the year the mosque rebuild began,
 * the year someone left a long unpaid run of dues. The lower bound comes from
 * the shell's `yearRange`, which the server derives from the member join dates,
 * so it is correct for any organisation rather than a hard-coded 2018.
 */
export function yearsInRange(from: number, to: number = CURRENT_YEAR): number[] {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const years: number[] = []
  for (let y = end; y >= start; y -= 1) years.push(y)
  return years
}
