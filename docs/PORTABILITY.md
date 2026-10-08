# Porting off Convex

**Short answer: yes, and this codebase is unusually well placed for it — but not
blindly.** The domain logic is mostly pure and would move unchanged. The money
paths depend on a guarantee Convex provides implicitly and that a port has to
provide *explicitly*, and that is where the risk is. The verification suites are
larger than the backend and are cheaper to move than they look.

This document is a measured assessment, not a commitment. It exists so the
decision can be made against numbers rather than instinct, and it names the parts
that would have to be done carefully rather than the parts that would be tedious.

---

## 1. What is actually coupled

Measured on this tree.

| | |
| --- | --- |
| Total source | 36,486 lines of TS/TSX across `src/`, `convex/`, `scripts/`, plus 124 lines of generated JS |
| `src/` (React) | 13,524 lines, 26 route files |
| `convex/` (backend) | 13,063 lines — 9,562 top level, 3,501 in `lib/` |
| `scripts/` (verification) | 9,556 lines across 17 scripts — suites, seeders and helpers |
| Functions | 55 queries, 40 mutations, 0 actions, 4 `internalMutation`, 1 `internalQuery` |
| Database calls | 188 `.query(...)`, 185 `.withIndex(...)`, 157 `.collect()`, 28 `.first()`, 1 `.order()`, **0 `.paginate()`** |
| Tables and indexes | 28 tables (22 application + 6 auth), 242 fields, 76 indexes, all now in `db/schema.sql` |
| Convex types in the app | 103 `Id<"table">`, 37 `v.union`, 3 `Doc<` |
| Client coupling | 14 files import `convex/react`; 56 `useQuery`/`useMutation` sites; 62 `api.*` references |

**Features that are not used at all**, which shrinks the problem considerably: no
`ctx.scheduler`, no `ctx.storage` (no file uploads), no `cronJobs`, no `ctx.auth`
in handlers. The whole backend is queries, mutations and the database.

**The schema is ordinary.** Twenty-eight tables, 76 indexes, optional fields and
unions. `convex/schema.ts` maps to SQL DDL essentially one-to-one; the 37
`v.union` validators become `CHECK` constraints or enum types, and `zod` is
already a dependency for the input side.

---

## 2. The three things a port must replace deliberately

### 2.1 Atomic multi-write mutations

Every Convex mutation is a serialisable transaction. This codebase leans on that
in ways that are load-bearing rather than incidental:

- **`postEntry`** writes a ledger entry and then moves the materialised balances.
  `lib/balances.ts` states the rule: *"Every call happens inside the mutation that
  wrote the entry, so the counter and the entry commit together or not at all."*
- **`recordPaymentFor`** writes a payment, posts a ledger entry, patches the
  contribution rows it settles, and records an audit row — one transaction.
- **`deleteOrganization`** purges roughly twenty org-scoped tables in one
  transaction, and says why: *"If anything above throws, the transaction rolls
  back and the community is still whole."*
- **`runImport`** is all-or-nothing across thousands of writes: *"a file with
  4,000 good rows and one bad one imports nothing."*

On Postgres this is `BEGIN` … `COMMIT` with the isolation level chosen
deliberately. On a thin REST layer over an ORM it is easy to get wrong, and the
failure mode is precisely the one this project fears most: a balance that
double-counts, which *"does not announce itself, it just stops reconciling months
later."*

**This is the part that must be designed, not translated.**

### 2.2 The receipt sequence

`lib/sequence.ts` records that the receipt number used to be
`R-${payments.length + 1}` and that it was wrong twice: a full-table scan on the
hottest write, and a genuine collision — *"two payments recorded before either
committed both read `n + 1` and both wrote `R-00n`."* The fix was a counter row
read, incremented and written inside the caller's mutation, which is safe
*because* Convex serialises conflicting mutations.

That guarantee is Convex's, not the code's. A port must supply it: a Postgres
sequence, `SELECT … FOR UPDATE`, or — best — a single
`UPDATE counters SET value = value + 1 RETURNING value`, which is atomic by
construction and strictly safer than what happens today.

