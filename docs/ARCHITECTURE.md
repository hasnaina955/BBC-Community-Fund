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

**Balances are never authored by hand. They are always derived from immutable
entries, and the derivation is materialised rather than computed on read.**

```
ledger_entries: one row per financial fact, append-only
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   fund balance    bank balance    member balance
   (sum by fund)  (sum by bank)   (sum by member)
                        │
                        ▼  same transaction, every write
              balances: one row per scope
```

Rules:

1. `ledger_entries` is **append-only**. A correction is a new reversing entry,
   never an update or a delete.
2. A balance is `SUM(amount_paise)` filtered by fund or bank. The sum is
   **materialised** into the `balances` table, and the materialised value is
   the answer — but it is never an independent assertion.
3. `funds.current_balance` and `banks.current_balance` **do not exist** in v2.
4. An entry records *who* did it, *when*, and *where it came from* — a
   transaction, a payment, a correction, an opening balance.
5. Entries carry `locked_to`. A financial-year close sets it, and any write
   into a locked period is rejected.

### Why the sum is materialised

The invariant is unchanged — a balance must equal the sum of its entries — but
the sum cannot be computed on every read.

Convex caps a single query at 16384 documents. This community was founded in
2018 and kept its books in a spreadsheet until now, so the ledger is already
around ten thousand entries. A single-pass SUM over it is at the limit today
and breaks as more years arrive. The naive fix — a `current_balance` column,
mutated on approval — is the exact design this milestone exists to replace: two
code paths, no reconciliation, drift that is undetectable.

So the `balances` table sits between the two failures, and it is not the legacy
design because of what surrounds it:

- **Same transaction.** Every write that posts a ledger entry also adjusts the
  materialised balance. There is no window in which they disagree.
- **Rebuildable.** `balances:recompute` derives every value from the entries at
  any time. The counter is a cache of a fact, not the fact.
- **Verifiable.** `balances:verify` reports any drift without changing
  anything, and runs as part of `bun run check`. The invariant is *checked*, not
  *asserted*.

The property the original schema lacked is not "no stored counter" — it is
"no way to tell whether the counter is right".

### Per-year movement totals, and why they are not per-year balances

A bank passbook for a past year needs two things: that year's rows, and the
balance the account stood at on 1 January. The rows are a bounded index range,
but the opening balance is a *suffix sum* — today's balance minus everything
earned since. Reading that suffix is every entry from then to now: 6.6 seconds
for 2018 at this community's history, and a screen that lies about its own dates
along the way.

The suffix is avoided with a fourth scope, `bank_year:<bankId>:<year>`, holding
the account's net movement *in* that year. Closing for year Y is today's balance
minus the movement of all later years — a handful of rows — and the opening
falls out of that minus the year's own movement.

It is a **movement total, not a balance**, and that is the whole trick. A
per-year *balance* would have to be adjusted for every year at or after the year
an entry is dated in, so a backdated correction would fan out across the whole
history and the write path would stop being O(1). A movement total only ever
moves the year the entry belongs to. It obeys the same rule as every other
scope — derived, rebuildable, verified — and `bun run balances:backfill` creates
it through `balances:recompute` rather than by insertion.

### Reading a year, not the history

Most screens want one year, not everything. `effectiveDate` is an ISO string and
`by_date` is `(orgId, effectiveDate)`, so a year is a contiguous key range:

```ts
q.eq("orgId", orgId).gte("effectiveDate", "2024-01-01")
                .lte("effectiveDate", "2024-12-31")
```

This is the difference between reading ~1.2k rows and reading all ~10k. The
same trick with `(orgId, fundId, effectiveDate)` is what keeps the fund detail
screen at 100 ms rather than the 6.7 s it took when it scanned every entry the
fund had ever had.

Arrears is the other one. It is read through `contributions.by_open`, a partial
index on `(orgId, status, year)`; matching only `orgId` and `status = due`
selects every outstanding due in any year, so the result is proportional to the
number of defaulters rather than to eight years of history.

---

## Aggregation lives on the server

M1 fetched every ledger entry, contribution and payment and aggregated it in the
browser with `src/lib/selectors.ts`. That is a design that works right up until
the moment it does not.

At eight years of history it is not slow — it is **broken**. Two of M1's read
models return `Array length is too long (10066 > maximum length 8192)`. The
app would not load.

Every figure on the dashboard and every report is now computed in
`convex/aggregate.ts` and sent as numbers. Each screen subscribes to one read
model, fetched only when that screen is open. Measured with
`bun run measure`:

| | Bytes for the whole app, at 8 years |
| --- | --- |
| Client-side aggregation (M1) | 1,492,414 — and two queries fail outright |
| Server-side read models (M2b) | 180,296 |

The aggregate side is flat against history length. The largest read model is the
collection grid, which is one year of member-months (84 × 12) — bounded by the
grid itself, not by the ledger.

### Errors: `useQuery` throws, `useQueries` returns

Convex's `useQuery` rethrows a server error; `useQueries` hands it back as a
value. Which one you use is a correctness decision, not a style one.

The two always-on shell queries in `DataProvider` run above any React error
boundary and wrap the whole app, so they use `useQueries` and `AuthGate` paints
the failure. Getting this backwards means a signed-out visitor — whose
`data:me` correctly fails with "Not signed in" — gets a blank page instead of
the sign-in form.

