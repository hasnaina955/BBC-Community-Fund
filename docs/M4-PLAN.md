# M4 — Online collection: the decision, and what replaced it

Status: **decided. There is no online collection.** The committee answered the
four questions in §8 of the previous version of this document on 2026-09-29, and
the answer to the first one settles the rest: this application records money,
it does not take it.

What replaced the gateway is the smallest thing that could work, and it is worth
being precise about what it is: **a printed instruction.** The member's bank
details, and a QR code the member scans in their own UPI app. The money leaves
the member and lands in BBC's bank account. The application never learns that it
happened, and the treasurer records it by hand at the collection desk.

That is not a degraded version of the plan below. It is the plan, answered.

---

## 1. The four answers

| # | The question | The answer |
| --- | --- | --- |
| 1 | Does the committee want online collection at all? | **No.** The application tracks and keeps records. It does not collect. |
| 2 | Who holds the merchant account? | **Moot.** No gateway means no merchant account, no PAN, no settlement bank, and no onboarding process. BBC's existing ordinary bank accounts are the destination. |
| 3 | What is the payee name members see? | **BBC.** Fixed, and a constant in code — see §3. |
| 4 | Are recurring mandates wanted? | **No.** Nothing recurs through this system. A standing instruction is a debit on somebody's bank account, and the committee is not authorising one. |

Question 1 was the one that mattered. Answering it "yes" would have made 2–4
the longest-lead item in the roadmap, because a merchant account is a
governance process with a bank and it takes longer than the engineering does.
Answering it "no" retires all of M4b at a stroke, and the offline half — the
collection desk, the receipt sequence, the passbook — stops being a fallback and
becomes the shipping state.

## 2. What this does to the roadmap

**M4b is cancelled, not deferred.** The nine things listed in the old §3 —
`startOnlinePayment`, the public `/pay/<orderId>` page, the `httpAction` webhook
route, `processGatewayEvent`, refunds, settlement import, dynamic QR, portal
"Pay outstanding", `/me/standing` — are not waiting for a decision any more.
They are not going to happen. The old §7 challenge about local HTTP routes and
the webhook verification story is resolved by the question never arising.

**M4a is now the whole of M4.** The collection desk, the receipt book, the
exceptions surface and the provider seam all still stand, and the seam's own
justification has changed: it was built so that choosing a provider later would
be a dropped-in file. That turned out to be worth having, because the committee
then changed its mind and nothing had to be unwound.

**What was built for the static QR**, which replaces the gateway surface:

| Piece | Where |
| --- | --- |
| UPI address on a bank account | `convex/schema.ts` → `banks.upiId`, validated in `convex/funds.ts` |
| The URI and the rules around it | `src/lib/upi.ts` |
| The QR, drawn in the browser | `src/components/shared/upi-qr.tsx` |
| The account panel, printable | `src/components/shared/bank-details.tsx` |
| Console: the account on the Banks screen | `src/routes/banks.tsx` |
| Portal: "How to pay" | `src/routes/portal/portal-pay.tsx`, at `/me/pay` |
| The member's own accounts | `portal:paymentDetails` |

## 3. Why the payee name is a constant

`PAYEE_NAME = "BBC"` in `src/lib/upi.ts`, not a setting on the organisation.

`pn` is the string a member reads on the pay line in their UPI app, and it is the
only part of this entire system that any member ever sees outside it. Making it
configurable would mean a treasurer could change the name the community's
members are shown on a payment from a settings screen, with no committee
decision behind it and no record that the name had changed — and a member
checking the payee before sending money is the single most important moment in
the whole flow.

It is also paired with an IFSC, which the bank validates against the registered
name. Changing one without the other is a support call. So the name changes the
way it should: a code change, reviewed, with the IFSC changed beside it.

## 4. The rule that the QR has to keep

**A QR code here is a printed instruction, not a transaction.**

The `upi://pay` URI is deliberately **amountless**. It carries `pa`, `pn` and
`cu`, and it carries no `am` and no `tr`. This is the single most important
constraint in the new code, and it is worth stating why in full, because the
instinct to add the amount is strong and the addition would be a serious defect:

A QR with `am=100` on it looks like a checkout. It tells a member that this
application knows what they owe, and — because the amount is baked in — that it
knows what they paid. It knows neither. The amount a member sends is theirs to
decide at the point of payment, and what the app does with the result is nothing
at all.

The failure is silent and it lands on the one thing this product exists to get
right. A member scans, pays ₹300, sees no receipt, and either assumes the app
has it or reports it. If they assume, the treasurer never hears about it, the
contribution is never recorded, and the member's statement is wrong for as long
as nobody notices. The books stop reconciling by a few hundred rupees a month and
nobody can say when it started.

So the absence is asserted rather than documented: `check-security.mjs` fails if
`am=` or `tr=` appears in the URI, and both visual suites fail if it appears in
the `data-upi-uri` the canvas was actually given. A comment saying "don't add
an amount" is worth much less than a test that goes red.

**The same rule forbids four things** on `/me/pay` and on the Banks screen: a
"Pay now" button, an amount field, a success message, and any wording implying
the money arrived. The portal visual suite asserts the absence of the first two.

## 5. What replaces the gap between "sent" and "recorded"

There is a real gap, and it is the honest shape of this product rather than a
defect to be smoothed over. A member pays. Nothing happens in the app. The
treasurer has to be told.

So the flow is explicit, and it reuses machinery that already existed and was
already correct:

