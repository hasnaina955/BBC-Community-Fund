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
| Charts | Recharts | Same as the original; lazy-loaded, see "What the phone does not download" |
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
| Framer Motion | Removed — see below |
| `numeric` money columns | Replaced by integer paise |
| Stored balance counters | Replaced by derived balances |
| `POST /api/admin/reset` | Deleted |

---

### Framer Motion, removed

The stack table used to list Framer Motion as the animation library, and
`package.json` still carried it. It was **never imported anywhere in the app** —
the whole motion budget was Tailwind `transition-*` classes and `tailwindcss-animate`'s
`animate-in`/`animate-out`, which is what the sheet and the dialogs actually use.

A dependency nobody imports is not a neutral thing to leave in place: it is
installed on every contributor's machine, it is in the lockfile, and it is
documented as a load-bearing part of the stack, so the next person reaching for
motion assumes they must use it and never checks. It was removed rather than
kept, because nothing needs it.

The one thing that had to be added in its place is `prefers-reduced-motion`. The
Tailwind transitions are all decorative — no motion in this app carries meaning —
so the whole set collapses to nothing under that preference rather than being
selectively reduced.

### Three.js, considered and declined

Asked for by name during the UI work, and deliberately **not** adopted. The
reasoning is recorded because "we tried it and it was too heavy" is a decision
someone will otherwise re-litigate.

The app shipped as a single 933 kB chunk (267 kB gzipped) and Vite was already
warning about it. Three.js is roughly 600 kB minified before `OrbitControls` and
a loader, so adopting it would have roughly doubled the bundle again. The
deciding consideration is not the size on a laptop, though — it is who this app
is for:

- **A member opens the portal on a low-end Android phone**, possibly on mobile
  data, to read one number: what they owe. That is the M3 design, and it is the
  right one.
- The payload work in M2 exists precisely because the original app shipped
  1.47 MB of read models. A product that measured that and cut it 86% does not
  then add a WebGL renderer to read a balance.

**What was done instead** is the opposite of adding weight: `React.lazy` on the
route screens, which cut the bytes every visitor loads from 267 kB to 111 kB
gzipped and left the charting library in a chunk only four console screens ever
request. A member's first load is now 111 kB gzip and contains no chart code at
all.

Three.js would earn its place in a **public marketing page** — where a first
visit is a stranger, there is no one waiting on a number, and a hero animation
is the entire point of the screen. There is no such page today; `/` is the
console, behind the session. If one is ever added, three.js is a reasonable
choice *there* and must stay out of the two applications that are signed in.

## What the phone does not download

`src/App.tsx` lazy-loads every route. The two shells and `/auth` stay eager,
because they are the first thing every visitor needs and a lazy shell would mean
a spinner where the app should already be. Everything else is an async chunk.

This is not only a bundle-size decision. `recharts` is a quarter of the old
bundle and is used by four console screens; a member reading their balance was
downloading all of it. The split as built:

| Chunk | Size | Who loads it |
| --- | --- | --- |
| `index` (shells, auth, router) | 111 kB gzip | Everyone, immediately |
| `BarChart` (recharts) | 103 kB gzip | The four screens that draw a chart |
| Each screen | 2–3 kB gzip | The one screen you are on |

The `Suspense` fallback is `ReadModelLoader` rather than a bare spinner, and that
is load-bearing beyond appearance: both visual harnesses wait for a screen by
polling `main.querySelector(".animate-spin") === null`, so a fallback without
that class would make every assertion in the suite race the chunk download.

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

## The member portal, and the role that made the console honest

Everything above assumes the signed-in people and the committee are the same set.
M3 broke that assumption by adding the `member` role — the first role that is
signed in but is *not* on the committee — and in doing so exposed an assumption
that had never been written down.

### The hole the role opened

Every read model in `data.ts`, `aggregate.ts` and `reconciliation.ts` was written
against `requireMember`, which until M3 meant only "is signed in". That was not a
slip; it was correct while every account belonged to somebody on the committee. But
it meant the gate was doing no work. The moment a member account existed, those
same read models would have returned the organisation's total balances, every
member's arrears, the audit log and the bank passbooks — to a person holding a
phone at a collection table.

The fix is not a permission list. It is two different gates with two different
names, so the choice is visible at the import line rather than inferred from a
handler body:

