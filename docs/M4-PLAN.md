# M4 — Online collection: the plan

Status: **gateway decision deferred.** The research is done and recorded below;
what it selected is not adopted. This document therefore has two parts: the
parts of M4 that are *provider-independent* and can be built now, and the part
that is blocked on a decision that is not the engineering's to make.

Nothing here reverses `docs/INTEGRATIONS.md` §Payments. That section stays as
written until a provider is actually chosen and integrated, with a banner
pointing here.

---

## 1. Decision record — deferred, with the findings preserved

### 1.1 What the collection actually has to do

The product's collection modes drive the gateway choice, so they come first.
Across 6 seeded funds, 4 modes:

| Mode | What it means | Online is… |
| --- | --- | --- |
| `fixed_monthly` | Every active member owes ₹100 every month | **The main path.** 84 members × 12 = ~1,000 dues a year |
| `voluntary` | Anyone gives any amount, no schedule | Donation-style links, occasional |
| `event` / `pledge` | Money tied to a dated occasion | A link per round |
| `by_round` (unscheduled) | A collected session, e.g. Friday sarkar | Cash/cheque first, online for those remote |

This is not a checkout. It is a **subscription-shaped, phone-first collection
where a standing instruction is the highest-value thing we could ship**, for 84
mostly-retired members on Android UPI apps.

### 1.2 What the research found

Options surveyed, and the three findings that would decide it:

| | Razorpay | Cashfree | Stripe |
| --- | --- | --- | --- |
| UPI, cards, netbanking | Yes | Yes | Yes, for India-configured accounts |
| Static + dynamic UPI QR with amount & name in the payload | Yes (QR Codes API, `upi://` intent) | Yes | No first-class UPI QR |
| UPI AutoPay **and** eNACH in one integration | Yes | Yes (eNACH, auto-debit, NACH) | Mandates only, no eNACH |
| Zero MDR on standard bank-to-bank UPI | Yes (razorpay.com/pricing) | ~1.9%+ | ~2% TDR |
| AMC | Zero | ₹4,999/yr (matters at this volume) | n/a |
| India self-serve for an Indian community org | Yes | Yes | **No — invite-only** |
| Webhook scheme | `X-Razorpay-Signature` = HMAC-SHA256(raw body, secret) + `x-razorpay-event-id` | HMAC-SHA256 of body+timestamp | `stripe-signature`, timestamped, signed payload |

1. **Stripe is invite-only in India.** Stripe's own India FAQ: *"businesses
   from India must request an invite and aren't able to sign-up for a new Stripe
   account through our website."* An India-native UPI payment method is only
   reachable on an invited account. This is what put the repo's existing Stripe
   pre-commitment under review in the first place — it is not a safe default.
2. **Razorpay and Cashfree are the India-native pair**, and between them the
   decision turns on AMC, documentation quality, and whether recurring
   mandates are wanted at all.
3. **Razorpay is not in the integration catalog.** Two `gravity_index` searches
   — the second explicitly for Razorpay/Cashfree/eNACH — returned "none of the
   provided candidates are payment gateways." Whatever is chosen, keys come from
   the provider's own dashboard, not from this platform.

Sources: razorpay.com/pricing, razorpay.com/docs/webhooks/best-practices,
razorpay.com/docs/payments/qr-codes, support.stripe.com/questions/india-faq,
echai.ventures gateway comparison, techjockey (Cashfree pricing).

### 1.3 Why deferring is cheap — if the seam ships first

The reason this can be deferred without cost is that the one piece of M4 worth
building *first* is the one piece that does not care which provider it is. A
`PaymentsProvider` interface with a local stub, and the tables and mutations
around it, is identical under Razorpay, Cashfree, or a manual-only world. Build
that now and the provider becomes a single file dropped in later. Skip it and
the decision has to be re-litigated against code that assumed the answer.

So: **the deferral is not "do nothing" — it is "build the part that makes the
choice reversible, and stop at the line where money moves."**

### 1.4 Revisit when

The decision is ready to be made when all of these are true:

- The committee has decided **whether online collection is wanted at all** and,
  if so, **who holds the merchant account** (this needs an organisation-name
  account with PAN and a settlement bank — a governance process, not a code
  task, and it will take longer than the code).
- The **payee name** that appears in members' UPI apps has been chosen. It is
  the only part of this system a member actually sees.
- Someone has weighed in on **recurring mandates**. A standing instruction is a
  recurring debit on a member's bank account; that is a committee decision, and
  it is the single feature that most changes which provider wins.

---

## 2. What ships now (M4a) — provider-independent

None of this touches a gateway, and none of it is wasted under any provider.

