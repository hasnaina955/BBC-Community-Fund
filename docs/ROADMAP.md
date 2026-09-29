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
| **M3** | Member portal | M2 | **Done** | A member is self-sufficient |
| **M4** | Collection | M2, M3 | **Done, by decision** — the committee declined online collection; the desk, the receipts and a static UPI QR are the shipping state | A member can find the account and the QR, and knows to tell the treasurer |
| **M5** | Reminders and arrears | M4a | Built, unsent — the decision layer, the record and the consent rules are done; dispatch waits on a vendor | Unpaid contributions get chased |
| **M6** | Multi-tenancy | M2 | In progress | Signup and isolation proven; import and org switcher still open |
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

- [x] Add `email` to members; a `member` role
- [x] Optional member accounts, linked by phone or email
- [x] "What I owe" — current month, arrears, total outstanding
- [x] Contribution history and a printable passbook statement
- [x] Receipts list with download
- [x] Mark-as-paid request (for cash collected offline), requiring treasurer
      confirmation
- [x] Mobile-first layout; installable PWA
- [x] WhatsApp-friendly share link

### Exit criteria

- A member signs in with a link and sees a correct, itemised balance
- A member downloads a receipt
- A treasurer can see which members have claimed accounts

All three are verified in a real browser — `bun run visual:portal`, 71 checks —
and the refusals behind them are asserted at the API level by `bun run check`.

### What was built, and the two decisions worth recording

**The `member` role forced the console to be gated properly.** Every read model in
`data.ts`, `aggregate.ts` and `reconciliation.ts` was written against
`requireMember`, which until now meant only "is signed in". That was safe while
every signed-in person was on the committee. The moment member accounts existed,
those same read models would have handed a member the organisation's total
balances, every member's arrears and the audit log. `requireConsole`
(`convex/lib/authz.ts`) now gates them separately, and the three files import it
under the old name so a query added there later cannot quietly pick up the weaker
gate. The shell's org summary moved out of the app-wide `DataProvider` for the
same reason: it was being downloaded by every signed-in visitor, including
members who had no business seeing it.

**Receipts are printed from a query, not served from a URL.** The first version
was an `httpAction` on `/receipt/:id`, which is the obvious shape for "give me a
document at a URL". It cannot work here: **the local Convex backend serves no
HTTP routes at all** — a trivial `path: "/ping"` returning a fixed string 404s,
as do Convex Auth's own registered routes, and Convex documents local deployments
as having no public URL. A receipt that only works against a cloud deployment is
a receipt that only works in production. Going through a normal query is also
better for the person holding the phone: `window.print()` opens the platform
sheet, which is where *Save as PDF* and *Share to WhatsApp* live, and a receipt
that a member forwards to their spouse is the most likely thing to happen to it.

**Claiming is deliberately two ways.** Self-claim matches a verified email against
the address on file, and refuses an ambiguous match rather than guessing — a
household address shared by two brothers must not show one his cousin's dues. That
leaves members with no email, or sharing one, needing a person; so the treasurer
gets a linking tool, and the screen deliberately counts the members who *cannot*
see their own balance, because those are the ones the committee is blind to.

**The passbook is a document, not a screen.** `portal:statement` exists because
`summary` caps its receipt list at fifty to keep a phone fast while computing its
totals over everything — the right trade for a screen and the wrong one for a
document, which would have printed fifty payments above the words "received ₹96,400
over 212 payments". The statement reads one member's own rows in full, and its
closing balance is computed from the two lists above it, so a member who adds it
up gets the same number. 54.7 kB for a member's entire eight-year history.

**Verification note.** `bun run check` exercises the mark-as-paid loop by
*refusing* a claim, not confirming one. Confirming writes a real payment,
receipt number and ledger entry, and nothing in this product can undo a payment —
a suite that permanently altered the books on each run would stop being a suite.
The confirmation path's money-writing half is `recordPaymentFor`, the same
function the desk uses, which `check` already drives directly.

---

## M4 — Online collection: decided, and closed

**Goal, restated by the committee:** money does *not* move through the product.
It keeps records. The member pays from their own UPI app into BBC's bank
account; the treasurer records what arrived. See
[M4-PLAN.md](./M4-PLAN.md) §1 for the four answers.

The goal above originally read "money moves through the product, not just through
a notebook". That is now the opposite of what was decided, so it is replaced
rather than quietly reinterpreted.

### Scope

**Built — the collection desk (M4a):**

- [x] Offline collection fully first class: cash and cheque with receipt number,
      collector, and reference
- [x] **Every payment issues a receipt**
- [x] A collection session — one date, one fund, one collector — with a running
      total as receipts are issued
- [x] Receipt numbers come from a real sequence (`lib/sequence.ts`), not a
      table count
