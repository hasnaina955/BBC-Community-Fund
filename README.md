# CommunityFund

Fund, contribution, and collection management for Indian community and religious
organizations — housing societies, masjid/jamaat committees, wakfs, and NGOs.

Track multiple funds, collect monthly member contributions, run an approval
workflow, and reconcile every rupee against the bank.

---

> [!IMPORTANT]
> **Milestones M0, M1, M2a–M2d and M3 are complete — this runs against a real
> backend, over eight years of real-shaped history.**
>
> This repo previously held only a compiled frontend bundle whose backend had
> been lost. The app has been rebuilt as a Vite + React + TypeScript + Convex
> project, with the design system recovered verbatim from the legacy build, and
> now reads and writes real data behind real authentication.
>
> Balances are derived from an append-only ledger — there is no stored balance
> counter anywhere, which is the defect that made the original model
> untrustworthy. The recovered bundle is preserved in `legacy/` as the
> specification. See [docs/RECOVERY.md](docs/RECOVERY.md).

---

## What CommunityFund does

An organization runs several funds at once — a general fund, a zakat fund, a
charity fund, an emergency reserve, a building project. Each fund has its own
bank account, a manager, and a target. On top of that, members pay a fixed
**monthly contribution** that is tracked month by month across the year.

CommunityFund is the tool a treasurer uses to:

- Track fund balances and bank balances
- Record deposits, withdrawals, and inter-fund transfers
- Require approval before a transaction affects a balance
- Mark monthly contributions paid or unpaid on a year grid
- See collection progress, defaults, and monthly cash flow
- Hand the committee a report

And the tool a member uses to:

- See what they owe this month, in arrears, and in total — without asking anyone
- Print a passbook statement, or save it as a PDF from the phone's own print sheet
- Download a receipt for any payment ever made
- Tell the treasurer they have already paid, and watch it get confirmed
- Install it to their home screen and share their balance on WhatsApp

A member account sees only their own record. It is a different application from
the console, not a reduced one: a member has no use for a sidebar of nine
destinations, and the two are gated separately on the server.

## Status

| Area | State |
| --- | --- |
| Source code | **Done (M0)** — Vite + React + TS, 10 routes, all compiling |
| Design system | **Done (M0)** — light + dark tokens recovered from the legacy CSS |
| Domain model | **Done (M0/M2c)** — v2 schema in Convex, incl. `collectionMode` |
| Backend / API | **Done (M1)** — queries, mutations, ledger writer, audited |
| Authentication | **Done (M1)** — Convex Auth, PBKDF2 passwords, JWT sessions |
| Trustworthy money | **Done (M2a)** — derived balances, materialised and verifiable |
| Server-side aggregation | **Done (M2b)** — every dashboard and report figure |
| Collection modes | **Done (M2c)** — arrears only where a due actually exists |
| Reconciliation and FY close | **Done (M2d)** — statements vs. the books on the statement's date; a closed year locks its entries |
| Member portal | **Done (M3)** — what I owe, a printable passbook, receipts, mark-as-paid, installable |
| Verified in a browser | **Done** — 216 console checks + 71 portal checks ([docs/VISUAL-VERIFICATION.md](docs/VISUAL-VERIFICATION.md)) |
| Data | **Done (M1)** — seeded: 1 org, 7 staff, 3 banks, 6 funds, 84 members |
| Online collection, reminders | M4–M5 |

## Running it

```bash
bun install
bun run dev        # Convex backend + Vite together, http://localhost:5173
bun run typecheck  # tsc -b --noEmit, app + convex
bun run build      # typecheck + production build into dist/
bun run check      # authz, the mode rule, and the balance invariant
bun run smoke      # every read model returns against the seeded data
bun run measure    # payload per screen, against history
bun run visual     # every console screen in a real browser, against real data
bun run visual:portal  # the member portal, on a phone-sized viewport
```

`bun run dev` starts **both** halves, because the Convex backend only listens
while a Convex process is running — running Vite alone leaves the app with no
backend. Use `bun run dev:web` and `bun run dev:backend` to run them apart.

### Environment

Set these in Settings → Environment (they load into the shell and the preview
automatically; do not hand-edit env files).

| Variable | Where | Value |
| --- | --- | --- |
| `VITE_CONVEX_URL` | `.env.local` | Convex deployment the browser talks to |
| `CONVEX_AUTH_DOMAIN` | Convex deployment | Must match the JWT `iss` claim |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Convex deployment | Signing keypair |

