/**
 * The online-payments seam.
 *
 * ## Why this file exists, and why it ships before anything uses it
 *
 * The gateway for M4 is not chosen — see docs/M4-PLAN.md for the survey and the
 * four questions only the committee can answer. What is settled is the rule that
 * a provider must be *swappable without touching the ledger*, and that rule needs
 * a place to live before there is anything to swap.
 *
 * So the interface ships now, with a local stub, and nothing calls it. That is
 * the whole point: choosing a provider later is a dropped-in file, not a
 * migration, and a decision deferred to the committee does not cost a re-argue of
 * the architecture when it is finally made.
 *
 * The two things deliberately **not** built here, because building them early
 * would be building for a provider nobody has chosen:
 *
 *   - No retry framework, no multi-provider routing, no per-provider feature
 *     flags. A second implementation is what justifies an abstraction, and there
 *     is not one yet.
 *   - No network calls in the stub. A stub that reaches for the network is not a
 *     stub, and the whole reason this can exist while the decision is open is
 *     that it works with no account, no keys and no network.
 *
 * ## What must never happen here
 *
 * **This module must not know how money is recorded.** It creates intents and
 * parses events. The moment a captured payment becomes a receipt and a ledger
 * entry, that is `lib/collection.recordPaymentFor`, called from a mutation, and
 * the provider is an argument to it rather than a participant in it. A second
 * path from "the provider said yes" to "the books moved" is the one bug in this
 * area that cannot be walked back, because a balance that double-counts does not
 * announce itself — it just stops reconciling months later, and by then nobody
 * can tell which entries are real.
 */

/** Money is integer paise everywhere, including across this boundary. */
export interface IntentInput {
  orgId: string
  fundId?: string
  memberId?: string
  roundId?: string
  /**
   * The amount to collect, **already resolved on the server** from the member's
   * open contributions. It is passed in rather than computed here so that the
   * provider can never be the thing that decides what somebody owes.
   */
  amountPaise: number
  /**
   * What the member will see in their UPI app, and on the payee line. For a
   * community organisation this is the single most visible string in the whole
   * product, and "Community Fund" is not an acceptable answer to it — which is
   * why it is an argument rather than a constant.
   */
  payeeName: string
  /** The note a payer sees. Contribution reference, fund name, month. */
  note: string
}

export interface PaymentIntent {
  /** Opaque handle we store — an order id, in every candidate's terms. */
  providerId: string
  /** Paise. The provider is not trusted to echo this back; see `verifyWebhook`. */
  amountPaise: number
  /** Where the member is sent to pay. A UPI intent or a hosted checkout. */
  redirectUrl: string
  /**
   * A QR with the amount embedded, for members on a feature phone or sharing to
   * a second device. Optional: a provider that only issues links omits it.
   */
  qrImagePng?: string
  /** Epoch millis. An unpaid intent is not a payment. */
  expiresAt: number
}

export interface GatewayEvent {
  /**
   * The provider's own unique id for this event. **This is the replay key.**
   *
   * Everything that keeps a duplicate delivery from double-counting rests on it,
   * so the webhook path must store it *before* recording any money and discard
   * anything it has already seen. A check made after the fact has a window in
   * which two copies both pass it.
   */
  eventId: string
  /** The provider's event name, verbatim, for the exceptions log. */
  kind: string
  outcome: "succeeded" | "failed" | "refunded" | "ignored"
  /** The intent this event belongs to, resolved from the provider's reference. */
  providerOrderId: string
  providerPaymentId?: string
  /**
   * What the provider *says* it collected. Compared against the intent's stored
   * amount and refused on a mismatch — never used to decide what was paid.
   */
  amountPaise: number
  /** Provider time as an ISO string, not ours: clock skew is the provider's. */
  occurredAt: string
  /** Mapped onto the `method` union the ledger already understands. */
  method: "upi" | "card" | "transfer"
  reference: string
}

export interface PaymentsProvider {
  /** Stable identifier, stored on every row so a later swap stays auditable. */
  readonly name: string

  createIntent(input: IntentInput): Promise<PaymentIntent>