- [x] The provider seam (`lib/payments.ts`): a `PaymentsProvider` interface with
      a local implementation. It is unwired and no longer waiting for a
      decision — it is what made changing the committee's mind cheap
- [x] The tables a gateway would need already exist and are reset with the rest
      (`gatewayIntents`, `gatewayEvents`, `settlements`), and `gateway.ts` is the
      exceptions surface they would be read from — shipped **empty by design**

**Built — the static UPI QR, which is what replaced the gateway:**

- [x] UPI address (`upiId`) on a bank account, validated on the way in
- [x] A printable account panel: account number grouped in fours, IFSC, UPI
      address, and the QR — on the console Banks screen
- [x] `/me/pay` in the member portal: the account and the QR, with a print
      button, and the instruction to tell the treasurer
- [x] The QR is drawn in the browser; no request leaves the page
- [x] The QR carries **no amount and no transaction reference**, and the suites
      fail if it ever does

**Cancelled — the provider half (M4b).** Not deferred; not going to happen:

- ~~Payment gateway integration (UPI and cards)~~ — no merchant account needed
- ~~Payment link or per-member checkout~~ — a QR is an instruction, not a checkout
- ~~Per-fund dynamic QR~~ — nothing signs a per-member code without a gateway
- ~~Webhook endpoint, signature verification, idempotent processing~~ — nothing to receive
- ~~Failed and refunded payments recorded~~ — nothing to refund

### Exit criteria

Restated, because the original second criterion described a flow the committee
declined:

- [x] A cash collection at a meeting with no signal is recorded and reconciled
      later
- [x] A member can find the account to pay, on their phone and on a printed
      sheet, and knows they must then tell the treasurer
- [x] Replaying the same request does not double-count
- [x] Nothing in the app can claim a payment happened — the one guarantee the
      architecture owes, now load-bearing

That last one is the real test of this milestone. A system that takes money has
to be right about payments arriving; a system that records them has to be
incapable of inventing one. `recordPaymentFor` is still the only writer of money,
and it is still called by a human decision — the treasurer confirming a claim,
or entering a session at the desk.

### One hard constraint, recorded so it is not rediscovered

The old constraint — a Convex `httpAction` has no `ctx.db`, and the local
backend serves no HTTP routes, so a webhook could never be tested locally — is
moot. Nothing receives a webhook.

The constraint that replaced it is quieter and worth stating: **the application
must never appear to have received money.** No amount on the QR, no Pay now
button, no success message, no payment status. A member who believes the app took
their money stops telling the treasurer, and their contribution is silently never
recorded. That is asserted in `bun run check` and in both visual suites, because
the instinct to add an amount back is strong and the addition would be a serious
defect.

---

## M5 — Reminders and arrears

**Goal:** the money actually gets collected.

### Scope

- [x] Knock integration for email, SMS, and WhatsApp — **seam only, no vendor**
- [x] Reminder templates: due-soon, overdue, arrears summary
- [x] Scheduled monthly run for the whole org
- [x] One-tap "remind all unpaid" from the grid
- [x] Defaulter list with aging, sortable
- [x] Defaulter list export to CSV — follows the search and the sort
- [x] Opt-out preferences and consent capture
- [~] Delivery status and bounce handling — the log and the event shape exist
- [x] Per-member reminder history

### Exit criteria

- An unpaid contribution produces a reminder on schedule — the decision layer
  and the cron are built; nothing is dispatched until a provider is configured
- The treasurer sees who has been reminded and when
- A member can stop being reminded

### What was built, and the split that shapes it

The same split M4 made: the desk is provider-independent, the transport is a
seam. `convex/lib/notify.ts` holds the provider interface, the three templates
and the renderer; its only implementation is an offline stub, so the UI is
honest about the fact that nothing has been sent and cannot offer a button that
would lie. A real vendor changes one file and nothing else.

**A run is a record, not a loop.** `reminders:runCampaign` writes a
`reminderCampaigns` row holding the members it considered, the ones it queued,
and the ones it skipped *with the reason* — `opted_out`, `no_destination`,
`already_reminded`. That is what makes "you reminded 61 people" an answerable
question afterwards, and it is why the campaign is a row rather than a loop. The
monthly cron and the treasurer's button call the same builder, so the two cannot
drift apart.

Scheduled runs are idempotent per (org, kind, period), because a monthly cron
that fires twice must not chase the same people twice. A manual run is
deliberately not: a treasurer who presses the button twice has asked twice, and
silently ignoring the second press is its own bug.

### The consent asymmetry, which is the part worth arguing about