1. **The `PaymentsProvider` seam.** `convex/lib/payments.ts` — an interface
   plus a deterministic local stub, and a `provider()` selector that returns the
   stub when no keys are present. No Convex types in the interface's return
   values, so a second provider is a new file and nothing else. Its whole
   purpose right now is to make deferral cheap.

   ```ts
   export interface PaymentIntent {
     providerId: string      // opaque; the order id
     amountPaise: number     // never derived from a client-supplied number
     redirectUrl: string     // the UPI intent or checkout URL
     qrImagePng?: string     // for dynamic QR
     note: string            // what the member sees in their UPI app
     expiresAt: number
   }

   export interface GatewayEvent {
     eventId: string         // unique per event — our replay key
     kind: string
     outcome: "succeeded" | "failed" | "refunded" | "ignored"
     providerOrderId: string
     providerPaymentId?: string
     amountPaise: number
     occurredAt: string      // gateway time, not server time
     method: "upi" | "card" | "transfer"
     reference: string
   }

   export interface PaymentsProvider {
     createIntent(input: IntentInput): Promise<PaymentIntent>
     verifyWebhook(rawBody: string, headers: Record<string, string>): GatewayEvent
     simulateSucceeded(intent: PaymentIntent): Promise<void>  // test-only
   }
   ```

   `verifyWebhook` takes the **raw string, not a parsed object**, because HMAC
   must be taken over the exact bytes the provider sent. Parsing then
   re-serialising fails verification. This is the most common way this
   integration is got wrong, and the interface should carry a comment saying so.

2. **The data model.** `gatewayIntents`, `gatewayEvents` (with the provider's
   event id as the idempotency key), and `settlements`. `payments` already has
   `gatewayPaymentId` with a `by_gateway` index, so the schema anticipated this
   and needs no change.

3. **Offline collection as a first-class, measurable flow.** This is the
   roadmap's own "offline collection fully first class: cash and cheque with
   receipt number, collector, and reference" item, and it is provider-free.
   Roughly half of this community's collection is cash at a meeting. M4a makes
   that path good rather than treating it as the thing online collection
   replaces.

4. **Every payment issues a receipt**, on every path, from the same sequential
   `R-#####` sequence. `receipts.ts` needs no new logic.

5. **The exceptions surface.** A list of things that went wrong — unmatched
   payments, amount mismatches, expected-but-missing settlements. It ships
   empty and useful, and the first provider drops into it rather than inventing
   its own.

### 2.1 The one rule that is not negotiable and is set now

`recordPaymentFor(ctx, actor, args)` in `convex/lib/collection.ts` remains the
**only** place money is written. It already does what M4 needs: sequential
receipt numbers, oldest-first settlement of arrears, fund/member/round checks,
and idempotency via the `by_idempotency` index. Whichever provider is chosen
later, it calls that function and nothing else.

A second accounting path is the one failure that is unrecoverable, and M3
already found a seed path that bypassed `truthFromEntries` and silently broke
`balances:verify`. M4 gets its own `check` assertion group for exactly this.

---

## 3. What waits (M4b) — blocked on the decision

- `publicAction startOnlinePayment` and the public `/pay/<orderId>` page.
- The `httpAction` webhook route and `processGatewayEvent`.
- Refund and failure handling as reversing entries.
- Settlement import and the bank leg.
- Per-fund static and dynamic QR, shareable payment links.
- Portal "Pay outstanding", the UPI sheet, the failed-payment row.
- `/me/standing` mandate enrolment.
- Live verification against a real provider — needs a public HTTPS URL and keys.

The exit criteria in `docs/ROADMAP.md` §M4 (a member pays from a link, the
contribution flips, a replayed webhook does not double-count) belong to this
part and cannot be met by M4a.

---

## 4. Design decided now, independent of provider

Deciding these while the provider is open is most of the value of not rushing
the choice.

**Webhook handling.** Verify the signature before parsing anything. Store the
event id and discard replays. Tolerate out-of-order events. Never trust the
amount in the event alone — resolve the intended contribution server-side and
reject a mismatch. A webhook is the only thing that marks a contribution paid;
the client never asserts success. Record failed and refunded payments, with the
contribution reverting. These are the six rules in `docs/INTEGRATIONS.md` and
they are provider-neutral.

**Ordering: claim, then act.** Write the provider's event id *before* creating
the payment, not after. Providers retry on any non-2xx and duplicates are
normal; a duplicate that races past the receipt writer is the one way this
system loses trust in the books. Return 2xx within the provider's session
timeout and hand off to a background mutation; a scheduled sweep re-drives
anything left unprocessed.

**Settlement is the genuinely hard part.** A UPI payment is instant to the
member and lands in the bank a day later. Money is credited to the fund on
capture, but the **bank leg is a separate, later entry dated at the settlement
date**, not the capture date. That is what keeps `bank_year` and the passbook
correct. Every screen showing a bank balance will be briefly wrong each
morning, and the reconciliation screen must learn to recognise a known
unsettled difference rather than flagging it as unexplained. This is the part
most likely to be under-communicated, and it is provider-neutral.

**Refunds into a closed year.** A refund can arrive weeks after capture, after
the year's books are closed. `assertPeriodOpen` will reject it and must not be
bypassed — the rule is a correction dated in the open period with a note, or it
waits. Decide this deliberately now; do not discover it in March.