| Helper | Means | Used by |
| --- | --- | --- |
| `requireActor` | valid session, attached to an org, active | internally |
| `requireMember` | any signed-in actor, member or not | `data:me`, the portal reads |
| `requireConsole` | `atLeast(viewer)` — on the committee | every console read model |
| `requireTreasurer` | `atLeast(treasurer)` | writes, and the portal's back office |
| `requireAdmin` | `atLeast(admin)` | users, settings, the close |

`aggregate.ts`, `reconciliation.ts` and `data.ts` import `requireConsole` *under
the name `requireMember`*, so the 30-odd call sites did not have to be rewritten
and — more to the point — a query added to those files later gets the strong gate
by default. The safe default is the only name the file can call.

`data:me` is the deliberate exception: identity and role are not console data, and
a member has to be able to learn that they are one. The app-wide `DataProvider`
subscribes to it and nothing else. The org-wide shell summary moved into
`AppShell`, which only a committee member mounts, because while it lived in the
provider every signed-in visitor downloaded it before any screen was chosen.

`bun run check` asserts the refusal across the whole console read-model surface
rather than one screen, because the failure mode is a *new* screen quietly reusing
the weaker helper.

### Why the portal never takes a member id

A portal query that accepted `{ memberId }` would be a query that shows any
member's dues to anyone who edits a URL. There is no code path in `convex/portal.ts`
that takes a member id from a caller. `requireMyMember` resolves the member row
from the session through the `members.userId` join, and every read starts there.

A receipt that is not the caller's returns `null`, exactly as one that does not
exist does. Distinguishing them would turn the receipt URL into an oracle for
valid payment ids — "does a payment exist, for whom, and when".

### Two ways to link, and why one of them asks a person

Members are a community, not a customer base. A phone number is often shared
across a household, and the secretary is the person who knows who is who.

- **Self-claim**, on a verified email that exactly matches `members.email`.
  Convex Auth owns email verification, so proving you own the address is Convex's
  job. An ambiguous match is *refused*, not guessed: two rows sharing an address
  need a person to say which is which, because silently picking one could show a
  member their cousin's dues.
- **Treasurer assignment**, for members with no email account or a shared one.
  Asking the secretary to prove a cousin's identity by email is theatre.

The treasurer's screen therefore counts the members who *have not* claimed, not
the ones who have. A member without an account cannot see their own balance, will
not know they owe anything, and will not chase anyone — so the committee is blind
to them in a way it does not realise.

### One writer for money, and a claim that writes nothing

`recordPaymentFor` in `convex/lib/collection.ts` is the single implementation of
"money arrives". A treasurer typing a payment at the desk and a treasurer
confirming a member's claim both call it, so they produce identical rows,
identical receipt numbering and identical settlement of arrears. If they were
separate paths they would drift, and the drift would surface as a balance that
does not reconcile.

`portal:requestPayment` therefore writes **no money**. It creates a request a
treasurer confirms, and only then does the confirmation reach the ledger — through
the same checks the desk would have applied, so a claim cannot create a payment
the collection path would have refused. One open request per member, because two
pending claims for the same person is nearly always the same money entered twice.

### Documents are queries, not URLs

The first implementation of a receipt was an `httpAction` on `/receipt/:id`. It
cannot work against a local deployment: **the local Convex backend serves no HTTP
routes at all** — a fixed-string `/ping` route 404s, as do Convex Auth's own
registered routes, and Convex documents local deployments as having no public URL.
`convex/receipts.ts` documents this, because the shape looks correct and the
reason it is wrong is not discoverable from the code.

Going through a normal query is also the better experience on a phone:
`window.print()` opens the platform sheet, which is where *Save as PDF* and
*Share* live. The receipt and the passbook are therefore the page on screen, with
`@media print` rules taking away the interface (`cf-chrome`, `print:hidden`) and
nothing else — one renderer, so the paper and the screen cannot disagree.

### The document is complete, the screen is capped

`portal:summary` returns at most 50 receipts and computes its totals over
everything — the right trade for a phone screen. `portal:statement` exists because
that is the wrong trade for a document, which would have printed fifty payments
above the words "received ₹96,400 over 212 payments". It reads one member's own
rows in full, and its closing balance is the arithmetic of the two lists printed
above it, so a member who adds it up gets the same number. Measured at **54.7 kB**
for a member's entire eight-year history.

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
  name, branch?, accountNumber?, ifscCode?, upiId?, notes?, createdAt
  (NO currentBalance)
  upiId: the address members pay to, and the only thing the static QR is
         built from. Per-account, not per-org — a UPI address belongs to the
         bank that issued it. The payee name is NOT here; it is a constant in
         src/lib/upi.ts, because a treasurer should not be able to change the
         name a member reads on a payment from a settings screen.

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
- `reminderCampaigns`: `(orgId, createdAt)` for the "who have we chased" list, and
  `(orgId, kind, period)` — `by_period` — which is also the idempotency key a
  retried cron run collides on