A collection round is exactly the burst that widens the window: a treasurer
tapping cash payments in a row. Two members holding the same receipt number is not
cosmetic in a book that reconciles against a bank statement.

### 2.3 Reactive queries

56 call sites assume that a write invalidates every read that depends on it. There
is no polling anywhere, because there has never needed to be.

The replacement is well-trodden — TanStack Query with explicit invalidation, or
Postgres `LISTEN`/`NOTIFY` behind a websocket for the live feel — but it is the
single largest *client* change, and it touches every screen. It is also the change
most likely to introduce a subtle staleness bug: a dashboard showing a balance
from before the payment that just landed.

---

## 3. What a port would gain

- **No 16,384-document cap.** This limit shaped the architecture: `by_open` exists
  because arrears must be proportional to defaulters rather than history,
  `aggregate.ts` exists because the browser must not receive the ledger, and
  `lib/sequence.ts` was rewritten because a full scan would have started failing at
  twice the seeded history. None of that design needs undoing — it is already the
  portable design — but the ceiling goes away.
- **No 16,000-writes-per-mutation cap**, which is why `seed:history` imports one
  year per call.
- **Real transactions with visible semantics**, `EXPLAIN`, `FOR UPDATE`, and
  constraints the database enforces rather than the application remembering.
- **Backups and point-in-time recovery as a commodity.** M8 wants both, and "run
  `pg_dump`/Litestream" is a shorter conversation than a hosted service's retention
  policy.
- **No vendor.** For a product whose whole argument is that a community owns its
  books, holding them in a proprietary backend is a real tension.

## 4. What it would lose

- **Reactivity for free**, as above.
- **"A mutation is the transaction"** as a mental model. The current code cannot
  forget to open a transaction, because there is no way to. A port can, and the
  discipline has to move into a shared helper — which is what `lib/ledger.ts`
  already is, so the shape survives.
- **Hosted operations.** Someone has to run Postgres, take backups, and watch it.
- **The committed type-safe wire.** `_generated` gives end-to-end types with no
  schema-first codegen step. That is replaced by a generator (or `zod` plus a
  hand-written RPC contract), and it is real work.

---

## 5. What moves unchanged

This is the good news, and it is not an accident: the project kept its domain
logic out of the database layer.

**Ten of the eighteen `lib/` modules never touch a database context — 2,170 lines
across nine of them port with no edit at all:**

| File | What it holds |
| --- | --- |
| `lib/money.ts` | Paise arithmetic and the integer guards |
| `lib/funds.ts` | The collection-mode rule |
| `lib/arrears.ts` | Ageing and oldest-due allocation |
| `lib/payments.ts` | The settlement rule |
| `lib/reminders.ts` | Consent and campaign decisions |
| `lib/importcsv.ts` | The CSV parser, including the formula round trip |
| `lib/roster.ts` | Roster identity rules |
| `lib/exportfiles.ts` | The export column contract |
| `lib/password.ts` | PBKDF2 hashing and verification |
| `lib/notify.ts` | The notification seam |

The tenth, `lib/funds.ts` (65 lines), is one line short of verbatim: it takes its
`FundDoc` and `FundId` types from Convex's generated data model, so the port
repoints two type aliases at the top of the file and nothing else in it moves. That
is the honest version of "ports unchanged", and `bun run portability` counts it
separately rather than folding it into the happy figure.

The other eight (1,266 lines) are the ones with the interesting problems:
`authz.ts`, `balances.ts`, `ledger.ts`, `collection.ts`, `audit.ts`, `members.ts`,
`sequence.ts`, `years.ts`.

**The verification suites are cheaper to move than their size suggests.** They are
9,556 lines, but the Convex-specific part of them is **ten small transport
helpers**, one per suite, each about fourteen lines:

```js
await fetch(`${CONVEX}/api/${kind}`, { method: "POST", body: JSON.stringify({ path, args }) })
```