`setPreference` uses `requireMember`, not `requireTreasurer`, and the target is
always the row belonging to the signed-in account. Consent is the one thing in
this codebase a console user cannot grant on anybody's behalf — a treasurer
"just turning it off for them" is exactly the case that would be indefensible
later. A treasurer *can* record a refusal made in person, because a member who
asks to be left alone does not always have an account. Turning something off
needs the person; turning it on does not. `myPreferences` is session-scoped in
the same way as the rest of the portal, so it is not possible to ask it about
somebody else by passing a different id.

### Still open

- **The vendor.** Knock (via Gravity) is the recommendation: three channels on
  one integration, a Node client, per-recipient delivery status and bounce
  webhooks. It is a paid account and nothing is wired, by design.
- **The cron needs a hosted deployment.** `reminders:runScheduled` is an
  `internalMutation`, callable only from a scheduler, so the monthly run cannot
  fire against the local backend. It needs a real Convex deployment.
- **The M4b gateway is closed, not waiting.** The committee answered on
  2026-09-29: no online collection. Nothing about it is pending a decision, and
  a static UPI QR is the shipping state. Anyone reopening this should read
  [M4-PLAN.md](./M4-PLAN.md) §1 first.
- **Export** of the defaulter list is **built** (see below). What is not built is
  a call list: the export names the channel a member can be reached on and
  carries no phone number or email, which is a decision rather than an
  omission.

---

## M6 — Multi-tenancy

**Goal:** more than one community, with provable isolation.

**Why it gates being a product:** one database is one community. Until this
lands, CommunityFund is an internal tool for a single organization.

### Scope

- [x] `organizations` table; every table org-scoped and indexed on `orgId`
      *(already true at M1 — all 20 non-org tables carry `orgId` and a `by_org`
      index; the org table itself is the one that must not)*
- [x] Signup creates an org and the first admin
      *(`/signup` creates the identity, `/welcome` creates the organisation and
      makes the creator its first `admin` — see `convex/orgs.ts` and
      `scripts/visual-signup.mjs`)*
- [x] Onboarding wizard: org details, banks, funds, members, import
      *(org details, a first bank account and a first fund are done, and the
      import is the member-and-history half — see `scripts/visual-import.mjs`)*
- [x] Member and payment CSV import — the real adoption path
      *(contributions, payments and ledger entries, with a server-side preview
      that reports every problem in the file before anything is written — see
      `convex/imports.ts` and `convex/lib/importcsv.ts`)*
- [ ] Org switcher for users in multiple orgs
- [ ] Per-org settings and numbering sequences
- [x] Enforce org isolation in the shared `authz` helper, not per-handler
      *(`requireActor` resolves `orgId` before any handler runs; the three
      console read-model files import `requireConsole` under the old
      `requireMember` name so a query added later cannot pick up the weaker
      gate)*
- [~] Data export and account deletion for a departing org
      *(deletion is built — `orgs.deleteOrganization` purges every org-scoped
      table in one transaction; the export half is not)*
- [x] Cross-org access test suite

### Exit criteria

- [x] Two orgs exist with data that never crosses
- [x] Every query is provably org-scoped (tested, not assumed)
- [x] A new community can sign up and be running in under an hour with a CSV import
      *(both halves are proven end to end and neither touches the seeded data)*

### Signup, and why it is two screens

A community now arrives through a door: `/signup` takes a name, an email and a
password, and `/welcome` takes the organisation. The split is not a UX
preference, it is the only ordering the data model allows.

The auth provider writes the `users` row, and at the instant it does there is no
organisation to point at and nobody to be on the committee of. So the account
exists first, with `orgId` and `role` both null — a state the system had never
had and did not model. `requireActor` answered it with *No organisation is
linked to this account*, which is correct and, on its own, painted the entire
app in the "could not load your data" screen and told a brand-new user their
account was broken.

Three things came out of that:

**`requireIdentity` sits beside `requireActor` rather than inside it.**
`convex/orgs.ts` is the only file in the codebase where "signed in" is enough
to do something, and it is the only file where that is true. Everywhere else,
`requireActor` still refuses first. The two functions share `resolveUser`, so
the "Not signed in" rule cannot drift between them, and they agree on nothing
else — every further condition is applied by the function that owns it.

**`orgs.createOrganization` refuses a caller who already has an organisation.**
This is load-bearing rather than tidiness. Without it, any existing admin could
call it and receive a second organisation they would also administer — a way
around every role check in the system, by making a fresh tenant. It takes no id
argument, so there is nothing to aim at somebody else's.

**The slug is derived on the server, not chosen.** Two communities called
"Jamaat Anjuman" in different cities both get a working identifier without
either being asked to invent one.

### The import, and the rule it is not allowed to break

`bun run visual:import` — 49 checks — imports a grid, a payment register and a
set of ledger entries through the real screen.