- `reminders`: `(orgId, memberId)` for one member's history, `(orgId, campaignId)`
  for the run's contents
- `notificationPreferences`: one row per `(orgId, memberId)`, holding the
  channels refused and the reason. Absence of a row means "no preference
  recorded", which is *not* the same as consent — see the reminders section
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
| See the defaulter list, plan a run | ✓ | ✓ | | ✓ | |
| **Record their own reminder preference** | | | | | ✓ (own row only) |
| Record a refusal on someone's behalf | ✓ | ✓ | | | |

The last two rows are the interesting ones and they are deliberately
asymmetric. A treasurer cannot agree to reminders **for** a member — consent
somebody else did not give is not consent — but a treasurer can record a refusal
made in person, because a member who asks to be left alone does not always have
an account with us. Turning something off needs the person; turning it on does
not. See the reminders section below.

Rules:

1. `fund_manager` is scoped to assigned funds, not the whole org.
2. A user may not approve a transaction they requested — separation of duties
   that the original schema supported but never enforced.
3. **Every** public function starts with an authorization helper that resolves
   the caller to `{ orgId, role, fundIds }`. There is no "check inside the
   handler" pattern; the helper is the gate.
4. `member` is a role on a user, not a separate table. It gates the portal, and
   it is the reason the console has its own gate — see *The member portal* above.
5. **A member-scoped function takes no member id.** It resolves the row from the
   session token, so there is no argument to pass wrongly. This is the rule that
   makes the two rows above expressible, and it is why
   `reminders:myPreferences` and `reminders:setPreference` exist as a pair
   rather than the generic one.

---

## Module map

The layout below is what the repository actually contains. (An earlier version
of this section described a planned `queries/`, `mutations/`, `actions/` and
`httpActions/` tree and named Stripe; the app is flatter than that, and the
committee has since declined a gateway entirely.)

```
convex/
├── schema.ts              tables + indexes
├── auth.ts  auth.config.ts
├── aggregate.ts           every dashboard and report figure, server-side
├── data.ts                the M1 row reads, kept so they can be measured
├── funds.ts  members.ts  transactions.ts  banks.ts  approvals.ts
├── collections.ts         the collection desk: sessions, and the round payment
├── portal.ts              the member's own record
├── receipts.ts            printable documents, as queries
├── reconciliation.ts      statements, differences, fiscal-year close
├── gateway.ts             online-payment exceptions — empty by design
├── seed.ts                demo seeder, guarded reset, history back-fill
└── lib/
    ├── authz.ts           requireActor / requireConsole / requireTreasurer
    ├── money.ts           paise <-> display, parsing
    ├── audit.ts           record(...) on every mutation
    ├── ledger.ts          the only writer of ledger_entries
    ├── balances.ts        materialised balances, verify/recompute
    ├── collection.ts      the only writer of payments
    ├── sequence.ts        receipt numbers
    ├── payments.ts        the gateway provider seam — unwired, by decision
    ├── notify.ts          the notification provider seam, and the templates
    ├── reminders.ts       who to chase, on which channel, and who not
    ├── arrears.ts         due dates, days past due, ageing buckets
    └── funds.ts           the collectionMode rules
src/
├── routes/                the console screens, the member portal, /auth
├── components/            shadcn + recovered design system
│   └── shared/            bank-details, upi-qr, stat-card, read-model, …
└── lib/                   types, money, formatting, the Convex client, csv,
                           upi (the static UPI intent and the payee name)
```

**`lib/ledger.ts` is the only module permitted to write a `ledger_entry`**, and
`lib/collection.ts` the only one permitted to write a `payment`. Every
balance-affecting path goes through them. This is what keeps the invariant in "The
ledger" true by construction rather than by review.

---

## The collection desk, and the static UPI QR that replaced a gateway

The collection desk is the screen a treasurer actually uses at a meeting: open a
session for today's date and fund, then enter cash and cheque receipts one after
another against a running total, with no signal and no per-entry confirmation
dialog. `/collection`.