Everything else is assertions over JSON. An RPC endpoint of a similar shape
(`POST /api/query { fn, args }`) means ten one-function edits, and the 48 pure
assertions in `check` — which already import the domain modules directly and never
reach the wire — keep working untouched.

---

## 6. Where it would go

| Target | Fit |
| --- | --- |
| **Postgres + a thin RPC** (Hono/Fastify, Kysely or Drizzle, TanStack Query) | **Recommended for the multi-org product.** Transactions, sequences and indexes are all first-class; the 2,235 pure lines move unchanged; the read models become SQL. Most work, least surprise. |
| **Supabase** | Managed Postgres, so the above, plus realtime and auth for free. Caveat: **do not use row-level security as the authorisation layer.** This codebase deliberately centralises authorisation in `requireActor` so a new handler cannot pick up a weaker gate; RLS would be a second, divergent trust boundary. Use it as defence in depth, if at all. |
| **SQLite + Litestream** | Genuinely attractive for a *single* community: transactions are trivial, there is no concurrency to speak of, and one file is easy to back up and hand over. It fights the multi-tenancy M6 just built, and the collection-round write burst, so it is the right answer to a different question. |
| **PocketBase / Firebase** | Would repeat the mistake. The point of porting is to own the books, and both replace one proprietary backend with another. |

**If the goal is only "not Convex", SQLite is enough. If the goal is the product
in the roadmap — many communities, one deployment — it is Postgres.**

---

## 7. How it would be done

Each stage has a gate that already exists in this repository, which is the
argument for doing it at all: the port can be *proved* at every step rather than
assessed at the end.

| Stage | Work | Gate |
| --- | --- | --- |
| 0 | Choose the target. Stand up an empty database and port `balances:verify` as SQL. | The invariant runs against an empty schema |
| 1 | `schema.ts` → DDL, indexes one-to-one | Typecheck; every `by_*` index exists |
| 2 | Move the ten pure modules unchanged | The 48 pure `check` assertions pass untouched |
| 3 | Money paths → explicit transactions; counter → atomic increment | `balances:verify` holds; two concurrent payments never share a receipt number |
| 4 | Auth: JWT sessions replacing `@convex-dev/auth` | The isolation suite, both directions |
| 5 | `aggregate.ts` (1,360 lines) → SQL read models | `smoke` (37 read models) and `measure` (payload per screen) |
| 6 | Client: 56 call sites → TanStack Query | `visual`, `visual:portal`, `visual:signup`, `visual:import`, `visual:ui` |
| 7 | Delete Convex, `_generated`, and the ten transport helpers' old shape | Everything above, plus CI |

Stages 2 and 5 are large but mechanical. The risk is concentrated in stages 3 and
4 — roughly 2,500 lines of careful work — and stage 0 is the one that decides
whether the rest is safe, because it establishes the invariant the money paths are
then held to.


---

## 8. What stages 0–2 actually produced

The plan above was written as a plan. Three of its gates now exist and pass, and
they are the reason the rest is worth attempting: each one is runnable here, with
no deployment and no credentials, so the port can be *proved* step by step rather
than assessed at the end.

| | | |
| --- | --- | --- |
| `db/schema.sql` | 28 tables, 298 columns, 76 indexes, 69 foreign keys | Generated from `convex/schema.ts` by `bun run sql:schema` |
| `bun run sql:check` | **521 assertions** | The DDL against the Convex schema, by reading it back out of Postgres |
| `bun run sql:invariants` | **9 assertions** | The money invariant, and whether it can fail |
| `bun run portability` | **25 assertions** | The domain/database boundary, enforced |
| `bun run port` | all three | Wired into CI, because none of them needs a deployment |

### The schema is generated, not written

Hand-written DDL would be a second copy of the schema, and the two would drift the
first time somebody added a field — silently, because nothing compares them. So
`convex/schema.ts` stays the single source, and the check reads the result back out
of a real Postgres: every table, every column's type and nullability, every index's
columns in order, and every foreign key. It also asserts that the committed file is
byte-identical to what the generator produces, which is what makes the file
trustworthy — without that, the file could be stale and every check below it would
still pass.

