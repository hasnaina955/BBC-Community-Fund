# Integrations

Third-party services for collection (M4) and chasing (M5). Both are deliberately
deferred until the ledger in M2 is correct — a payment that lands against a
drifting balance is worse than no online payment at all.

Related: [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md)

---

## Payments — provider not yet chosen

**Milestone:** M4 · **Purpose:** accept UPI and card payments for contributions

> **The provider decision is deferred.** The text below is the original
> pre-commitment to Stripe and is **not** an adopted choice. Research found
> Stripe is invite-only in India, so its UPI support is only reachable on an
> account this organisation cannot self-serve; that is why it went under review.
> See [M4-PLAN.md](./M4-PLAN.md) for the survey, the decision record, and the
> provider-independent work that ships while the choice is open. Nothing below
> is implemented, and no keys should be provisioned against it yet.

Originally chosen because it covers hosted checkout, recurring billing, and
signed webhooks without building a gateway, and supports UPI when the account is
configured for India.

> **On India-specific depth:** Stripe supports UPI through India account
> configuration, but it is a global gateway with an India region. If UPI
> first-and-last — QR-native collection, no-code mandates, settlement to Indian
> accounts — turns out to be the dominant requirement, evaluate an
> India-native gateway before committing. The integration is written behind a
> thin `lib/payments.ts` interface precisely so the provider can be swapped
> without touching the ledger.

### Provider-independent

True of every candidate, and settled regardless of which is chosen: no provider
is ever a second writer of money. `recordPaymentFor` in
`convex/lib/collection.ts` remains the only place a payment becomes a receipt
and a ledger entry, and a client's browser never asserts that a payment
succeeded.

### What gets built

| Piece | Detail |
| --- | --- |
| Checkout | Per-member payment link for outstanding contributions |
| QR | Per-fund static QR for treasurer-generated payments |
| Recurring | Optional standing instruction for monthly contributions |
| Webhook | `httpAction` in Convex, signature verified |
| Refunds | Recorded as reversing ledger entries, never a balance edit |

### Webhook rules

Non-negotiable, because a duplicate webhook that double-counts a payment will
destroy trust in the books:

1. **Verify the signature** before reading the body. Unverified webhooks are
   never processed.
2. **Idempotency.** Store the event id. A replay is acknowledged and discarded.
3. **Out-of-order tolerance.** A `payment_intent.succeeded` arriving after
   `invoice.paid` must not create a second payment.
4. **Never trust the amount in the event alone** — resolve the intended
   contribution server-side and reject a mismatch.
5. **A webhook is the only thing that marks a contribution paid.** The client
   never asserts a payment succeeded.
6. **Failed and refunded** payments are recorded, with the contribution
   reverting to unpaid or partial.

### Environment

| Variable | Where |
| --- | --- |
| `STRIPE_SECRET_KEY` | Convex environment, server only |
| `STRIPE_WEBHOOK_SECRET` | Convex environment |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Client, safe to expose |

Set these in Settings → Environment, and mirror them to production with
`freebuff-deploy env set`.

---

## Messaging — Knock

**Milestone:** M5 (seam built, vendor not connected) · **Purpose:** receipts,
reminders, and arrears notices over email, SMS, and WhatsApp

Chosen because it is one API across several channels, with workflow
orchestration, delivery tracking, and per-recipient preferences. Receipts and
reminders are exactly the shape this solves — templated messages triggered by
app events, going to a defined audience, where a member must be able to opt out
of reminders.

For a community product, the WhatsApp channel is what actually gets read. SMS is
the fallback for members without it; email is where receipts and statements
belong.

### Status — the seam is built, nothing is connected

`convex/lib/notify.ts` declares the `NotifyProvider` interface, the three
templates and the email/SMS renderers, and its only implementation is an
offline stub. `hasProvider()` returns `false`, and the UI copy branches on it:
`/reminders` states that no provider is connected and renders no control that
would claim to have sent something.

That is the shipping state of this build, not a degraded mode. The decision
layer — who is chased, on which channel, who is skipped and why — is complete
and fully verified; the transport is the only thing missing, and adding it
means writing one implementation of the interface.

### What gets built

| Message | Trigger | Channel |
| --- | --- | --- |
| Payment receipt | Payment recorded | Email, WhatsApp |
| Due-soon reminder | Scheduled, before the due date | WhatsApp, SMS |
| Overdue reminder | Scheduled, after the due date | WhatsApp, SMS |
| Arrears summary | Scheduled, monthly | Email |
| Payment link | Member requests it | WhatsApp, SMS |

