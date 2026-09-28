/**
 * The reminder seam, and the templates.
 *
 * ## Why this file exists
 *
 * Chasing a member for a contribution is a *treasury decision*, not a vendor
 * call. Which template applies, who is excluded because they asked not to be
 * contacted, how many months someone is behind, and what the money is — all of
 * that has to be settled on our side of the boundary, and all of it has to be
 * right before a single message leaves the building.
 *
 * So the templates live here as pure functions over server-resolved facts, and
 * the transport is an interface with a local stub underneath it. That ordering
 * is the whole design: swapping the provider is a dropped-in file, and a message
 * that reads badly is a bug in `renderReminder`, not something a vendor's
 * template editor can paper over.
 *
 * This mirrors `lib/payments.ts` deliberately. M4's gateway has the same shape
 * and the same reason — the committee has not chosen a provider, and a decision
 * deferred to them should not cost a re-argue of the architecture when it is
 * finally made.
 *
 * ## The rules this module enforces
 *
 *   - **Money is integer paise across the boundary**, and is never recomputed
 *     here. `ReminderFacts.amountPaise` arrives resolved from the member's open
 *     dues; a template that could add anything up is a template that can be
 *     wrong.
 *   - **The provider is never asked what somebody owes.** It gets a rendered
 *     string. This is the same rule as the payment seam, and for the same
 *     reason: a message that says the wrong number is a complaint, and the
 *     vendor's copy is the last place to discover it.
 *   - **No network in the stub**, so the whole verification suite keeps passing
 *     with no account, no keys and no egress.
 */

/** The three things a treasurer sends, which are three different conversations. */
export type ReminderKind = "due_soon" | "overdue" | "arrears_summary"

export type ReminderChannel = "email" | "sms" | "whatsapp"

/**
 * Everything a template is allowed to know.
 *
 * Deliberately a closed set. If a template needs a new fact, that is a decision
 * about what a member is told, and it belongs in this interface where it can be
 * argued about — not spread across the call sites that happen to have it handy.
 */
export interface ReminderFacts {
  /** The member's name, as the community knows them. */
  memberName: string
  /** The organisation, as a member would recognise it in an inbox. */
  orgName: string
  /** The fund being chased, when the reminder is about one fund. */
  fundName?: string
  /** Paise owed, already resolved server-side. */
  amountPaise: number
  /** How many months the money covers. `0` for a due-soon note about next month. */
  months: number
  /** `March 2024` — the oldest unpaid month, for the overdue templates. */
  oldestMonth?: string
  /** Days past due at the moment of rendering. `0` for a due-soon note. */
  daysPastDue: number
  /** Where the member can look at the whole picture. */
  statementUrl: string
}

/** A rendered message, before any transport. */
export interface RenderedReminder {
  kind: ReminderKind
  subject: string
  body: string
}

