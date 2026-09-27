# Roadmap

Nine milestones, M0 through M8. Milestones M0–M2 are the critical path: until
they are done, nothing else should be built, because everything after them is
built on the data model and the trust foundation they establish.

Related: [Product brief](PRODUCT.md) · [Architecture](ARCHITECTURE.md) ·
[Recovery notes](RECOVERY.md)

---

## Summary

| ID | Milestone | Depends on | Status | Gate |
| --- | --- | --- | --- | --- |
| **M0** | Reclaim the codebase | — | **Done** | App runs with real source |
| **M1** | Backend and authentication | M0 | **Done** | Every screen loads real data |
| **M2a** | The ledger is the truth | M1 | **Done** | Balances derive from entries |
| **M2b** | Server-side aggregation | M2a | **Done** | Eight years of history load |
| **M2c** | Collection modes | M2a | **Done** | Only monthly dues can be arrears |
| **V1** | Browser verification | M2c | **Done** | Every screen renders, and the numbers on it are the server's |
| **M2d** | Reconciliation and close | M2a | **Done** | Balances reconcile with the bank |
| **M3** | Member portal | M2 | Not started | A member is self-sufficient |
| **M4** | Online collection | M2, M3 | Not started | A member can pay from a link |
| **M5** | Reminders and arrears | M4 | Not started | Unpaid contributions get chased |
| **M6** | Multi-tenancy | M2 | Not started | Two orgs, no data crossover |
| **M7** | Reports and compliance | M2 | Not started | The committee gets its answer |
| **M8** | Hardening and operations | M3–M7 | Not started | It can be relied on |

> **Critical path: M0 → M1 → M2.** M6 is the highest-risk late dependency —
> it can be pulled forward to run in parallel with M3, because retrofitting
> `orgId` across every table after the fact is genuinely painful. The v2 schema
> is org-scoped from the start precisely so this decision can be made late.

## What changed in the M2 plan

M2 was originally one large milestone. It is now four, because the first three
turned out to be preconditions for importing the community's real history
rather than work that could follow it.

**M2a and M2b were pulled ahead of the import, and M2c came with them.** The
community was founded in 2018 and kept its books in a spreadsheet, so the real
ledger is around ten thousand entries across eight years. M1 shipped every row
to the browser and aggregated it with `lib/selectors.ts`, which was fine for
nine months of demo data and does not survive contact with the real thing: at
this history length two of its read models stop returning at all. That is a
data-volume failure, not a performance one, and no amount of careful
client-side code would have fixed it.

M2d — reconciliation, fiscal-year close, and statement import — is the part that
genuinely needs real data, and it is what remains.

---

## M0 — Reclaim the codebase

**Goal:** a real, buildable project in place of a minified bundle.

**Why first:** the repo has no source and no `package.json`. Nothing runs.
Every other milestone depends on this.

### Scope

- [x] Decide recover-vs-rebuild and record the decision
      *(rebuilt from the extracted design rather than decompiling 1MB of
      minified JS — the design system and domain logic were recoverable, the
      minified control flow was not worth fighting)*
- [x] Scaffold Vite + React + TypeScript + Tailwind + shadcn/ui
- [x] Port the recovered design tokens from the legacy stylesheet (light + dark)
- [x] Reimplement the router with all 10 recovered routes
- [x] Port the screens: dashboard, funds, fund detail, members, contributions
      grid, transactions, approvals, banks, reports, settings, users
- [x] Port domain logic: grid pivot, approval state machine, dashboard
      aggregations — as derived selectors, not stored counters
- [x] Seed data with realistic demo data (6 funds, 3 banks, 120 members, 9
      months of contributions, transactions, audit log)
- [x] Convex v2 schema pushed and indexed
- [x] Confirm `bun tsc -b --noEmit` and `freebuff-preview start` are clean

### Exit criteria — all met

- [x] `bun run dev` serves the app; every route compiles and renders with seed
      data
- [x] Typecheck passes with no errors, across app **and** `convex/`
- [x] `vite build` completes: 2488 modules, stylesheet compiled with the
      recovered tokens
- [x] Visual design matches the original — tokens, fonts, radius, sidebar
      palette taken verbatim from the legacy CSS
- [x] Legacy build preserved in `legacy/` and untouched

### Notes and deviations