  /**
   * Verify and parse a webhook delivery.
   *
   * `rawBody` is a **string of the exact bytes the provider sent**, not a
   * parsed object, and that is the single most important thing on this
   * interface. Every candidate signs a hash of the request body, and parsing it
   * into an object and re-serialising changes the bytes — which fails
   * verification for a delivery that was entirely genuine. A provider that took
   * `unknown` here would be a provider that rejects its own webhooks, and the
   * failure would look like a forged request.
   *
   * Implementations must throw on a bad signature, and must not have written
   * anything to the database by the time they do.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): GatewayEvent

  /**
   * Test-only. Drives the *real* confirmation path with a synthetic event, so
   * the idempotency and ledger assertions exercise production code rather than a
   * mock of it.
   *
   * This is not a convenience. A local Convex backend serves no HTTP routes at
   * all — proven in M3, where even Convex Auth's own `addHttpRoutes` 404s — so a
   * webhook cannot be exercised locally under any circumstances. This is the only
   * way to assert that a replayed event does not double-count, and it must not
   * be allowed to grow into a second implementation of the write path.
   */
  simulateSucceeded(intent: PaymentIntent, opts?: { eventId?: string }): Promise<GatewayEvent>
}

/* -------------------------------------------------------------------------- */

/**
 * A provider that does not exist yet.
 *
 * It mints a well-formed intent and refuses to lie about having received
 * anything. Every code path that would eventually call a gateway is reachable
 * and testable through it, which is what lets the surrounding machinery ship
 * while the decision is open.
 */
class OfflineProvider implements PaymentsProvider {
  readonly name = "offline"

  async createIntent(input: IntentInput): Promise<PaymentIntent> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error("An online collection needs a positive whole number of paise")
    }

    // Not a random id: it is derived from the organisation, the payer and the
    // amount, so re-requesting an intent for the same thing in the same test run
    // is stable and an assertion can name it.
    const seed = `${input.orgId}:${input.memberId ?? "anon"}:${input.amountPaise}`
    let hash = 0
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) | 0
    }
    const providerId = `offline_${(hash >>> 0).toString(36)}`

    return {
      providerId,
      amountPaise: input.amountPaise,
      // A `upi://` intent is a real URI scheme on a phone. Pointing at a
      // non-existent payee address is deliberate: the stub must never be
      // capable of moving real money by accident, even if a URL leaked out of a
      // test.
      redirectUrl: `upi://pay?pa=offline@stub&pn=${encodeURIComponent(
        input.payeeName,
      )}&am=${(input.amountPaise / 100).toFixed(2)}&tn=${encodeURIComponent(
        input.note,
      )}&tr=${providerId}`,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }
  }

  verifyWebhook(_rawBody: string, _headers: Record<string, string>): GatewayEvent {
    // There is no provider to have sent this, so anything that arrives is by
    // definition unverified. Throwing here is the whole behaviour: the webhook
    // route has to handle it, and that handling is worth having written before
    // there is a real signature to check.
    throw new Error(
      "No online payment provider is configured, so no webhook can be genuine.",
    )
  }

  async simulateSucceeded(
    intent: PaymentIntent,
    opts: { eventId?: string } = {},
  ): Promise<GatewayEvent> {
    return {
      eventId: opts.eventId ?? `offline_evt_${intent.providerId}`,
      kind: "payment.captured",
      outcome: "succeeded",
      providerOrderId: intent.providerId,
      amountPaise: intent.amountPaise,
      occurredAt: new Date().toISOString(),
      method: "upi",
      reference: intent.providerId,
    }
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The configured provider.
 *
 * Returns the offline stub until a provider is chosen and its keys are set, which
 * is the *shipping state* of this build rather than a degraded mode. No page may
 * depend on a provider being present, and the whole verification suite has to
 * keep passing with none configured.
 *
 * Keys are read from the environment, never passed in, so that this function is
 * the only place in the codebase that knows a provider exists at all.
 */
export function provider(): PaymentsProvider {
  return new OfflineProvider()
}

/** True when a real provider is configured. UI copy is allowed to branch on it. */
export function hasProvider(): boolean {
  return false
}