For this sandbox the local Convex backend is `http://127.0.0.1:3210` and the
auth domain is `http://127.0.0.1:3211` (the Convex *site* port — the mismatch
between these two is the single most common Convex Auth setup mistake).
Generate the keypair with `bunx @convex-dev/auth --web-server-url <origin>`.

> **Opening the app from a browser that is not on the sandbox's loopback.** A
> local Convex backend only listens on loopback, so a page served from anywhere
> else — the hosted preview, a tunnel to this machine, another device on the LAN
> — cannot reach it. Chrome blocks that outright under its local-network access
> checks, and the symptom is a silent hang: the sign-in button spins forever
> because `signIn()` waits on a socket that never connects, with no error shown.
>
> The Vite dev server therefore proxies `/__convex` to the backend, websockets
> included, and `src/lib/convex.tsx` points the client at that same-origin path
> whenever the page itself is not on loopback. Opening the app on `127.0.0.1` and
> opening it through a tunnel to port 5173 therefore behave identically, and only
> the Vite port needs to be reachable. A real cloud deployment still just works:
> point `VITE_CONVEX_URL` at it and it is used directly.

### Demo accounts

The seeded deployment signs in with any of these, password `community123`:

| Email | Role |
| --- | --- |
| `secretary@jamaat.org` | admin |
| `treasurer@jamaat.org` | treasurer |
| `bilal@jamaat.org` | fund manager (scoped to its funds) |
| `farhan@jamaat.org` | viewer (read-only) |
| `sadia@jamaat.org` | deactivated |
| `imran@example.org` | member, with a linked record |
| `ayesha@example.org` | member, **not** linked — the claim flow |

Re-seeding: `bun run seed:reset && bun run convex:seed`. The reset refuses to
run without its exact confirm string, and only ever touches the demo
organisation.

### Back-filling the real history

The seeded deployment has nine months of data. The community's actual books go
back to 2018, and reproducing that is the only honest way to check that the app
handles its volume:

```bash
bun run seed:history   # 2018 → last year, one year per call
bun run check          # every materialised balance equals the sum of its entries
bun run smoke          # all 30 read models return a result
bun run measure        # what each screen actually downloads
bun run visual         # every screen renders, and the numbers are the server's
```

`seed:history` is one year per mutation because Convex allows 4096 document
reads inside a write transaction and a single year is already several thousand
rows. It resumes safely, and backs off when the local deployment's write-rate
limit intervenes.

`bun run measure` is the regression guard that matters most. With M1's
client-side aggregation, at eight years of history two read models **fail
outright** rather than merely getting slow:

```
data:listLedgerEntries   Array length is too long (10066 > maximum length 8192)
data:listPayments        Array length is too long ( 9979 > maximum length 8192)
```

| | Bytes for the whole app, at 8 years |
| --- | --- |
| Client-side aggregation (M1) | 1,492,414 — and two queries fail |
| Server-side read models (M2b) | 180,296 |

## Recovered stack

| Layer | Technology |
| --- | --- |
| Build | Vite |
| UI | React, React Router |
| Components | shadcn/ui, Tailwind CSS |
| Charts | Recharts |
| Animation | Framer Motion |
| Validation | Zod |
| Backend (original) | REST API, Drizzle ORM, SQLite |
| Auth (original) | Hand-rolled password + role — **to be replaced** |
| Generated by | Perplexity Computer |

Target stack for the rebuild is **Convex + Convex Auth** — rationale in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

Start here, then go deeper:

| Document | What it covers |
| --- | --- |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Who it is for, what problem it solves, personas, scope, glossary, definition of done |
| [docs/RECOVERY.md](docs/RECOVERY.md) | Technical archaeology — exact schema, API surface, routes, and the flaws baked into the original design |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Target stack, v2 data model, key design decisions and their rationale |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones M0–M8 with scope, exit criteria, and dependencies |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Payments, receipts, and messaging services |

## Repository layout