**A missing key degrades, never crashes.** If no provider is configured —
which is the permanent state of this build until the decision is made — the
product is offline-collection-only. No page may crash, and `check`, `smoke`,
`visual`, `visual:portal`, and every seed path must keep passing in a sandbox
with no provider account. This is not a fallback; it is the shipping state.

---

## 5. UI/UX decided now, provider-independent

**Console — collection round screen.** The `collectionRounds` unit gets a
"Payments" tab totalling one session: *"Friday 12 Sep: ₹4,200 from 7 — ₹3,800
cash, ₹400 cheque"*, with receipt numbers in the same sequence as everything
else. No signal, no waiting, no gateway. This is the screen that carries M4a.

**Console — exceptions panel.** Small, unglamorous, ships empty. When a provider
lands it is where unmatched payments and missing settlements appear, and where
"gateway last heard from: 3 days ago" belongs — providers disable a webhook
after a long failure and require a human to re-enable it.

**Console — receipt book.** One sequence, every payment, printable via the
existing `@media print` rules. Unchanged in structure; M4a just makes the
offline path fully exercised.

**Portal.** No payment surface ships in M4a, deliberately. Adding a "Pay now"
button that cannot work would be worse than not having it. What M4a does ship
is the receipt and statement experience the payment will hang off, and the
"Pay outstanding" card with an honest empty state.

---

## 6. Tasks

**M4a — now**
1. `convex/lib/payments.ts`: interface, local stub, `provider()` selector. No
   schema change, no product surface.
2. `gatewayIntents`, `gatewayEvents`, `settlements` tables and indexes.
3. Collection round screen: open a session, record cash and cheque against it,
   see the total, receipts in sequence.
4. Exceptions surface, shipped empty.
5. `check-security.mjs` coverage for the new tables and gates;
   `visual-check.mjs` / `visual-portal.mjs` coverage for the round screen.
6. `ARCHITECTURE.md` section on the seam; `INTEGRATIONS.md` §Payments banner
   pointing at this document.

**M4b — on the decision**
7. `publicAction startOnlinePayment`; public `/pay/<orderId>` page.
8. `httpAction` webhook route + `processGatewayEvent`. Signature verify, replay
   discard, `recordPaymentFor`, the `gatewayEvents` claim-then-act ordering.
9. Scheduled sweep for unprocessed events.
10. Refund and failure handling as reversing entries, including the closed-year
    rule from §4.
11. Settlement import; the bank leg dated at settlement, keyed on provider
    payout id.
12. `reconciliation:status` learns the expected-unsettled difference.
13. Per-fund static + dynamic QR; shareable payment links; print.
14. Portal "Pay outstanding" sheet, UPI intent + QR fallback, failed-payment
    row, retry.
15. `/me/standing` mandate enrolment and status.
16. `smoke.mjs` end-to-end: start payment → capture → receipt exists → ledger
    entry exists → contribution flipped → **replay does not double-count**.
17. Live verification against a real account — **blocked on keys and a public
    HTTPS URL.**

---

## 7. Challenges

**A local Convex backend serves no HTTP routes.** Proven in M3: a fixed-string
`/ping` route 404s, as do Convex Auth's own `addHttpRoutes`, because a local
Convex deployment has no public URL. **A webhook cannot be tested locally at
all** — so the M4b verification story must be `simulateSucceeded` driving the
same `processGatewayEvent` path with a synthetic signed event (testing the real
idempotency code, not a mock of it), plus a tunnel against a *cloud* deployment
for the real end-to-end. Until one of those has run against a live provider,
"the webhook works" is unverified. A green local suite must not imply otherwise.

**Deferral has a cost, and it is not zero.** The longer the decision waits, the
more the interim build drifts toward offline-only and the more M4b looks like a
new project. M4a is deliberately small to limit that. The real cost is
momentum, not architecture.

**Over-building the seam.** A `PaymentsProvider` interface written speculatively
can become an abstraction that fits no provider. M4a should ship the interface
and the stub and nothing more — no retry framework, no multi-provider routing,
no feature flags per provider. Those are written when there is a second
implementation to justify them.

**The six webhook rules are provider-neutral but easy to state and hard to
honour.** Writing them into a doc in M3 is not the same as enforcing them. Task
16's replay assertion is the enforcement, and it is the one test in M4b that
must not be skipped.

**A missing key is a permanent state until the decision, not a temporary
condition.** Everything in the repo's verification suite has to keep passing
with no provider configured. That is an ongoing constraint, not a one-time
check.

---

## 8. Open, and not the engineering's to decide

1. **Does the committee want online collection at all?** A real question. The
   alternative is a good offline product, and that is a legitimate outcome of
   this plan rather than a failure of it.
2. **Who holds the merchant account** — organisation name, PAN, settlement
   bank.
3. **What is the payee name** members will see in their UPI app.
4. **Are recurring mandates wanted**, and if so, who authorises them.
