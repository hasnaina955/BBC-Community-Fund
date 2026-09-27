import { MONTHS } from "./money"

/**
 * Arrears ageing.
 *
 * Two things live here, and both are things more than one screen needs to agree
 * on:
 *
 *   1. **When a due was payable.** `contributions.dueDate` is optional and only
 *      written by `members:generateMonth`, so the eight years of imported history
 *      have none. Ageing therefore needs a convention, and the convention is the
 *      one the generator already uses: the 10th of the month being charged. A
 *      member's September dues are chased from 10 October. Deriving it here
 *      rather than per screen is what stops the reports page and the reminders
 *      of M5 from disagreeing about who is a defaulter.
 *
 *   2. **Which bucket a due falls in.** Ageing by *months owed* — the previous
 *      "1 month / 2 months / 3+ months" — answers a different question from the
 *      one a treasurer asks. Someone owing ₹100 from 2019 and someone owing
 *      ₹1,000 from last month are both "3+ months" under month-counting, and
 *      they are not remotely the same problem. Ageing by *days past due* is the
 *      standard receivables presentation and is what the roadmap asks for:
 *      current, 30, 60, 90+.
 *
 * As with everything else here, only `fixed_monthly` funds ever reach this file.
 * Callers filter by `hasDues` first — see `aggregate:reports`.
 */

/** Day of the month on which that month's dues fall due. */
export const DUE_DAY_OF_MONTH = 10

/** An ISO `YYYY-MM-DD` date for the given year, month and day. */
function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

type DueLike = { year: number; month: number; dueDate?: string | null }

/**
 * The date a due became payable.
 *
 * A stored `dueDate` always wins; it is the only way an individual month can
 * have had its date changed (a committee decision to extend the deadline, say).
 * Everything else falls back to the convention.
 */
export function dueDateOf(due: DueLike): string {
  return due.dueDate ?? iso(due.year, due.month, DUE_DAY_OF_MONTH)
}

/** Whole days between `dueDate` and `asOf`. Negative means not yet due. */
export function daysPastDue(dueDate: string, asOf: Date): number {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00.000Z`)
  const now = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  )
  return Math.floor((now - due) / 86_400_000)
}

/**
 * The ageing buckets, oldest last.
 *
 * `key` is what the read model returns and the UI keys on; `label` is what a
 * human reads. "Not yet due" is included deliberately: a due dated the 28th of
 * this month is outstanding money, and hiding it would make the buckets not add
 * up to the arrears total printed beside them.
 */
export const AGING_BUCKETS = [
  { key: "current", label: "Not yet due", hint: "due date ahead" },
  { key: "d30", label: "1–30 days", hint: "overdue up to a month" },
  { key: "d60", label: "31–60 days", hint: "overdue one to two months" },
  { key: "d90", label: "61–90 days", hint: "overdue two to three months" },
  { key: "d90plus", label: "Over 90 days", hint: "chase or write off" },
] as const

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"]

export function bucketFor(days: number): AgingKey {
  if (days <= 0) return "current"
  if (days <= 30) return "d30"
  if (days <= 60) return "d60"
  if (days <= 90) return "d90"
  return "d90plus"
}

export interface BucketTotals {
  key: AgingKey
  label: string
  hint: string
  count: number
  totalPaise: number
  /** Distinct members with at least one due in this bucket. */
  members: number
}

/**
 * Bucket a set of open dues by how long they have been outstanding.
 *
 * A member can appear in more than one bucket — owing March and August puts them
 * in two rows — so `members` is a per-bucket distinct count and deliberately does
 * not sum to the overall defaulter count. `totalPaise` does sum to the arrears
 * total, because every paise lands in exactly one bucket.
 */
export function ageDues(
  dues: Array<{ memberId: string; amountPaise: number } & DueLike>,
  asOf: Date,
): BucketTotals[] {
  const byBucket = new Map<AgingKey, { count: number; totalPaise: number; members: Set<string> }>()
  for (const bucket of AGING_BUCKETS) {
    byBucket.set(bucket.key, { count: 0, totalPaise: 0, members: new Set() })
  }

  for (const due of dues) {
    const key = bucketFor(daysPastDue(dueDateOf(due), asOf))
    const slot = byBucket.get(key)!
    slot.count += 1
    slot.totalPaise += due.amountPaise
    slot.members.add(due.memberId)
  }

  return AGING_BUCKETS.map((bucket) => {
    const slot = byBucket.get(bucket.key)!
    return {
      key: bucket.key,
      label: bucket.label,
      hint: bucket.hint,
      count: slot.count,
      totalPaise: slot.totalPaise,
      members: slot.members.size,
    }
  })
}

/**
 * The oldest single unpaid month, per member.
 *
 * Reported next to the buckets because the bucket a member lands in is decided by
 * their *oldest* due, while their total may span several. "3+ months" used to
 * mean "at least three months' worth of dues" and this is the honest version of
 * the same idea: how long has this person actually been avoiding us?
 */
export function oldestDuePerMember(
  dues: Array<{ memberId: string } & DueLike>,
  asOf: Date,
): Map<string, { dueDate: string; days: number }> {
  const oldest = new Map<string, { dueDate: string; days: number }>()
  for (const due of dues) {
    const dueDate = dueDateOf(due)
    const days = daysPastDue(dueDate, asOf)
    const current = oldest.get(due.memberId)
    if (!current || days > current.days) oldest.set(due.memberId, { dueDate, days })
  }
  return oldest
}

/** `March 2024`, for the oldest-due column. */
export function monthYearOf(dueDate: string): string {
  const month = Number(dueDate.slice(5, 7))
  return `${MONTHS[month - 1] ?? ""} ${dueDate.slice(0, 4)}`.trim()
}