```
member scans the QR  ──►  money leaves their UPI app  ──►  lands in BBC's account
                                                                      │
                     nothing in the app knows ◄────────────────────────┘
                                                                      │
member opens /me/requests ◄── "I have already paid" ◄── the treasurer asks
        │
        └─► portal:requestPayment creates a *request* and writes nothing
                │
                └─► treasurer confirms ──► recordPaymentFor ──► receipt + ledger
```

`recordPaymentFor` in `convex/lib/collection.ts` remains the only place money is
written, and it is the same function the collection desk uses for cash handed
over at a meeting. There is no second path into the books, which is the one rule
M4a set and the one this decision makes easy to keep.

The member's claim is not a formality either. A UPI transfer carries a UTR
reference in the payer's own statement, and the reference field on the claim
form is where it goes — which is what lets a treasurer match a claim against the
bank statement rather than taking somebody's word for it. That is also why the
portal shows the account **and** the QR: the QR is what most members will use,
and the written UPI address is what a treasurer needs when a member says "I sent
it yesterday, what was the address?"

## 6. Drawn locally, never by a service

QR images are rendered by `qrcode` into a `<canvas>` in the page. No request
carrying the account leaves the browser, and the VPA and IFSC are never sent
anywhere.

This is not a preference. A VPA and an IFSC are the address money arrives at.
Calling a third-party QR endpoint to have it render a picture would hand that
address to somebody else's server in exchange for a square of black dots — and
it would be the only place in the entire system where the organisation's
financial identity left the building.

The console suite asserts this on a real page load: every request is recorded,
the listener is required to have seen at least one (so the check cannot pass by
watching nothing), and any request whose URL contains the VPA, the account number
or the IFSC fails the run. The assertion is deliberately about the *account
details* rather than about off-site traffic in general — the app loads webfonts
from a CDN, which is unrelated and perfectly fine, and a blanket ban would have
been a check that fails for the wrong reason.

A local search of the integration catalogue returned no QR service, which is the
right outcome here. There was nothing to choose.

## 7. What is deliberately not here

- **No amount on the QR.** §4.
- **No per-member QR, and no dynamic QR.** Without a gateway there is nothing to
  sign a per-member code, and a per-member code that carries an amount has the
  same problem as a static one that does.
- **No payment status, ever.** "Sent" is not a state this application can hold.
- **No matching of bank statements to claims.** The reference exists and the
  treasurer can compare by eye. Automating it is M7's business, and it needs a
  bank feed this product does not have.
- **No recurring anything.** Answer 4.
- **The `PaymentsProvider` seam stays, unwired.** `hasProvider()` is still
  `false` and the exceptions surface still ships empty. It is no longer waiting
  for a decision, so it is not a promise — but neither is it harmful, and
  deleting tested code the moment a committee changes its mind is not a habit
  worth forming. What it is now is a worked example of the rule that made this
  change cheap.

## 8. Research kept, for whoever asks next

The survey below was done properly and the findings were right. They are kept
because a future committee — or a different organisation using this codebase —
will ask the same question, and re-running a payment-provider comparison is an
afternoon of work that does not need repeating.

**Stripe is invite-only in India.** Stripe's own India FAQ: *"businesses from
India must request an invite and aren't able to sign-up for a new Stripe account
through our website."* An India-native UPI payment method is only reachable on
an invited account. This is what put the repo's original Stripe pre-commitment
under review.

**Razorpay and Cashfree are the India-native pair.** Between them the decision
turned on AMC, documentation quality, and whether recurring mandates were wanted
at all:

| | Razorpay | Cashfree | Stripe |
| --- | --- | --- | --- |
| UPI, cards, netbanking | Yes | Yes | Yes, India-configured accounts |
| Static + dynamic UPI QR with amount & name | Yes (QR Codes API) | Yes | No first-class UPI QR |
| UPI AutoPay and eNACH in one integration | Yes | Yes | Mandates only, no eNACH |
| Zero MDR on bank-to-bank UPI | Yes | ~1.9%+ | ~2% TDR |
| AMC | Zero | ₹4,999/yr | n/a |
| India self-serve for an Indian community org | Yes | Yes | **No — invite-only** |

**Razorpay is not in the integration catalogue.** Two searches, the second
explicitly for Razorpay/Cashfree/eNACH, both returned "none of the provided
candidates are payment gateways". Keys would come from the provider's own
dashboard regardless.

Had the committee said yes, the answer would have been Razorpay: zero MDR and
zero AMC against ~1.9% plus ₹4,999/yr is a real difference at this volume. The
research was not wasted — it is what made saying no an informed choice rather
than a shrug.

## 9. The webhook rules, still provider-neutral

Retained, because they are good rules and this codebase is the kind that gets
copied. They apply to anything that will ever tell this system that money moved
— a bank feed, a reconciliation import, a future provider:

1. **Verify the signature** before reading the body. Unverified input is never
   processed.
2. **Idempotency.** Store the event id. A replay is acknowledged and discarded.
3. **Out-of-order tolerance.** A late event must not create a second payment.
4. **Never trust the amount in the event alone** — resolve the intended
   contribution server-side and reject a mismatch.
5. **Only a verified source may mark a contribution paid.** A client never
   asserts that a payment succeeded.
6. **Failed and refunded** payments are recorded, with the contribution
   reverting.

The signature detail that is got wrong most often: HMAC is taken over the **raw
bytes**, so a webhook handler must verify against the unparsed body. Parsing to
an object and re-serialising changes the bytes, which fails verification for a
delivery that was entirely genuine — and presents as a forged request, which
sends the investigation in exactly the wrong direction.