- The legacy build was moved to `legacy/` (via `git mv`, history preserved) to
  free the root `index.html` for Vite.
- The data layer is a local in-memory store (`src/data/store.tsx`). It exists
  so the screens could be built and verified before a backend. It is not
  persisted, and the screens say so — a demo that quietly writes to
  localStorage makes it look like a backend exists.
- `.env.example` was dropped from scope: no environment variable is read at
  M0. Auth and provider keys arrive with M1 and M4.

### Deferred to M1

- Convex query and mutation functions
- `ConvexProvider` wiring — the app does not import Convex until there are
  functions to call
- `.env.example` and documented setup for `CONVEX_DEPLOYMENT` / `VITE_CONVEX_URL`

### Risk

Cleared. The rebuild was smaller than feared because the stylesheet and
domain model were intact in the bundle.

---

## M1 — Backend and authentication

**Goal:** real persistence and real identity behind every screen.

### Scope

- [x] Convex project; schema from [ARCHITECTURE.md](ARCHITECTURE.md#the-v2-data-model)
- [x] Convex Auth; hand-rolled `password` column dropped
- [x] Session handling and a route guard preserving the intended destination
- [x] Mutations for funds, banks, members, users with server-side authorization
- [x] Read models replacing the 23 recovered endpoints, keeping response shapes
      so the ported UI kept working untouched
- [x] Collection grid query; contribution status and bulk-month mutations
- [x] Transaction request/approve/reject with separation of duties
- [x] Ledger writer as the only path that moves a balance
- [x] Payment recording, receipt numbering, and oldest-first settlement
- [x] **Audit every mutation** — and make the log queryable, which the legacy
      build never was
- [x] `authz` helper enforcing org and role on every function
- [x] **No `admin/reset` equivalent** — balances are derived and cannot be zeroed
- [x] Demo seeder with 1 org, 5 staff, 3 banks, 6 funds, 120 members, 938
      ledger entries
- [ ] Unit tests for authorization and query correctness — **deferred**

### Exit criteria — all met

- [x] Every screen loads real data from Convex, reactively
- [x] A signed-out user is redirected to `/auth?returnTo=…` and returned there
- [x] A `viewer` cannot write (verified: `treasurer access required`)
- [x] A requester cannot approve their own transaction (verified)
- [x] An unauthenticated query and a forged token are both refused (verified)
- [x] Every mutation produces an audit row
- [x] Login and logout work against the Convex backend (verified)
- [x] Balances are derived from the ledger; an overdraw is refused

### Notes and deviations

- **PBKDF2 instead of the provider default.** Passwords are hashed with
  PBKDF2-SHA256 (210k iterations, per-hash salt) in `convex/lib/password.ts`,
  so the format is explicit and the seeder can generate compatible hashes.
  The legacy build stored a `password` column with a hand-rolled `hash`+`salt`.
- **Email verification is off.** It needs an outbound email provider, and M1
  has none. The auth provider rate-limits sign-in itself. Sign-in failures are
  deliberately vague so they cannot be used to enumerate accounts.
- **The auth library's internal store cannot be called from another module**,
  so the seeder writes the `users` and `authAccounts` rows directly, producing
  the same shape `createAccount` does.
- **`seed:seedDemo` is a public mutation.** It refuses to run once an
  organisation exists, so it cannot duplicate or corrupt data, but it must be
  deleted or moved behind an internal function before GA. Tracked in M8.
- **Aggregation is still client-side.** Screens use the same pure selectors as
  M0 over the fetched rows. Moving the dashboard and reporting aggregates
  server-side is M2 work, once the query patterns are known. *(Superseded:
  done in M2b, and it turned out to be a correctness issue rather than a
  performance one — see M2b.)*

### Operational note

The Convex backend only listens while a Convex process runs, and
`convex dev --once` exits when the push completes. `scripts/dev.mjs` runs the
backend and Vite together so the app has something to talk to; the preview
runner starts it. For a browser outside the sandbox, `VITE_CONVEX_URL` must
point at a hosted Convex deployment — `127.0.0.1:3210` is only reachable from
the machine running it. See `.env.example`.

---

## M2 — Trustworthy money

**Goal:** balances that can be proven. The most important milestone in the plan.

**Why before features:** a member portal and a payment button on top of a
double-counted balance automate the confusion instead of fixing it.

### M2a — The ledger is the truth *(done)*

- [x] `ledgerEntries` as the single source of truth; append-only
- [x] `lib/ledger.ts` as the **only** writer of entries; no `update`, no `delete`
- [x] Remove `funds.current_balance` and `banks.current_balance`
- [x] Convert all money to integer paise
- [x] Derived balance queries: fund, bank, member
- [x] Inter-fund transfers write a balanced pair of entries
- [x] Correct posting: a reversing entry
- [x] Contribution proration from join year/month
- [x] Fiscal-year close watermark on `organizations.closedThrough`

**Why materialised balances.** A balance must always equal the sum of its
entries, and that stays true — but "the sum" cannot be computed on read at this
scale. Convex caps a query at 16384 documents and the ledger is already around
ten thousand, so a single-pass SUM would not merely be slow, it would stop
working. The `balances` table is a materialised counter, and it is not the
legacy `current_balance` design:

- it is written in the same transaction as the ledger entry, so it cannot
  drift from them;
- it is rebuildable from the entries at any time by `balances:recompute`;
- `balances:verify` proves the invariant on demand and is wired into
  `bun run check`.

`bun run check` reports `ok: true` across 93 scopes and 10,066 entries.

### M2b — Server-side aggregation *(done)*

- [x] Every dashboard and report figure computed in Convex, not the browser
- [x] `src/lib/selectors.ts` deleted — no client-side arithmetic over rows
- [x] One read model per screen, fetched only when that screen is open
- [x] Balances from the `balances` table, so O(funds) not O(entries)
- [x] Arrears read the `by_open` partial index, so O(defaulters) not O(history)
- [x] Year-bounded index range reads instead of filtering history in JS
- [x] `scripts/measure-payload.mjs` as a regression guard on payload size
- [x] `scripts/smoke-queries.mjs` as a regression guard on every read model

Measured at eight years of history, ~10,000 ledger entries:

| | Bytes for the whole app |
| --- | --- |
| M1 (client aggregation) | 1,492,414 — and two of the ten queries **fail outright** |
| M2b (server aggregation) | 180,296 |

The M1 failure is the point. `data:listLedgerEntries` and `data:listPayments`
return `Array length is too long (10066 > maximum length 8192)`. At this
history length the M1 app would not load, rather than loading slowly.

The aggregate side does not grow with history: the largest read model is the
collection grid, which is one year of member-months (84 × 12), not the ledger.

### M2c — Collection modes *(done)*

The community runs three genuinely different kinds of fund, and M1 modelled
them all as "members owe this monthly". That produced arrears lists that were
technically consistent with the code and completely wrong about the community:
the Friday fund would have shown nearly all 84 cousins as defaulters every
month, for a fund nobody owes anything to.

- [x] `collectionMode` on `funds`: `fixed_monthly`, `voluntary`, `pledge_based`,
      `donation`
- [x] `lib/funds.ts` as the single enforcement point — `assertHasDues()` is
      called from every path that could create a due
- [x] Arrears, waivers and the collection grid exist only for `fixed_monthly`
- [x] `collectionRounds` for voluntary funds; `pledges` for pledge-based funds
- [x] UI reflects the mode: the grid refuses other modes and says why, the
      reports page reports voluntary giving as collected rather than as debt,
      and the fund detail page compares promised against received for a
      pledge-based fund
- [x] `bun run check` asserts the rule against a fund of every mode

### M2d — Reconciliation and close *(done)*

- [x] **Reconciliation screen** — ledger balance beside statement balance, per
      bank, with the difference called out
- [x] Record statement balance and date; store reconciliation history
- [x] Entries in a locked period are rejected by the ledger writer
- [x] Arrears aging buckets (current, 30/60/90+)
- [x] Backfill a ledger from the spreadsheet's opening balances
- [x] Invariant tests: no mutation path breaks the sum; locked periods reject
      writes

**What it turned out to need.** Three things, none of which were obvious from the
checklist.

**A reconciliation is a comparison on a date, not a comparison with today.** The
obvious implementation files a statement and compares it to the current balance,
which produces a difference every single time and is meaningless. The server
derives what the ledger claimed *on the statement's date* and stores that
alongside the bank's figure. It walks backwards from today's balance using the
materialised per-year movement totals, so a statement from 2018 costs the same as
one from last week — see `bankBalanceAsOf` in `convex/lib/balances.ts`.

**Closing a year has to lock the entries, not just set a watermark.** The
watermark already existed and `assertPeriodOpen` already enforced it, but a
*reversal* is dated today, so a backdated entry from a closed year could still be
backed out of the books six months later. `closeYear` now stamps `lockedTo` on
every entry in the year, in pages, which is what makes "closed" mean closed.
Closing also refuses while any account has an unexplained difference — a year
closed over an unreconciled bank balance looks settled and is not.

**The ageing buckets were answering the wrong question.** "1 month / 2 months /
3+ months" counts how many months a member happens to owe, so it put ₹100 from
2019 and ₹1,000 from last month in the same row. They are now days past due
(current / 30 / 60 / 90+), which is the standard receivables presentation and the
one a treasurer can act on. See `convex/lib/arrears.ts`.

Two smaller things fell out of the same work: the opening balance is posted
through `postEntry` like any other entry, so the balance invariant covers it and
there is no way for it to disagree with the sum of the ledger; and the upper
bound on every year-range ledger read was `lte("YYYY-12-31")`, which silently
dropped 31 December because entries carry a time component that sorts after it.

**Exit criteria, added for this milestone**

- [x] A filed statement's difference is the server's figure, never the client's
- [x] A statement that agrees with the books is reachable without inventing a
      difference
- [x] A closed year refuses a write dated inside it, and the refusal names the
      year
- [x] Ageing buckets sum to the arrears headline
- [x] Closing is refused while a difference is unexplained, and allowed once it
      is closed off

### Exit criteria — all met

- [x] Fund and bank balances equal the sum of their ledger entries, and the
      equality is checkable on demand rather than merely asserted
- [x] No floating-point money anywhere
- [x] Eight years of history load in every screen, with the aggregate payload
      flat against history length
- [x] No fund outside `fixed_monthly` can acquire a due, an arrear, or a waiver

---

## M3 — Member portal

**Goal:** a member can see what they owe, without asking a person.

**Why it matters:** this is what removes the treasurer from data entry, which is
what makes these products fail to get adopted.

### Scope

- [ ] Add `email` to members; a `member` role
- [ ] Optional member accounts, linked by phone or email
- [ ] "What I owe" — current month, arrears, total outstanding
- [ ] Contribution history and a printable passbook statement
- [ ] Receipts list with download
- [ ] Mark-as-paid request (for cash collected offline), requiring treasurer
      confirmation
- [ ] Mobile-first layout; installable PWA
- [ ] WhatsApp-friendly share link

### Exit criteria

- A member signs in with a link and sees a correct, itemised balance
- A member downloads a receipt
- A treasurer can see which members have claimed accounts

---

## M4 — Online collection

**Goal:** money moves through the product, not just through a notebook.

### Scope

- [ ] Stripe integration: UPI and cards
- [ ] Payment link or per-member checkout for a contribution
- [ ] Per-fund QR code for treasurer-generated payments
- [ ] Webhook endpoint, signature verification, **idempotent processing**
- [ ] Webhook creates a `payment` and the matching ledger entry
- [ ] Out-of-order and duplicate events handled; retry-safe
- [ ] Failed and refunded payments recorded
- [ ] Offline collection fully first class: cash and cheque with receipt number,
      collector, and reference
- [ ] **Every payment issues a receipt**

### Exit criteria

- A member pays from a link; the contribution flips to paid and a ledger entry
  appears
- Replaying the same webhook does not double-count
- A cash collection at a meeting with no signal is recorded and reconciled later

---

## M5 — Reminders and arrears

**Goal:** the money actually gets collected.

### Scope

- [ ] Knock integration for email, SMS, and WhatsApp
- [ ] Reminder templates: due-soon, overdue, arrears summary
- [ ] Scheduled monthly run for the whole org
- [ ] One-tap "remind all unpaid" from the grid
- [ ] Defaulter list with aging, sortable and exportable
- [ ] Opt-out preferences and consent capture
- [ ] Delivery status and bounce handling
- [ ] Per-member reminder history

### Exit criteria

- An unpaid contribution produces a reminder on schedule
- The treasurer sees who has been reminded and when
- A member can stop being reminded

---

## M6 — Multi-tenancy

**Goal:** more than one community, with provable isolation.

**Why it gates being a product:** one database is one community. Until this
lands, CommunityFund is an internal tool for a single organization.

### Scope

- [ ] `organizations` table; every table org-scoped and indexed on `orgId`
- [ ] Signup creates an org and the first admin
- [ ] Onboarding wizard: org details, banks, funds, members, import
- [ ] Member and payment CSV import — the real adoption path
- [ ] Org switcher for users in multiple orgs
- [ ] Per-org settings and numbering sequences
- [ ] Enforce org isolation in the shared `authz` helper, not per-handler
- [ ] Data export and account deletion for a departing org
- [ ] Cross-org access test suite

### Exit criteria

- Two orgs exist with data that never crosses
- Every query is provably org-scoped (tested, not assumed)
- A new community can sign up and be running in under an hour with a CSV import

---

## M7 — Reports and compliance

**Goal:** answer the committee's question.

### Scope

- [ ] Real `/reports` implementation (the original had a route and no data)
- [ ] Income and expenditure by fund, category, and month
- [ ] Collection efficiency: collected vs. expected, per month
- [ ] Outstanding arrears with aging
- [ ] Fund progress against target
- [ ] CSV and PDF export
- [ ] Annual member statement
- [ ] Audit log UI — the endpoint that never existed
- [ ] Year-end close report
- [ ] Contribution certificates
- [ ] Zakat and charity fund reporting, kept distinct per the fund type

### Exit criteria

- A treasurer can produce the annual report the committee asks for, unaided
- Every figure in a report traces to ledger entries
- The audit log is queryable by actor, entity, and date

---

## M8 — Hardening and operations

**Goal:** reliable enough for a community to depend on.

### Scope

- [ ] Backup schedule and a **tested** restore
- [ ] Error monitoring with alerting
- [ ] Rate limiting on auth and public endpoints
- [ ] Security review: authorization audit, secrets, PII handling
- [ ] Data retention policy and PII minimisation
- [ ] Rate-limited, paged dashboards
- [ ] Grid performance at 500+ members × 12 months
- [ ] Empty states, error states, and loading skeletons throughout
- [ ] Accessibility pass — keyboard and screen reader
- [ ] Documentation for maintainers and a setup guide for committees
- [ ] Dependency updates and a CI pipeline

### Exit criteria

- A backup has been restored successfully into a clean environment
- An alert fires on a deliberately raised error
- The grid stays responsive at realistic scale
- A new maintainer can set up the project from the docs alone

---

## Sequencing

```
M0 ──► M1 ──► M2 ──┬──► M3 ──┐
                   │         ├──► M4 ──► M5 ──┐
                   └──► M6 ───┘                │
                          └────────────────────┤
                                               ├──► M8
                              M7 ───────────────┘
```

**M6 can run in parallel with M3/M4** — the schema is already org-scoped, so
the work is mostly the signup flow, the org switcher, and the isolation test
suite. It should be pulled forward if commercial pressure demands multi-org
sooner than the member portal.

**M7 only needs M2.** Reporting can proceed whenever the ledger is solid; it
does not wait for payments or reminders.

---

## Release gates

| Gate | Requirement |
| --- | --- |
| **Internal use** | M0 + M1 complete |
| **Pilot with one real community** | M0–M2d complete, plus M8 items: backups, error monitoring, rate limiting |
| **Public beta** | M0–M4 complete, M6 in progress |
| **General availability** | M0–M7 complete |
| **Monetization** | GA, plus tested billing, and M8 complete |

**Do not let a community's real money touch the platform before M2d is done and
M8's backup and monitoring items are in place.** This is the one hard rule in
the plan.

---

## Working agreement

- Update the status table above as milestones complete.
- Add a dated entry to the milestone when its exit criteria are met.
- A milestone is not done because the features exist — it is done when its
  **exit criteria** pass.
- If scope must be cut to hit a date, cut breadth, not the exit criteria.

## Related

- [Product brief](PRODUCT.md) — definition of done
- [Architecture](ARCHITECTURE.md) — the design these milestones implement
- [Recovery notes](RECOVERY.md) — the flaws M1 and M2 exist to fix
- [Integrations](INTEGRATIONS.md) — M4 and M5 services