/** Format paise as the rupees string a member reads. */
function rupees(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** `1 month` / `3 months`, because "1 months" is the kind of thing that gets a complaint. */
function months(n: number): string {
  return n === 1 ? "1 month" : `${n} months`
}

/**
 * Render one reminder.
 *
 * The three templates say genuinely different things and are not three phrasings
 * of one message:
 *
 *   - **due_soon** asks for money that is not yet owed. It must not use the word
 *     arrears, and it must not say "overdue" — the due date is the 10th, and a
 *     member who pays on the 12th has not done anything wrong.
 *   - **overdue** is about a single missed obligation, and names the month. A
 *     member who does not remember paying for March needs to be told *March*.
 *   - **arrears_summary** is the annual one: many months, a total, and an offer
 *     to talk. It is the only template that may suggest settling a lump sum.
 */
export function renderReminder(kind: ReminderKind, facts: ReminderFacts): RenderedReminder {
  const amount = rupees(facts.amountPaise)
  const org = facts.orgName
  const where = facts.fundName ? ` for ${facts.fundName}` : ""

  if (kind === "due_soon") {
    return {
      kind,
      subject: `${org}: your ${facts.months > 0 ? "contribution" : "monthly contribution"} is due soon`,
      body: [
        `Assalamu alaikum ${facts.memberName},`,
        ``,
        `A reminder that ${amount}${where} will fall due shortly${facts.months > 0 ? `, covering ${months(facts.months)}` : ""}.`,
        `Nothing is late yet — dues are payable on the 10th of each month, and this is a note beforehand.`,
        ``,
        `You can see the whole picture, and pay, here: ${facts.statementUrl}`,
        ``,
        `If you have already paid, please ignore this.`,
        ``,
        org,
      ].join("\n"),
    }
  }

  if (kind === "overdue") {
    return {
      kind,
      subject: `${org}: ${amount} is outstanding${where}`,
      body: [
        `Assalamu alaikum ${facts.memberName},`,
        ``,
        `${amount} for ${facts.oldestMonth ?? "a past month"}${where} is still outstanding — ${facts.daysPastDue} day${facts.daysPastDue === 1 ? "" : "s"} past the due date.`,
        ``,
        `If you have paid and this is a mistake, please reply and we will look at it the same day.`,
        `Otherwise you can see what is owed, and settle it, here: ${facts.statementUrl}`,
        ``,
        org,
      ].join("\n"),
    }
  }

  const settled = facts.months > 0 ? `covering ${months(facts.months)}` : ""
  return {
    kind,
    subject: `${org}: a summary of what is outstanding`,
    body: [
      `Assalamu alaikum ${facts.memberName},`,
      ``,
      `${amount}${where ? ` for ${facts.fundName}` : ""} is outstanding${settled ? `, ${settled}` : ""}${facts.oldestMonth ? `, going back to ${facts.oldestMonth}` : ""}.`,
      ``,
      `If settling it all at once is difficult, that is a normal thing to say and an easy one to arrange — please get in touch and we will work something out.`,
      ``,
      `Every figure here, month by month, is here: ${facts.statementUrl}`,
      ``,
      org,
    ].join("\n"),
  }
}

/**
 * A short enough version for SMS and WhatsApp.
 *
 * SMS has a hard length budget and no subject line, and a reminder that gets
 * truncated mid-sentence is worse than no reminder. So this is a *separate*
 * render, not the email body with the edges taken off, and it drops the prose
 * rather than compressing it.
 */
export function renderSms(facts: ReminderFacts): string {
  const amount = rupees(facts.amountPaise)
  return (
    `${facts.orgName}: ${amount}${facts.months > 0 ? ` for ${months(facts.months)}` : ""} is outstanding` +
    `${facts.daysPastDue > 0 ? ` (since ${facts.oldestMonth ?? "last month"})` : ""}. ` +
    `See your statement: ${facts.statementUrl}`
  )
}

/* -------------------------------------------------------------------------- */

/** What a transport has to be able to do. Nothing more. */
export interface NotifyProvider {
  readonly name: string
  /**
   * Hand one rendered message to a transport.
   *
   * Returns the provider's own id, which is stored as `reminders.reminderId` and
   * is the replay key for delivery events — providers redeliver webhooks, and
   * treating the second one as a new send is how a member gets chased twice.
   */
  send(input: {
    channel: ReminderChannel
    to: string
    subject: string
    body: string
  }): Promise<{ reminderId: string }>
  /**
   * Verify a delivery event. Throws on anything unverified — a provider that has
   * not been configured cannot have signed anything, and that is the correct
   * behaviour rather than a gap to be filled in later.
   */
  verifyDeliveryEvent(rawBody: string, headers: Record<string, string>): DeliveryEvent
}

/** What a transport reports back. */
export interface DeliveryEvent {
  /** The provider's unique id for this event. **This is the replay key.** */
  eventId: string
  /** Our own id, echoed back from the send. */
  reminderId: string
  outcome: "delivered" | "failed"
  reason?: string
  occurredAt: string
}

class OfflineProvider implements NotifyProvider {
  readonly name = "offline"

  async send(input: {
    channel: ReminderChannel
    to: string
    subject: string
    body: string
  }): Promise<{ reminderId: string }> {
    // Not a random id: derived from the destination and the subject, so
    // re-sending the same thing in the same run is stable and an assertion can
    // name it.
    const seed = `${input.channel}:${input.to}:${input.subject}`
    let hash = 0
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
    return { reminderId: `offline_${(hash >>> 0).toString(36)}` }
  }

  verifyDeliveryEvent(_rawBody: string, _headers: Record<string, string>): DeliveryEvent {
    throw new Error(
      "No notification provider is configured, so no delivery event can be genuine.",
    )
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The configured provider.
 *
 * The offline stub is the *shipping state* of this build rather than a degraded
 * mode: the treasury can plan a run, see exactly who would be chased and what
 * they would be told, and stop there. No page may depend on a provider being
 * present, and the whole verification suite keeps passing with none configured.
 */
export function provider(): NotifyProvider {
  return new OfflineProvider()
}

/** True when a real provider is configured. UI copy is allowed to branch on it. */
export function hasProvider(): boolean {
  return false
}
