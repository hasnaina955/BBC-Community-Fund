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
| **M2** | Trustworthy money | M1 | Not started | Balances reconcile with the bank |
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
  server-side is M2 work, once the query patterns are known.

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

### Scope

- [ ] `ledger_entries` as the single source of truth; append-only
- [ ] `lib/ledger.ts` as the **only** writer of entries
- [ ] Remove `funds.current_balance` and `banks.current_balance`
- [ ] Convert all money to integer paise
- [ ] Backfill a ledger from existing balances as opening entries
- [ ] Derived balance queries: fund, bank, member
- [ ] **Reconciliation screen** — ledger balance beside statement balance, per
      bank, with the difference called out
- [ ] Record statement balance and date; store reconciliation history
- [ ] Inter-fund transfers write a balanced pair of entries, never a
      self-referencing row
- [ ] Correct posting: a reversing entry, never an update or delete
- [ ] **Fiscal year close**; entries in a locked period are rejected
- [ ] Contribution proration from join year/month
- [ ] Arrears aging buckets (current, 30/60/90+)
- [ ] Invariant tests: no mutation path breaks the sum; locked periods reject
      writes

### Exit criteria

- Fund and bank balances equal the sum of their ledger entries, by construction
- A statement balance that disagrees is visibly flagged, with the reason
- A closed year cannot be modified, and attempts are rejected server-side
- No floating-point money anywhere
- Reconciling a real bank statement produces a zero difference

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
| **Pilot with one real community** | M0–M2 complete, plus M8 items: backups, error monitoring, rate limiting |
| **Public beta** | M0–M4 complete, M6 in progress |
| **General availability** | M0–M7 complete |
| **Monetization** | GA, plus tested billing, and M8 complete |

**Do not let a community's real money touch the platform before M2 is done and
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
