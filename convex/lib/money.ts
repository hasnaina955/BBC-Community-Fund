/**
 * Money is integer paise on the server too. The server never accepts a
 * formatted string or a float, and never returns one.
 *
 * See docs/ARCHITECTURE.md -> "Money is integer paise".
 */

export const RUPEE = 100
export const LAKH = 100_000 * RUPEE
export const CRORE = 10_000_000 * RUPEE

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3)) as unknown as readonly string[]

/** Month is 1-indexed everywhere, matching the stored column. */
export function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Month must be an integer between 1 and 12")
  }
}

export function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Year must be between 2000 and 2100")
  }
}

/**
 * Reject anything that is not a safe integer of paise. A float sneaking in
 * here is the exact bug this project is trying to avoid, so it is checked at
 * the boundary rather than trusted.
 */
export function assertPaise(amount: number, label = "Amount"): void {
  if (!Number.isInteger(amount)) {
    throw new Error(`${label} must be an integer number of paise`)
  }
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`${label} is out of range`)
  }
}

export function assertPositive(amount: number, label = "Amount"): void {
  assertPaise(amount, label)
  if (amount <= 0) throw new Error(`${label} must be greater than zero`)
}

export function rupeesToPaise(rupees: number): number {
  assertPaise(Math.round(rupees * RUPEE), "Amount")
  return Math.round(rupees * RUPEE)
}

export const sumPaise = (values: number[]): number =>
  values.reduce((acc, v) => acc + v, 0)

/** ISO date string for "now", used for every effective date the server writes. */
export const nowIso = (): string => new Date().toISOString()

/** `YYYY-MM-DD` for a given year/month/day, in UTC. */
export function isoDate(year: number, month: number, day: number): string {
  assertMonth(month)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}
