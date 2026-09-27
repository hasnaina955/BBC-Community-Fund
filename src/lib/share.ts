import { formatPaise } from "@/lib/format"
import { monthLabel } from "@/lib/format"

/**
 * Sharing a balance, the way this community actually shares things.
 *
 * A member who wants to show their balance to a spouse or a cousin is not going
 * to download a PDF for it. They are going to forward a message. So the share
 * target is a chat, and the payload is text that reads correctly as text — not a
 * screenshot, and not a link that requires the recipient to already have an
 * account to see anything useful.
 *
 * Three fallbacks, in order, because this runs on cheap Android phones as well as
 * on a treasurer's laptop:
 *
 *   1. `navigator.share` — the native sheet, which lists WhatsApp by name and
 *      needs no URL scheme guessing. This is the good path and the one most
 *      phones will take.
 *   2. An explicit `wa.me` link. Used when the Web Share API is missing (older
 *      Android, desktop Firefox) so the button still does the obvious thing
 *      rather than silently copying text and telling nobody.
 *   3. The clipboard, with a confirmation, because a share button that does
 *      nothing visible is worse than no button.
 *
 * The text carries the *figures*, not just the link. A recipient who does not
 * have an account still learns what is owed, which is the entire point of asking.
 */

export interface ShareBalanceInput {
  name: string
  orgName: string
  month: number
  year: number
  currentMonthPaise: number
  arrearsPaise: number
  arrearsMonths: number
  totalOutstandingPaise: number
  totalReceivedPaise: number
  paymentCount: number
}

/** The statement, as a WhatsApp message. Also used for the clipboard fallback. */
export function balanceMessage(input: ShareBalanceInput, path = "/me"): string {
  const lines = [
    `*${input.orgName}* — ${input.name}`,
    "",
    `${monthLabel(input.month)} ${input.year}: ${formatPaise(input.currentMonthPaise)}`,
    input.arrearsMonths > 0
      ? `Arrears (${input.arrearsMonths} ${input.arrearsMonths === 1 ? "month" : "months"}): ${formatPaise(input.arrearsPaise)}`
      : "Arrears: none",
    `*Total outstanding: ${formatPaise(input.totalOutstandingPaise)}*`,
    "",
    `Paid to date: ${formatPaise(input.totalReceivedPaise)} over ${input.paymentCount} ${input.paymentCount === 1 ? "payment" : "payments"}`,
  ]

  // The link is appended rather than baked in at build time so the message is
  // correct whichever origin the app is being served from — the hosted preview, a
  // LAN address during the Friday collection, or a deployment.
  if (typeof window !== "undefined") {
    lines.push("", `Open your passbook: ${window.location.origin}${path}`)
  }

  return lines.join("\n")
}

/** The `wa.me` deep link for this message. */
export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export type ShareOutcome = "shared" | "whatsapp" | "copied" | "failed"

/**
 * Share the balance, using the best mechanism the device offers.
 *
 * Returns what happened so the caller can say so. A share that reports nothing is
 * a share the member cannot trust worked.
 */
export async function shareBalance(input: ShareBalanceInput): Promise<ShareOutcome> {
  const text = balanceMessage(input)

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: `${input.orgName} balance`, text })
      return "shared"
    } catch (err) {
      // A user who dismisses the share sheet has not failed — and must not be
      // told they have. Only an actual failure falls through to the next method.
      if (err instanceof DOMException && err.name === "AbortError") return "shared"
    }
  }

  if (typeof window !== "undefined") {
    const opened = window.open(whatsappLink(text), "_blank", "noopener")
    if (opened) return "whatsapp"
  }

  try {
    await navigator.clipboard.writeText(text)
    return "copied"
  } catch {
    return "failed"
  }
}
