# Architecture

Target architecture for the rebuilt CommunityFund. This document records
**what we decided and why**, so the reasoning survives after the decision.

Related: [Product brief](PRODUCT.md) · [Recovery notes](RECOVERY.md) ·
[Roadmap](ROADMAP.md)

---

## Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Build | Vite | Same as the original build; familiar, fast |
| UI | React + TypeScript | Same as the original; the recovered components port directly |
| Routing | React Router | Same as the original |
| Components | shadcn/ui + Tailwind | Same as the original — the design system is already recovered and should not be redone |
| Charts | Recharts | Same as the original |
| Animation | Framer Motion | Same as the original |
| Backend | **Convex** | Reactive queries remove a whole class of sync bugs; no server to run; free tier; deployed with the app |
| Database | Convex (built-in) | Same reasons |
| Auth | **Convex Auth** | Removes the hand-rolled password table; OTP email auth suits a treasurer who shouldn't manage passwords |
| Validation | Zod | Same as the original; shared validators keep client and server honest |
| Payments | Stripe | See [INTEGRATIONS.md](INTEGRATIONS.md) |
| Messaging | Knock | See [INTEGRATIONS.md](INTEGRATIONS.md) |

### Why Convex, and when not to

**Chosen because** this app is read-heavy, write-light, and highly relational at
the query level: the dashboard, the collection grid, arrears aging, and fund
balances are all derived aggregates that must stay consistent. Reactive queries
give that for free, and there is no infrastructure to operate — appropriate for
a product whose users are volunteer committees, not platform engineers.

**The alternative** is Postgres + Drizzle ORM. Choose it instead if:

- The deployment target requires a plain SQL database, or
- Someone on the team is unwilling to learn a reactive data model, or
- Reporting eventually needs heavy analytical SQL that Convex handles awkwardly

**The v2 schema below is written to be portable** — it is plain relational
modeling with no Convex-specific types, so moving to Drizzle is a mechanical
exercise. Do not adopt Convex-specific query patterns that would make a later
migration expensive.

### Not carried over

| Original | Decision |
| --- | --- |
| Drizzle + SQLite | Replaced by Convex |
| REST under `/api/*` | Replaced by Convex queries/mutations/actions |
| Hand-rolled password auth | Replaced by Convex Auth |
| `numeric` money columns | Replaced by integer paise |
| Stored balance counters | Replaced by derived balances |
| `POST /api/admin/reset` | Deleted |

---

## System shape

```
┌─────────────────────────────────────────────────────┐
│  Client (React SPA)                                 │
│                                                      │
│  Landing → Auth → App shell                         │
│    ├── Committee console   (admin, treasurer, mgr)   │
│    └── Member portal       (member)                  │
└───────────────┬─────────────────────────────────────┘
                │  useQuery / useMutation
                │  (reactive — no manual refetch)
┌───────────────▼─────────────────────────────────────┐
│  Convex                                               │
│                                                      │
│  queries/       read models, derived aggregates      │
│  mutations/     writes + authorization + audit       │
│  actions/       external I/O: payments, email, SMS    │
│  httpActions/   Stripe webhooks, auth callbacks      │
│  schema.ts      tables + indexes                      │
│  auth.ts        Convex Auth config                    │
└──────────────┬─────────────────────────────────────┘
                │
     ┌──────────┴───────────┬──────────────┬─────────────┐
     ▼                      ▼              ▼             ▼
  Stripe              Knock            Auth          Storage
 (UPI, cards)      (email/SMS/WA)     (OTP email)   (receipts,
                                                        statements)
```

**Seamless reactivity** is the point: when a treasurer marks a contribution
paid, the dashboard, the grid, the arrears list, and the defaulter count all
update in the same frame, with no cache invalidation code.

---

## The ledger

This is the most important decision in the document.

### The problem

The original schema stored `funds.current_balance` and `banks.current_balance`
as counters mutated on approval. Two counters, two code paths, no reconciliation.
They drift, and drift is undetectable. A balance was an assertion, not a fact.

### The decision

**Balances are never stored. They are always derived from immutable entries.**

```
ledger_entries: one row per financial fact, append-only
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   fund balance    bank balance    member balance
   (sum by fund)  (sum by bank)   (sum by member)
```

Rules:

1. `ledger_entries` is **append-only**. A correction is a new reversing entry,
   never an update or a delete.
2. A balance is `SUM(amount_paise)` filtered by fund or bank. Computed in a
   query, cached by the reactive layer.