**This product records money; it does not take it.** The committee decided that
on 2026-09-29 (see [M4-PLAN.md](M4-PLAN.md) §1). A member pays from their own
UPI app into BBC's bank account, using a QR code this application draws in the
browser, and then tells the treasurer. Nothing in the system learns that a
payment happened, and the desk is where it gets written down.

### The QR, and what it must never become

`src/lib/upi.ts` builds `upi://pay?pa=<vpa>&pn=BBC&cu=INR`. `pa` is the
organisation's UPI address, stored on the bank account; `pn` is the name a
member reads on the pay line, fixed at **BBC**.

The payload is deliberately **amountless** — no `am`, no `tr` — and that is a
correctness requirement, not an unfinished feature. A QR with an amount on it
reads as a checkout. It tells a member that the application knows what they owe
and, because the amount is fixed in the code, that it knows what they paid. It
knows neither.

The failure is silent and it lands on the only thing this product exists to get
right. A member scans, pays, sees no receipt, and either reports it or assumes.
If they assume, nobody tells the treasurer, the contribution is never recorded,
and the books drift by a few hundred rupees a month with no way to date the
drift. So the absence is asserted rather than documented: `bun run check` fails
if `am=` or `tr=` appears in the built URI, and both visual suites fail if it
appears in the `data-upi-uri` the canvas was actually handed. The same suites
assert the absence of a "Pay now" button on `/me/pay`.

The counter-argument deserves stating, because it sounds reasonable. Encoding
the member's outstanding total would save them arithmetic, and the QR is
per-account so it *could* be per-member. But the app cannot know what a member
is about to send — they may be paying one month, twelve, or a round, and an
amount is a claim about intent that the app has no way to be right about. So it
states the account and lets the member decide, which is also the only version
that is true.

### Drawn locally, because the VPA is the account

`qrcode` renders into a `<canvas>` in the page. No request leaves the browser.

A UPI address and an IFSC are the address money arrives at. Rendering them
through a third-party QR endpoint would hand that address to somebody else's
server in exchange for a square of black dots, and it would be the only place in
the system where the organisation's financial identity left the building. The
console suite records every request during a real page load, requires the
listener to have seen at least one — so the check cannot pass by watching
nothing — and fails if any request URL contains the VPA, the account number or
the IFSC. It asserts on the *account details*, not on off-site traffic in
general: the app loads webfonts from a CDN, and a blanket ban would be a check
that fails for the wrong reason.

`/me/pay` is its own page rather than a card on the balance screen because it
gets printed: on a fridge, or on a noticeboard. A print of the balance screen
would be wrong for both. The account number is grouped in fours for the same
reason it is grouped on the console — a 16-digit number read aloud to a bank
branch is transcribed wrongly by someone and correctly by nobody.

### The seam, unwired

`convex/lib/payments.ts` declares a `PaymentsProvider` — create an intent,
confirm a payment, look one up by provider id — and selects an implementation.
The only implementation is local, and it refuses. `hasProvider()` returns `false`.

`convex/schema.ts` carries `gatewayIntents`, `gatewayEvents` and `settlements`,
and `convex/gateway.ts` is the exceptions surface a gateway would be read from,
shipped empty on purpose.

None of this is waiting for a decision any more, and the honest reading is that
the seam earned its keep by **not** being used: the committee changed its mind
and nothing had to be unwound. Keeping it is cheap. Deleting tested code the
moment a committee changes its mind is a habit not worth forming.

What the desk gave us, which a gateway would have needed anyway:

**Receipt numbers needed to be a real sequence.** They were `count + 1`, which is
not a sequence. Two payments written in the same instant — exactly what a
collection desk does, and exactly what a webhook burst does — computed the same
number. And the count itself was a full-table scan of the `payments` table, at
~9,955 rows, past the server's per-query limits. `lib/sequence.ts` holds the
counter in an org-scoped `counters` document, incremented inside the same
transaction that writes the payment, so a receipt number is unique by
construction.

**The exception the count scan would have become is a real one.** The 16,384-row
and 8,192-return limits are now worked around in `balances.ts`, `aggregate.ts`,
`lib/sequence.ts` and the schema itself, each with a comment naming which limit
and why. That is not an accident of the data volume; it is the shape a naive read
takes against an append-only ledger, and every read model here is shaped to
avoid it. `rounds` is a worked example: it makes **one** index scan for the
payments of all forty sessions in view, not one scan per session, because a
collection desk is opened in a hurry.

**Idempotency was already testable without a gateway.** `recordPaymentFor` keys
on `idempotencyKey` through the `by_idempotency` index and returns the payment it
already wrote. The replay guarantee is asserted in `bun run check`.