It runs against **PGlite**, Postgres compiled to WebAssembly. No server, no Docker,
no credentials — which is the whole reason this half of the port can be verified on
a machine that has none of those.

**Every number becomes `bigint`.** Convex's number is a float64, so the schema was
62 floating-point fields deep and the integer discipline lived in `assertPaise` and
in review. A `bigint` column cannot hold a fraction of a paisa, and the check fails
if any column anywhere can — so the rule this codebase states twice in its own
comments is now enforced by the database rather than by convention.

### The invariant runs against the *current* implementation

`bun run sql:invariants` builds a small set of ledger entries, computes the balances
they imply using **`truthFromEntries` from `convex/lib/balances.ts`** — imported
straight into the check, because its imports are type-only and Node can load it —
and then asserts the SQL invariant finds nothing. Two implementations, one fixture,
the same answer. That is an equivalence check rather than a restatement.

Then it corrupts a balance and asserts the invariant *does* find it, names the
scope, and reports the difference in paise. It also checks the three ways the
invariant can be wrong in silence: a missing balance row against real entries, a
balance row with no entries behind it, and a backdated entry moving a year it was
not dated in.

### Two findings from doing it

**`_creationTime` is load-bearing.** It looked like Convex bookkeeping, and it is
the paging cursor `lib/balances.ts` walks the whole ledger by, because Convex's own
`paginate()` could not be re-driven per page. Dropping it while porting would break
`balances:recomputeAll` — the rebuild that makes the materialised balances
trustworthy. It is now a real column, with a comment saying why.

**The pure modules use extensionless relative imports.** `lib/arrears.ts` imports
`"./money"`, which TypeScript, Convex and every bundler accept and Node does not.
This is a resolver detail rather than a dependency — the target stack resolves them
the same way the current one does — so it does not change the estimate, but it does
mean "ports verbatim" is true of the *code* and not of the module resolution. The
check counts it rather than hiding it.

### What the boundary check is for

`bun run portability` holds the claim that makes the port cheap: no module on the
domain side of the line may take a runtime dependency on Convex. It keeps an
explicit manifest of all 18 `lib/` modules, and **fails when a new file is not
classified**, so the decision about which side a module belongs on is made
consciously rather than by default. It also loads every pure module in plain Node,
which is what lets the invariant check import the real implementation.

The current state it reports: 2,170 lines port verbatim across nine modules, one
module whose logic ports with two type aliases repointed, and 1,266 lines that need
a transaction.

### What is still not proven

The schema and the boundary are verified. **Nothing about the write path is.**
Stages 3 and 4 — explicit transactions, and the receipt counter as an atomic
increment — are unstarted, and they are the stages where a mistake double-counts a
balance. Stage 0 exists precisely so that when they are attempted, the invariant
that catches the mistake is already executable.

## 9. What would make this a bad idea

- **Doing it without a runnable deployment.** This tree has no Convex credentials
  and no Docker, so `check`, `smoke`, `measure` and every `visual:*` gate cannot
  run here. Porting money-path code while the invariants that catch its failures
  are un-runnable is how a balance starts double-counting.
- **Porting the money paths before the invariant.** `balances:verify` is the
  migration's acceptance test. Without it there is no signal until reconciliation
  fails months later — the exact failure this codebase was built to avoid.
- **Treating it as one change.** The M6 commit argued that signup, import and the
  isolation suite had to land together, because splitting them would land a test
  that cannot run. The same test applies here and the answer is the opposite: this
  splits cleanly along the stages above, and should.

## Related

- [Architecture](ARCHITECTURE.md) — the design these stages carry across
- [Roadmap](ROADMAP.md) — M8 wants the backups and monitoring a port would bring
- [Recovery](RECOVERY.md) — the flaws the money invariants exist to catch