3. `funds.current_balance` and `banks.current_balance` **do not exist** in v2.
4. An entry records *who* did it, *when*, and *where it came from* — a
   transaction, a payment, a correction, an opening balance.
5. Entries carry `locked_to`. A financial-year close sets it, and any write
   into a locked period is rejected.

### Why this is worth the effort

Because it converts the product's central claim from "here is a number someone
computed" to "here is a number you can verify." Reconciliation becomes a
comparison between two independently-derived facts — the ledger and the bank
statement — which is the only comparison that actually means anything.

It also makes several things that are currently impossible become trivial:
arrears aging, a member passbook, "what did this fund spend on maintenance in
2025", and a year-end audit export.

### Money is integer paise

All money is `number` of paise. Never a float, never a decimal string, never
currency units. `₹500.00` is `50000`. Format for display at the UI edge with
`Intl.NumberFormat` in `en-IN`, which handles lakh/crore grouping correctly.

This is non-negotiable. Summing floating-point rupees produces off-by-paise
errors that surface as an unexplained difference between the app and the bank —
the exact failure the product exists to prevent.

---

## The v2 data model

Relational and portable by design. Everything is org-scoped from the start,
even when only one org exists.

```
organizations
  id, name, slug, createdAt, plan, closedThrough (fiscal year close watermark)

users                     (Convex Auth owns identity)
  orgId → organizations
  name, email, phone?, role, isActive, createdAt
  (NO password column — identity lives in the auth system)

members
  orgId → organizations
  userId? → users          (set when a member claims their account)
  name, phone?, email?, relation?, joinedYear, joinedMonth
  isActive, duesDay?, prorationRule, exemptFrom, createdAt

funds
  orgId → organizations
  name, type, description?
  bankId? → banks, managerId? → users
  targetAmountPaise?, isActive, isMemberContribution, monthlyAmountPaise?
  createdAt
  (NO currentBalance)

banks
  orgId → organizations
  name, branch?, accountNumber?, ifscCode?, notes?, createdAt
  (NO currentBalance)

contributions             ← the OBLIGATION ("owes ₹500 for March")
  orgId, memberId → members, fundId → funds?
  year, month, amountPaise
  status: due | paid | partial | waived
  dueDate?, waivedReason?, waivedBy?, createdAt

payments                  ← the PAYMENT (the original design could not express this)
  orgId, memberId? → members, fundId? → funds, bankId? → banks
  amountPaise, method: cash | cheque | upi | card | transfer
  paidAt, collectedBy? → users
  receiptNo, reference? (cheque no / UPI ref)
  gatewayPaymentId?, idempotencyKey
  createdAt

ledger_entries            ← the FACT. The only source of every balance.
  orgId, fundId? → funds, bankId? → banks, memberId? → members
  amountPaise             (signed: + credit, − debit)
  direction: credit | debit
  category, effectiveDate
  source: opening | transaction | payment | correction | transfer
  refType?, refId?        (link back to the originating record)
  note?, actorId? → users
  lockedTo?               (financial-year close watermark)
  createdAt, voidedById?  (a void creates a reversing entry, never a delete)

transactions              ← the REQUEST/APPROVE workflow around a movement
  orgId, fundId, type, amountPaise, description, category
  toFundId?, status: pending | approved | rejected | completed
  requestedBy, approvedBy?, approvalNote?, transactionDate, createdAt

reconciliations
  orgId, bankId, statementDate, statementBalancePaise
  ledgerBalancePaise, differencePaise, note?, resolvedAt?, createdAt

receipts
  orgId, paymentId, receiptNo, issuedTo (email/phone), issuedAt

audit_log
  orgId, userId? → users, action, entityType, entityId?, details?
  ip?, userAgent?, createdAt

invites                   (org-scoped, role-bound, expiring)
  orgId, email, role, token, invitedBy, expiresAt, acceptedAt?
```

### The three-table split that makes the rest work

The original design had one table trying to be two things. Separating them is
what unlocks the hard features:

| Table | Question it answers | Example |
| --- | --- | --- |
| `contributions` | What is owed? | "Rahman owes ₹500 for March 2026" |
| `payments` | What was received, and how? | "₹1,000 cash received 4 Apr, receipt 0041" |
| `ledger_entries` | What is true of the balance? | "+₹1,000 credit, Apr 4, source: payment" |

With this split, a member paying two months at once, paying in advance, or
paying half a month all fall out naturally. None of them are special cases.