Screen queries use `useQuery` and are wrapped by `ErrorBoundary` in the app
shell, which catches the rethrow and renders it in place of the screen with a
retry. A fund id that no longer resolves should cost you that one page, not the
sidebar.

---

## Reconciliation and the close watermark

A ledger balance is a *claim* about a bank account. Only the bank can confirm it,
so the treasurer reads the figure off a statement and files it here.

The one thing that makes this correct rather than decorative: **the comparison is
made on the statement's date.** Filing a January statement and comparing it to
today's balance reports a difference every time, because six months of giving have
happened since. So the server derives what the ledger claimed *as at that day* and
stores both figures with their difference.

`bankBalanceAsOf` in `convex/lib/balances.ts` does that derivation by walking
backwards from today's balance: whole years come out of the materialised
`bank_year` movement totals (O(years) rows), and the remainder of the statement's
own year is one bounded index range. A statement from 2018 therefore costs what a
statement from last week costs.

**Closing a financial year** sets `organizations.closedThrough` *and* stamps
`lockedTo` on every entry dated in the year, in pages. The stamping is the part
that is easy to miss: a reversal is dated *today*, so the date-based watermark
alone would let a backdated entry from a closed year be quietly backed out months
later. With the stamp, "the books are closed" and "March cannot be changed" are
the same statement. `closeYear` also refuses while any account has an unexplained
difference — a year closed over an unreconciled bank balance looks settled, and is
worse than one left open.

**Arrears ageing** is by *days past due*, not by how many months a member owes
(`convex/lib/arrears.ts`). Month-counting put ₹100 from 2019 and ₹1,000 from last
month in one bucket, which is not a distinction anyone can act on. The due date is
`contributions.dueDate` when set, and the 10th of the charged month otherwise —
matching the convention `members:generateMonth` already uses.

**The opening balance** is what an imported ledger starts from: the community kept
its books in a spreadsheet, so on the day the ledger begins each account already
held money, and starting from zero would be *wrong* rather than merely incomplete.
It is posted through `postEntry` with `source: "opening"`, so it moves the same
materialised balances as any other entry and `balances:verify` covers it. There is
deliberately no "set the balance" path, and the mutation refuses a fund or account
that already has entries — re-posting would double the money.

---

## Collection modes

The community runs three genuinely different kinds of fund, and the original
schema modelled them all as "members owe this monthly":

- **Monthly dues** — ₹100 per member per month, every month, since 2018.
- **Friday fund** — voluntary giving after Friday prayers, any amount, and
  members frequently give anonymously.
- **Mosque reconstruction** — a promise made now and paid over time.
- **Zakat, charity, emergency** — given and spent, with no obligation attached.

`funds.collectionMode` names which of these a fund is, and it is the field the
entire arrears concept hangs off:

| Mode | Primary view | Arrears | Waive |
| --- | --- | --- | --- |
| `fixed_monthly` | member × month grid | yes | yes |
| `voluntary` | rounds + receipt book | **never** | no |
| `pledge_based` | promised vs received vs spent | promises only | no |
| `donation` | ledger + totals | no | no |

`convex/lib/funds.ts` is the single enforcement point. `assertHasDues()` is
called from `createContribution`, `generateMonth` and `setContributionStatus`,
so an unscheduled fund cannot acquire a grid, an arrear or a waiver even by
accident, and `bun run check` asserts the rule against a fund of every mode.

This is not a cosmetic fix. Without it, the arrears list shows nearly all 84
cousins as defaulters every month — for the Friday fund, which nobody owes
anything to. The numbers would be consistent with the code and completely wrong
about the community, which is worse than no number at all.

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

- `contributions`: `(orgId, year, fundId)` for the grid, and
  `(orgId, status, year)` — `by_open` — for arrears, so an arrears read is
  proportional to the number of defaulters rather than to history
- `ledger_entries`: `(orgId, effectiveDate)` for a year, and
  `(orgId, fundId, effectiveDate)` for one fund's year. `by_date` and
  `by_fund_date` are what keep a year-bounded read from becoming a full scan.
- `payments`: `(orgId, memberId)` for the passbook
- Every table carries `orgId`; **every** query filters on it. Enforce this in a
  shared helper so it cannot be forgotten.

### Two limits worth knowing

Convex has two read limits, and they bite in different places:

- **16384 documents per query.** This is what a `.collect()` of the whole ledger
  hits, and what killed M1's row lists.
- **4096 documents read inside a mutation.** A mutation is a write transaction,
  and the whole thing rolls back if it exceeds the budget. This is why the demo
  reset clears one table per call and why `seed:seedHistory` takes a single year
  — a reset that swept sixteen tables, or a seeder that back-filled eight years
  in one call, would delete nothing and throw.

`lib/balances.ts` exposes `collectAll` for the cases that genuinely must walk
the ledger from a mutation, paging on `_creationTime` because a Convex query
builder cannot be re-paginated once iteration has begun.

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
│   │   ├── balances.ts        materialised balances, verify/recompute
│   │   ├── arrears.ts         due dates, days past due, ageing buckets
│   │   └── funds.ts           the collectionMode rules
│   ├── reconciliation.ts       statements, differences, fiscal-year close
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