**And the member's claim writes nothing**, which is what makes the whole
arrangement safe. A member who paid tells the treasurer through
`portal:requestPayment`, which creates a *request* and stops. The treasurer
confirms, and only then does `recordPaymentFor` — the same function the desk uses
for cash handed over at a meeting — write the payment, the receipt and the ledger
entry. One writer, two front doors, no shortcut.

---

## Reminders: a run is a record, not a loop

`/reminders` is the treasury's arrears screen: who owes what, how long it has
been outstanding, and whether we have already chased them. It is built the same
way the collection desk was — as if the vendor already existed.

**The transport is a seam.** `convex/lib/notify.ts` declares a
`NotifyProvider` (queue, status lookup, and a per-recipient event) alongside the
three templates — due-soon, overdue, arrears summary — and the renderers for
email body and SMS body. `provider()` returns the offline stub, and
`hasProvider()` is what the screen asks before it offers a button. The visible
consequence is deliberate: **with no provider configured the screen states that
nothing is being sent**, and it does not render a control that would claim
otherwise. Knock is the recommendation and it changes this one file.

**The decision layer is the part that must not belong to a vendor.** Which of
the three conversations a member's position calls for, which channel that
conversation suits, whether the member has refused that channel, and how to
render a phone number — all of that is `convex/lib/reminders.ts` and none of it
is Knock's. The ageing buckets come from `lib/arrears` unchanged, so the
defaulter list and the reports page cannot disagree about how old a debt is.

**Pressing the button writes a row.** `reminders:runCampaign` records a
`reminderCampaigns` document holding the members it considered, the ones it
queued, and the ones it skipped **with the reason** — `opted_out`,
`no_destination`, `already_reminded`. That is the whole point of the table. A
send loop has no memory; "you reminded 61 people" is an answerable question only
if the decision was written down, and a treasurer who is wrong about it needs the
list to argue with. The monthly cron (`reminders:runScheduled`, an
`internalMutation` so nothing in the app can reach it) and the button call the
same builder, so the two cannot diverge.

Scheduled runs are idempotent per `(org, kind, period)`. Manual runs are
deliberately **not**: crons retry, a human pressing twice has asked twice, and
silently ignoring the second press is its own bug.

**Consent is the one thing a console user cannot grant for someone else.**
`setPreference` requires a member, and the target is always the row belonging to
the signed-in account — there is no member-id argument to get wrong, and
`check-security.mjs` asserts that a treasurer cannot do it on somebody's behalf.
The asymmetry with M2's approval flow is intentional and worth stating: a
treasurer **can** record a refusal made in person, because a member who asks to
be left alone does not always have an account with us. Turning something off
needs the person; turning it on does not.

### The export is a format problem, and it fails on someone else's machine

The defaulter list exports to CSV from the browser, from the read model already
in memory — no second query, no new server surface, and the file cannot
disagree with the screen because it *is* the screen's data. It follows the
active search and the active sort, because the two moments a treasurer exports
are "everyone, in ring order" and "the nine people matching this", and a button
that ignored the search box would produce the wrong file in the second case.

`src/lib/csv.ts` is hand-written for three reasons, each of which fails
*quietly* — the file opens and says the wrong thing:

1. **A name is not a column.** `Ali, Mohammad` is two columns and
   `Sheikh "Bhai" Saheb` is unparseable, so fields are quoted per RFC 4180 with
   internal quotes doubled.
2. **A name can be a formula.** This is the one with teeth. A member called
   `=HYPERLINK("http://phish.example","Verify your account")` is legal data, and
   in Excel it is not text — it is a live link, on a page that has nothing to do
   with this application. Text fields beginning `=`, `+`, `-`, `@` or a tab are
   prefixed with an apostrophe. Numbers are exempt *by type*, so a new column
   cannot forget the guard.
3. **Excel guesses the encoding.** A UTF-8 file with no BOM is read as the local
   codepage, so the BOM is written by `toCsv` — not by the downloader. The
   failure it prevents is a second call site that builds a file by another route
   and forgets it, so the correct-by-default place is the writer.

Amounts go out as plain decimal rupees, not `₹1,23,456`. A formatted string is
text to a spreadsheet and cannot be summed, and summing the column is the only
reason anyone opens the file. The export also carries **no contact details**:
the screen says *by SMS* and not *98765 43210*, and putting a phone number in a
file on disk is a different privacy posture from the one the screen sets.

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