The design constraint is that **`convex/imports.ts` may not write to
`ledgerEntries`, `payments` or `contributions` directly.** It calls
`postEntry` and `recordPaymentFor` — the same two functions the treasurer's desk
calls — so an imported rupee produces byte-for-byte the rows a typed one would,
including receipt numbering, the materialised `balances` update, the
closed-period check and the audit row.

That is not tidiness. A second writer of money is the one bug in this codebase
that cannot be walked back, and the import path is the *most* dangerous place
for it, because it is the one that runs unattended over eight years of
somebody's history. The suite asserts `balances:verify` still holds after an
import, which only happens if the ordinary writers were used.

**Everything is validated before anything is written.** The preview is a
*query* running the same parser as the commit, so what it says is what the
commit does, and the import button does not exist until it comes back clean. A
file with 4,000 good rows and one bad one imports nothing — the alternative is a
half-imported ledger, and the only way to undo one of those is a reversing entry
that somebody has to find later. Every problem is reported at once, by row,
because a treasurer fixing row 4,000 cannot afford to fix them one exception per
upload.

**It is safe to run twice.** Every row carries a key derived from a hash of the
file's contents, so a double click or a browser retry produces the same books.

### The bug the import suite found, which is the reason it is worth having

A member's file said January and March were paid, leaving February open. The
import replays a payment for each paid month, and the ledger settles the oldest
unpaid month first, so **the March payment settled February** — and March was
left open.

The first implementation resolved that by forcing the file's stated status onto
March. The grid then showed Ayesha as paid for all three months: **₹450 claimed
from a member who had given ₹300.** The money was right; the grid was not, and
a grid that overstates collection is the one number a treasurer cannot audit
their way out of.

The rule is now absolute: *a month is only ever paid because a payment settled
it.* The ledger decides where the money went, the grid agrees with the ledger,
and the difference is reported — "the file says 2024-03 was paid, but that
payment settled an earlier unpaid month; 2024-03 is still shown as due" — rather
than papered over. There is an assertion in the suite named for this.

### The end-to-end suite, and what it is really for

`bun run visual:signup` — 35 checks — is the only suite that signs nobody in.
Every other one signs in as an account the seeder wrote, and the seeder writes
`organizations` *before* `users`, which is the exact order a real community
cannot happen in. Nothing before M6 had ever driven the door.

The load-bearing group is the isolation one. Every other check in the file would
also pass against a build where signup quietly attached the new account to the
seeded organisation — which is the failure mode M6 exists to prevent and which
nothing else in the codebase would catch. So the suite signs in as the demo
community's treasurer, in the same browser, and asserts they can see none of the
new community: not its fund, not its bank passbook, not its money.

It also deletes what it creates, and then checks the deletion happened. Each
run makes a real organisation with a real administrator; leaving those behind
would accumulate, and every one of them would be indistinguishable from a
genuine tenant to every other suite. A gate that can only be run once is not a
gate.

### What the isolation suite found

The first exit criterion is the one worth writing down, because it produced a
real defect that a code review would not have.

`aggregate:bankPassbook` was safe but not by construction. Every read inside it
was scoped to `actor.orgId` and then filtered by `args.bankId`, so a bank id
belonging to another organisation produced a well-shaped, correctly-zeroed
passbook: zero opening, zero closing, no entries. Nothing leaked. But the handler
never asked whether the bank was the caller's, and "no leak" and "queried the
wrong org and got an empty answer" are indistinguishable to a caller. The next
person to loosen that filter would have lost the guarantee without changing a
line anyone was looking at. It now returns `null` for a foreign or missing bank,
exactly as `fundDetail` and `memberPassbook` already did.

So the suite is not asserting "no money came back" — several of its assertions
would have passed against the old code. It asserts that every id-taking query
*refuses*, in a single uniform shape, so the difference between "I found nothing"
and "that is not yours" is not something each handler has to remember.

The suite signs in as each org's own admin, takes the **other** org's real
document ids, and points every id-taking query at them — both directions, plus
the two listings that need no id at all and would leak more quietly. It also
drives a plain `member`-role account, which is refused the console read models
outright and can only reach `portal:summary`; the member's dues are checked to be
computed inside their own organisation, since a dues total is the easiest number
in the product to get wrong by dropping one `orgId` filter and the hardest for
a human to notice.

`convex/seedSecondOrg.ts` is the fixture — `masjid-committee`, its own admin,
bank, fund, member, a paid contribution and three balance rows. It is
idempotent and returns the existing ids when re-run, so it is a gate that can
be re-run rather than a one-shot.

**Still open:** a new community can now register, name itself, and bring its
history in — but it starts with no *members*, only the ones the import names. A
treasurer whose spreadsheet has no email column has to add their cousins one at
a time first, and member import is not built. There is also no org switcher, no
per-org settings, and no data export (deletion is built; export is not).

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
