import type { ReminderChannel, ReminderKind } from "./notify"

/**
 * Deciding who to chase, and what to say.
 *
 * This is the part of M5 that is a treasury judgement rather than an API call,
 * and it is deliberately a set of **pure functions over already-resolved facts**.
 * The button in the UI and the scheduled monthly run both go through here, so
 * the two cannot disagree about who is a defaulter — which is the same discipline
 * `lib/arrears.ts` exists to enforce for the reports page.
 *
 * Two decisions live here, and both are recorded as code rather than left to
 * whoever runs the job, because "who did we email" is only answerable if the
 * answer was written down before it was asked for.
 *
 *   1. **Which template.** A member one day past due and a member thirty months
 *      past due are not the same conversation, and sending either of them the
 *      other's message is how a reminder becomes an annoyance.
 *   2. **Which channel.** Not a preference order, a fit: an arrears summary is a
 *      long message with a link in it and has no business arriving by SMS, while
 *      a "you are one day late" note is two lines and is read far more reliably
 *      on a feature phone than in an inbox nobody opens.
 */

export type SkipReason = "opted_out" | "no_destination" | "already_reminded"

export interface MemberContact {
  memberId: string
  name: string
  email?: string
  phone?: string
  /** Absent means "never been asked" — which is consent, not refusal. */
  preferences?: { email?: boolean; sms?: boolean; whatsapp?: boolean } | null
}

export interface MemberArrears {
  memberId: string
  amountPaise: number
  /** Unpaid months, counted from the due rows rather than from the money. */
  months: number
  daysPastDue: number
  oldestMonth?: string
}

/** What a run decided, per member. */
export interface PlannedReminder {
  memberId: string
  kind: ReminderKind
  channel: ReminderChannel
  destination: string
  amountPaise: number
  months: number
  daysPastDue: number
  oldestMonth?: string
}

export interface SkippedMember {
  memberId: string
  reason: SkipReason
}

/** The period a scheduled run is keyed on. ISO `YYYY-MM`. */
export function periodOf(asOf: Date): string {
  return `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Which of the three conversations this member's position calls for.
 *
 * The thresholds are the whole function, so they are stated once:
 *
 *   - **Not yet due** → `due_soon`. There is no debt here, and the wording must
 *     not imply one. A "friendly reminder" that says the word arrears is a
 *     complaint waiting to happen.
 *   - **Up to two months behind** → `overdue`. Recent enough that the member
 *     plausibly simply forgot, which is the situation where naming the month
 *     and offering a link is most likely to work.
 *   - **Three months or more** → `arrears_summary`. This is the one where the
 *     problem is no longer a missed payment but a conversation, and the template
 *     says so — it offers to arrange something rather than demanding money.
 */
export function templateFor(arrears: MemberArrears): ReminderKind {
  if (arrears.daysPastDue <= 0) return "due_soon"
  if (arrears.months >= 3) return "arrears_summary"
  return "overdue"
}

/**
 * Whether a member accepts a channel.
 *
 * Absence is consent. A membership roster is a list of people the community
 * already phones; a member who never opened a settings page has not refused
 * anything, and defaulting them to silence would mean reminders only ever reach
 * the people who already ignore them.
 */
export function accepts(
  contact: MemberContact,
  channel: ReminderChannel,
): boolean {
  return contact.preferences?.[channel] !== false
}

/**
 * Where a member can actually be reached, on the channel that suits the message.
 *
 * The fit is by length, not by preference: a summary with a statement link in it
 * is an email, and everything short is SMS if they have a handset number —
 * because in this community the phone is the reliable one and the inbox is
 * usually a dead address.
 */
export function channelFor(
  contact: MemberContact,
  kind: ReminderKind,
): { channel: ReminderChannel; destination: string } | null {
  const wantsSummary = kind === "arrears_summary"

  const email = contact.email?.trim()
  if (email && accepts(contact, "email")) return { channel: "email", destination: email }

  const phone = normalisePhone(contact.phone)
  if (phone && accepts(contact, "whatsapp") && wantsSummary) {
    // WhatsApp can carry a long message, so it is the fallback for a summary
    // when there is no inbox — better than telling them to look at a link in a
    // message that got cut off by a 160-character limit.
    return { channel: "whatsapp", destination: phone }
  }
  if (phone && accepts(contact, "sms")) return { channel: "sms", destination: phone }
  if (phone && accepts(contact, "whatsapp")) return { channel: "whatsapp", destination: phone }

  return null
}

/**
 * Indian mobile numbers, in the one form SMS providers accept.
 *
 * A roster that has been typed in by hand over eight years contains `+91 98765
 * 43210`, `09876543210` and `98765-43210` in roughly equal measure, and all three
 * are the same handset. Normalising here means the delivery log is comparable
 * and a bounce is recognisable as a *person* rather than as a formatting slip.
 */
export function normalisePhone(raw?: string): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 12 && digits.startsWith("91")) return digits
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`
  if (digits.length === 10) return `91${digits}`
  return undefined
}

/** The public statement URL a reminder points at. */
export function statementUrlFor(origin: string, memberId: string): string {
  return `${origin.replace(/\/$/, "")}/me/statement?member=${encodeURIComponent(memberId)}`
}

/**
 * Build a run from a roster and its arrears.
 *
 * Returns what to send and what to skip, with the reason for each skip. The
 * reasons are not diagnostics: they are what makes a treasurer's "you reminded
 * 61 people" answerable, and they are the evidence that somebody who asked not
 * to be contacted was not contacted anyway.
 *
 * `alreadyReminded` is passed in rather than looked up, because the caller has
 * to read the index to answer it and doing it twice would be a second scan of
 * the reminder log per member.
 */
export function planRun(args: {
  contacts: MemberContact[]
  arrears: MemberArrears[]
  alreadyReminded: Set<string>
  origin: string
}): { planned: PlannedReminder[]; skipped: SkippedMember[] } {
  const byMember = new Map(args.arrears.map((a) => [a.memberId, a]))
  const planned: PlannedReminder[] = []
  const skipped: SkippedMember[] = []

  for (const contact of args.contacts) {
    const owed = byMember.get(contact.memberId)
    if (!owed) continue

    if (args.alreadyReminded.has(contact.memberId)) {
      skipped.push({ memberId: contact.memberId, reason: "already_reminded" })
      continue
    }

    const kind = templateFor(owed)
    const target = channelFor(contact, kind)
    if (!target) {
      skipped.push({ memberId: contact.memberId, reason: "no_destination" })
      continue
    }

    planned.push({
      memberId: contact.memberId,
      kind,
      channel: target.channel,
      destination: target.destination,
      amountPaise: owed.amountPaise,
      months: owed.months,
      daysPastDue: owed.daysPastDue,
      oldestMonth: owed.oldestMonth,
    })
  }

  return { planned, skipped }
}

/** Human wording for a skip, shared by the UI and the audit row. */
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  opted_out: "asked not to be reminded",
  no_destination: "no email or phone on file",
  already_reminded: "already reminded this period",
}