### Indexing notes

- `contributions`: `(orgId, year, fundId)` for the grid
- `ledger_entries`: `(orgId, fundId, effectiveDate)` and
  `(orgId, bankId, effectiveDate)` for balances
- `payments`: `(orgId, memberId, paidAt)` for the passbook
- Every table carries `orgId`; **every** query filters on it. Enforce this in a
  shared helper so it cannot be forgotten.

---

## Authorization

Roles are unchanged from the original — four roles, sensibly chosen.

| Capability | admin | treasurer | fund_manager | viewer | member |
| --- | --- | --- | --- | --- | --- |
| View dashboard, funds, reports | ✓ | ✓ | ✓ | ✓ | own only |
| Record contributions / payments | ✓ | ✓ | ✓ | | |
| Mark paid, waive | ✓ | ✓ | own funds | | |
| Create transactions | ✓ | ✓ | own funds | | |
| Approve transactions | ✓ | ✓ | | | |
| Reconcile a bank | ✓ | ✓ | | | |
| Create/edit funds, banks | ✓ | ✓ | | | |
| Manage members | ✓ | ✓ | | | |
| Manage users & invites | ✓ | | | | |
| Settings, fiscal-year close | ✓ | | | | |
| Audit log | ✓ | | | | |

Rules:

1. `fund_manager` is scoped to assigned funds, not the whole org.
2. A user may not approve a transaction they requested — separation of duties
   that the original schema supported but never enforced.
3. **Every** public function starts with an authorization helper that resolves
   the caller to `{ orgId, role, fundIds }`. There is no "check inside the
   handler" pattern; the helper is the gate.
4. `member` is a role on a user, not a separate table. It gates the portal.

---

## Module map

```
src/
├── convex/
│   ├── schema.ts              tables + indexes
│   ├── auth.ts                Convex Auth config
│   ├── lib/
│   │   ├── authz.ts           requireUser / requireAdmin / requireOrg
│   │   ├── money.ts           paise <-> display, parsing
│   │   ├── audit.ts           record(...) on every mutation
│   │   ├── ledger.ts          the only writer of ledger_entries
│   │   └── periods.ts         fiscal year, close, locking
│   ├── queries/               balances, grid, arrears, dashboard, reports
│   ├── mutations/             funds, banks, members, contributions, payments,
│   │                          transactions, approvals, reconciliation, users
│   ├── actions/               receipts, reminders, payment links, exports
│   └── httpActions/           stripe webhook, auth callbacks
├── src/
│   ├── routes/
│   │   ├── public/            landing
│   │   ├── auth/              sign in / sign up
│   │   ├── console/           committee app (the 10 recovered screens)
│   │   └── portal/            member portal
│   ├── components/            shadcn + recovered design system
│   └── lib/
```

**`lib/ledger.ts` is the only module permitted to write a `ledger_entry`.**
Every balance-affecting path goes through it. This is what keeps the invariant
in "The ledger" true by construction rather than by review.

---

## Testing strategy

| Layer | Tool | What it covers |
| --- | --- | --- |
| Money & period logic | Vitest, unit | paise arithmetic, proration, fiscal-year boundaries, arrears aging |
| Ledger invariants | Vitest | every mutation path leaves the sum correct; no update/delete of an entry; locked periods reject writes |
| Authorization | Vitest | each role × each capability; cross-org access always denied; self-approval blocked |
| Query correctness | Vitest | grid pivot, fund and bank balances, monthly flow |
| Components | React Testing Library | grid editing, approval flow, member portal |
| End-to-end | Playwright | signup → create fund → record collection → approve → reconcile → member pays |
| Webhooks | Vitest + fixtures | replay, duplicate, and out-of-order Stripe events |

The end-to-end test is the important one: it is the shortest path that proves a
contribution was collected, recorded, approved, and reconciled correctly.

---

## Deployment

- Vite static build to `dist/`, served by Freebuff hosting
- Convex functions deployed separately
- Environment variables set in Settings → Environment, mirrored to production:
  - `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `VITE_SITE_URL`
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`
  - `KNOCK_API_KEY`, `KNOCK_SIGNING_KEY`

Preview commands are saved in the repository's package configuration, and
`freebuff-deploy check` is run before every deploy.

---

## Related

- [Product brief](PRODUCT.md)
- [Recovery notes](RECOVERY.md)
- [Roadmap](ROADMAP.md)
- [Integrations](INTEGRATIONS.md)
