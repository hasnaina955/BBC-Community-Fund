/**
 * UPI, without a gateway.
 *
 * The committee's decision (docs/M4-PLAN.md §1) is that this application does
 * not collect money. It keeps records. So there is no checkout, no intent that
 * the app fulfils, no webhook, and no confirmation — and the single most
 * important consequence is the one this module exists to make correct:
 *
 *   **A QR code here is a printed instruction, not a transaction.**
 *
 * It encodes a `upi://pay` URI that a member's own UPI app resolves. The money
 * leaves the member, lands in BBC's bank account, and the application never
 * learns that it happened. Nothing in this file creates an order, holds an
 * amount, or reports a success, because there is nothing on the other end to
 * report one to.
 *
 * That is why the URI built here is deliberately **amountless**. A QR that
 * carried `am=100` would look like a checkout and invite a member to believe
 * the app knows what they owe and what they paid. The amount a member sends is
 * theirs to decide at the point of payment; the app's job is to tell them who
 * to pay and how to say so afterwards.
 *
 * ## Why no QR service
 *
 * QR images are drawn locally by `qrcode` from a string this module builds. No
 * third-party generator is called, and nothing is uploaded. A VPA and an IFSC
 * are the organisation's real payment identity — sending them to somebody else's
 * endpoint to render a picture would be giving away the account to receive
 * money into, in exchange for a square of black dots.
 *
 * ## What the payee name is for
 *
 * `pa` is the address; `pn` is the name a UPI app shows on the pay line. The
 * committee has fixed it at **BBC** and it is a constant rather than a setting
 * for one reason: it is the one string in this entire system that a member
 * sees outside the application, and a committee that has chosen it should not be
 * able to change it by accident from a settings screen. Changing it is a
 * deliberate code change, and the IFSC beside it has to change with it, because
 * banks validate the two together.
 */

export const PAYEE_NAME = "BBC"

/** Currency is fixed. This application does not do anything else. */
const CURRENCY = "INR"

/**
 * A UPI address, e.g. `bbc@okicici`.
 *
 * The shape is deliberately narrow: a local part, one `@`, and a provider
 * handle. We accept only what we can render, and we reject rather than
 * repairing — a mistyped VPA produces a QR that scans cleanly and pays nobody,
 * which is the worst possible failure for a printed sign.
 */
export const VPA_PATTERN = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-_]{2,64}$/

/**
 * IFSC: 4 letters for the bank code, a literal `0`, then 6 alphanumerics — 11
 * characters in total, which is the RBI's own layout. `isValidIfsc` is not used
 * to gate anything today; it is here so the field can be checked the same way
 * the VPA is, and so a future form does not reinvent the rule.
 */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/

export function isValidVpa(value: string | null | undefined): value is string {
  return typeof value === "string" && VPA_PATTERN.test(value.trim())
}

export function isValidIfsc(value: string | null | undefined): value is string {
  return typeof value === "string" && IFSC_PATTERN.test(value.trim().toUpperCase())
}

/**
 * Percent-encode a UPI parameter value.
 *
 * The `upi://pay` URI is not a web URL and has no forgiving parser on the other
 * end — every mainstream UPI app splits on `&` and `=`. A note containing an
 * `&` or a space silently truncates what the member sees, and a name
 * containing a `#` is worse: it makes the rest of the payload a fragment that
 * the app discards. So encode, rather than interpolating.
 */
function encodeParam(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export interface UpiIntentInput {
  /** The VPA money is sent to. Must already be valid — see `isValidVpa`. */
  vpa: string
  /**
   * A short note the payer sees in their UPI app, e.g. a fund name or a month.
   *
   * Optional on purpose. A note is a convenience for the payer, not a
   * reference the application will ever look up, and an invented reference is
   * worse than none — it invites a treasurer to search for a matching entry and
   * trust a match. The member's own reference is added by their bank.
   */
  note?: string
}

/**
 * The string a QR code encodes.
 *
 * Deliberately absent: `am` (amount) and `tr` (a transaction reference this
 * system would track). See the note at the top of this file — a QR that looked
 * like a checkout would misrepresent what this application can do.
 *
 * `cu` (currency) is always INR and is not an argument, because a second
 * currency in a community fund's UPI address is a bug, not a feature.
 */
export function upiIntentUri({ vpa, note }: UpiIntentInput): string {
  const params = [
    `pa=${encodeParam(vpa.trim())}`,
    `pn=${encodeParam(PAYEE_NAME)}`,
    `cu=${CURRENCY}`,
  ]
  const trimmed = note?.trim()
  if (trimmed) params.push(`tn=${encodeParam(trimmed)}`)
  return `upi://pay?${params.join("&")}`
}

/**
 * Copy suitable for a printed sign or a member's phone screen.
 *
 * Grouped as `abcd 1234 efgh`, because a 16-digit account number read aloud
 * over a phone to a bank branch is transcribed wrongly, and nobody notices
 * until a transfer is made to the wrong account.
 */
export function formatAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, "")
  return digits.replace(/(.{4})/g, "$1 ").trim()
}