```
.
├── index.html                 # Vite entry
├── src/                       # application source
│   ├── main.tsx  App.tsx  index.css
│   ├── routes/                # the 10 recovered screens + /auth
│   ├── components/ui/         # shadcn/ui primitives
│   ├── components/layout/     # app shell, auth gate, route guard
│   ├── components/shared/     # page header, stat cards, status badges
│   ├── lib/                   # types, money, formatting, convex client
│   └── data/                  # shell store, per-screen read models, period
├── convex/                    # backend
│   ├── schema.ts              # v2 schema, incl. collectionMode and balances
│   ├── auth.ts  auth.config.ts  http.ts
│   ├── data.ts                # org-scoped row reads
│   ├── aggregate.ts           # every dashboard and report figure
│   ├── balances.ts            # verify / recompute the balance invariant
│   ├── funds.ts  members.ts  transactions.ts  collections.ts
│   ├── seed.ts                # demo seeder + guarded reset + history
│   └── lib/                   # authz, audit, ledger, balances, funds, money
├── scripts/                   # dev runner, seed drivers, smoke + measure
├── legacy/                    # the ONLY copy of the original build — read-only
│   ├── index.html
│   └── assets/
│       ├── index-Bc3sSda3.js  #   compiled app (schema + validators + routes)
│       └── index-0GK1rzsZ.css #   the design system the tokens were taken from
├── docs/                      # project documentation
└── README.md
```

> [!CAUTION]
> **`legacy/` is the surviving copy of the original application.** It is kept
> as the specification for the rebuild. Do not delete it. See
> [docs/RECOVERY.md](docs/RECOVERY.md#how-to-inspect-the-bundle).

## The plan in one paragraph

M0 reclaimed the codebase and M1–M2d stand up a real backend with real
authentication, a trustworthy ledger, aggregation that survives eight years of
history, a fund model that knows the difference between money members owe and
money they choose to give, and reconciliation that checks the books against the
bank. M3 turns that around to face the member: a portal where a person can see
what they owe, print a passbook, and claim a cash payment they already made. Then
the product grows outward: actual online collection (M4), automated reminders
that chase unpaid contributions (M5), multi-tenancy so more than one community can
use it (M6), reporting and compliance (M7), and finally operational hardening
(M8).

## The member portal

`/me` is a separate application from the console at `/`, sharing one session and
one backend. It exists because the two are used by people with entirely different
relationships to the software: a treasurer on a laptop, and a member standing in
a queue at the collection table who will use it about twice a year.

It is a 390px single-column app with a bottom tab bar, installable to the home
screen, and it never caches a balance — an authenticated read always goes to the
network, because showing somebody a stale "you owe nothing" is worse than
showing them nothing.

The security boundary is the point, and it is enforced twice: `ConsoleGate` in
`App.tsx` turns a member away from the console before its sidebar renders, and
`requireConsole` in `convex/lib/authz.ts` makes the server refuse independently.
A member account is the first role in this system that is signed in but is *not*
on the committee, which is exactly why those are two different gates — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-member-portal-and-the-role-that-made-the-console-honest).

## Working on this repository

Start with [docs/RECOVERY.md](docs/RECOVERY.md) to understand what was
recovered, then work against [docs/ROADMAP.md](docs/ROADMAP.md).

Three conventions matter here:

- **Money is integer paise**, never floats or decimal strings. Format for
  display at the UI edge with the helpers in `src/lib/format.ts`.
- **Balances are never authored.** They are derived from `ledgerEntries`, and
  the derivation is materialised into `balances` so it can be read at scale —
  written in the same transaction as the entry, rebuildable from the entries,
  and checkable on demand with `balances:verify`. There is deliberately no
  `currentBalance` field on funds or banks. Only `convex/lib/ledger.ts` may
  write a `ledgerEntries` row.
- **Aggregation happens in Convex, not in the browser.** `src/lib/selectors.ts`
  is gone; `convex/aggregate.ts` returns computed read models and each screen
  subscribes to the one it draws. A `.collect()` of the whole ledger would
  exceed Convex's 16384-document limit at this community's history length, so
  reads are index-bounded by year, fund or open status instead.

And one domain rule that is enforced in exactly one place,
`convex/lib/funds.ts`:

- **Only a `fixed_monthly` fund has dues.** Arrears, waivers and the collection
  grid exist for that mode alone. A voluntary, pledge-based or donation fund
  never acquires a debt, because for those funds nobody owes anything.
  `assertHasDues()` is the gate, and `bun run check` asserts it.

The legacy build is read-only reference material. Preserve it and every
pre-existing change.

## License

No license file has been added yet. The repository owner should choose one
before the project is distributed or made public.
