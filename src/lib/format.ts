/**
 * Money is stored and manipulated as an integer number of paise everywhere.
 * Never a float, never a decimal string, never currency units. See
 * docs/ARCHITECTURE.md -> "Money is integer paise".
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** ₹1,23,456 — grouped the Indian way (lakh/crore). */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100)
}

/** ₹1,23,456.78 — for amounts that can carry paise. */
export function formatPaisePrecise(paise: number): string {
  return inrPrecise.format(paise / 100)
}

/** Compact form for chart axes and dense tiles: ₹1.2L, ₹3.4Cr. */
export function formatPaiseCompact(paise: number): string {
  const rupees = paise / 100
  const abs = Math.abs(rupees)
  const sign = rupees < 0 ? "-" : ""
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`
  return `${sign}₹${abs.toFixed(0)}`
}

/** Build paise from a rupee amount typed by a human. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Parse a user-typed rupee string. Returns null when unparseable. */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "")
  if (cleaned === "") return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return rupeesToPaise(value)
}

const MONTHS = [
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
]

export const MONTH_LABELS = MONTHS
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

/** Month is 1-indexed to match the stored `month` column. */
export function monthLabel(month: number): string {
  return MONTHS[month - 1] ?? ""
}

export function formatDate(iso: string | number | Date): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function formatDateTime(iso: string | number | Date): string {
  const d = new Date(iso)
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function percent(value: number, total: number): number {
  if (total === 0) return 0
  return (value / total) * 100
}