### Rules

- **Consent and opt-out.** A member can stop reminders. Opt-out is captured at
  signup and honored on every send. **Built and asserted:** `setPreference`
  requires a member, targets only the signed-in account's own row, and a
  treasurer cannot grant consent on somebody's behalf — a treasurer *can* record
  a refusal made in person, because a member who asks to be left alone does not
  always have an account.
- **Financial statements by email; nudges by WhatsApp.** Do not put a full
  statement in an SMS.
- **Every send is logged** with its status, so a treasurer can answer "did they
  get the reminder?" — and bounce handling stops retries to dead numbers. The
  campaign and per-recipient rows exist; the status updates arrive with the
  vendor.
- **Send is not the same as delivered.** The UI shows delivery status separately
  from the send.
- **A run is a record.** `reminderCampaigns` keeps who was considered, who was
  queued, and who was skipped with the reason. Nothing is a bare loop.

### Environment

Not yet required — `hasProvider()` is a constant until an implementation is
added. When it is:

| Variable | Where |
| --- | --- |
| `KNOCK_API_KEY` | Convex environment, server only |
| `KNOCK_SIGNING_KEY` | Client, for in-app notification preferences |

---

## Identity — Convex Auth

**Milestone:** M1 (done) · **Purpose:** replaces the hand-rolled password table

### How it is configured

| Piece | Choice | Why |
| --- | --- | --- |
| Provider | `Password` | Works with no outbound email; OTP/email verification needs a provider we do not have yet |
| Hashing | PBKDF2-SHA256, 210k iterations, per-hash salt | Explicit format, implemented in `convex/lib/password.ts`, and reusable by the seeder |
| Verification | Constant-time compare | A wrong hash must not be discoverable byte by byte |
| Email verification | Off | Needs an email provider; M1 has none |
| `applicationID` | `"convex"` | It is the `aud` claim in every JWT. Any other value makes every authenticated query fail with `NoAuthProvider` |
| `CONVEX_AUTH_DOMAIN` | Must equal the JWT issuer | Locally that is the Convex **site** port `3211`, not the app port `5173` — the most common setup mistake here |

The legacy build stored a `password` column with a hand-rolled `hash`+`salt` in
the same table the app read from, with no sessions, lockout, or reset. All of
that is gone; see [RECOVERY.md](RECOVERY.md) → flaw 6.

Sign-in failures return one generic message, so the form cannot be used to
discover which email addresses have accounts.

### Environment

| Variable | Where |
| --- | --- |
| `VITE_CONVEX_URL` | `.env.local` — deployment the browser calls |
| `CONVEX_AUTH_DOMAIN` | Convex deployment — must match the JWT `iss` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Convex deployment — signing keypair |
| `CONVEX_SITE_URL` | Convex deployment |

Generate the keypair and issuer settings with:

```bash
bunx @convex-dev/auth --web-server-url <origin>
```

### Later milestones

- **Email OTP instead of passwords** — add an email provider to the
  `Password` config's `verify` and enable verification. A volunteer treasurer
  should not have a password to manage.
- **Password reset** — same provider, plus a Knock email.
- **A second approver factor** if the committee requires it.

---

## Verifying the backend

The local Convex backend and the seeded data can be checked from the terminal
without a browser:

```bash
bun run convex:push            # push functions and codegen
bun run convex:seed            # one-shot demo data (refuses to run twice)

# sign in and use the token against the read models
TOKEN=$(bunx convex run auth:signIn \
  '{"provider":"password","params":{"flow":"signIn","email":"secretary@jamaat.org","password":"community123"}}' \
  | grep -oE '"token": "[^"]+"' | sed 's/"token": "//; s/"$//')

curl -s -X POST http://127.0.0.1:3210/api/query \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"data:me","args":{},"format":"json"}'
```

`data:me` returning the signed-in user proves auth, the token audience, and the
org binding all line up — those are three separate things that fail
independently.

## Deferring an integration

A good reason to add a service later rather than now:

- The ledger cannot yet represent the event it would record
- The message would be sent from a domain with no sending reputation
- The compliance surface is unclear

Every integration above is a `lib/` module behind an interface, called from a
Convex action. Adding, replacing, or removing one does not touch the ledger.
