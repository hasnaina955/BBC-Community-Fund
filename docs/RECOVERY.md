# Technical Recovery Notes

Everything in this document was extracted from the compiled bundle in
`legacy/assets/index-Bc3sSda3.js`. It is the specification for the rebuild.

**How to read this:** treat it as high-confidence but verify against the bundle
when it matters. It was recovered from minified output, so field ordering and
default values are exact, but naming of internal symbols is meaningless.

---

## How to inspect the bundle

The bundle is minified onto very few lines, so grep by byte offset rather than
line:

```bash
cd legacy/assets
# find the byte offset of a table definition
off=$(grep -boE 'ds\("contributions"' index-Bc3sSda3.js | head -1 | cut -d: -f1)
# print a window starting there
dd if=index-Bc3sSda3.js bs=1 skip="$off" count=700 2>/dev/null
```

Useful `ds("table_name"` keys: `users`, `banks`, `funds`, `transactions`,
`members`, `contributions`, `audit_log`.

Recovering UI copy is just a string search — the original labels were preserved:

```bash
grep -oE '"[A-Z][a-z]+([ -][A-Za-z]+){0,5}[a-z][^"]{0,25}"' index-Bc3sSda3.js | sort -u
```

---

## Original stack

| Layer | Technology | Evidence |
| --- | --- | --- |
| Build | Vite | hashed asset filenames, `index.html` entry pattern |
| UI | React + React Router | `/funds/:id` route patterns, `path:` / `href:` keys |
| Components | shadcn/ui + Tailwind | `AlertDialogContent`, `CardHeader`, `cn()` utility |
| Charts | Recharts | `AreaChart`, `CartesianGrid`, `defaultTooltipEventType` |
| Animation | Framer Motion | `useAnimate`, `AnimationIteration` |
| Validation | Zod | `ZodDefault`, `.min(2, "Name must be at least 2 characters")` |
| ORM | Drizzle | `notNull().default()`, `references(() => x.id)`, identity PKs |
| Database | SQLite | integer identity keys, SQLite-style schema |
| API | REST under `/api/*` | endpoint paths recovered below |
| Auth | Hand-rolled | `password`, `hash`, `salt` strings; `/api/auth/login` |

---

## Route table

Ten routes plus a detail route were recovered, each with a matching sidebar nav
entry:

| Path | Page |
| --- | --- |
| `/` | Dashboard — stats, fund breakdown, monthly cash flow |
| `/funds` | Funds list |
| `/funds/:id` | Fund detail |
| `/members` | Members |
| `/contributions` | Monthly collection grid (year × month) |
| `/transactions` | All fund movements and requests |
| `/approvals` | Pending approvals queue |
| `/banks` | Banks and balances |
| `/reports` | Reports |
| `/settings` | Settings (admin-only) |
| `/users` | Users and roles (admin-only) |

## API surface consumed by the frontend

23 endpoints. The frontend was built against these; the rebuild should provide
equivalent functionality.

```
POST   /api/auth/login

GET    /api/funds                    POST   /api/funds
GET    /api/funds/:id                PUT    /api/funds/:id    DELETE /api/funds/:id

GET    /api/banks                    POST   /api/banks
GET    /api/banks/:id                PUT    /api/banks/:id    DELETE /api/banks/:id

GET    /api/members                  POST   /api/members
GET    /api/members/:id              PUT    /api/members/:id  DELETE /api/members/:id

GET    /api/users                    POST   /api/users
GET    /api/users/:id                PUT    /api/users/:id    DELETE /api/users/:id

GET    /api/transactions             POST   /api/transactions
GET    /api/transactions/:id         PUT    /api/transactions/:id
GET    /api/transactions/pending

GET    /api/contributions            POST   /api/contributions
GET    /api/contributions/:id        PUT    /api/contributions/:id
GET    /api/contributions/grid       --    year × month collection grid
GET    /api/contributions/stats      --    collection statistics
POST   /api/contributions/bulk       --    bulk mark paid/unpaid
POST   /api/contributions/bulk-year  --    bulk update across a year
PUT    /api/contributions/upsert     --    single cell upsert

GET    /api/dashboard/stats
GET    /api/dashboard/fund-breakdown
GET    /api/dashboard/monthly-flow

POST   /api/admin/reset              --    DESTRUCTIVE: wipes all data
```

### Endpoints that are missing but expected

Three pages have no corresponding API endpoint, which means they were either
stubbed or aggregated client-side:

- **`/reports`** — no report endpoint. Reports were almost certainly not
  implemented.
- **`/settings`** — no settings endpoint. Settings had no persistence.
- **Audit log** — `audit_log` exists in the schema and is referenced in UI copy
  ("All audit log entries"), but no `/api/audit` endpoint exists. It was
  written to and never read. There was no audit UI.

---

## Recovered data model

Seven tables, reproduced exactly as declared in the bundle. All primary keys
are SQLite integer identity columns. `numeric` fields were SQLite `real`
(floating point) — see the flaws section.

### `users`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, generated always as identity |
| `name` | text | not null |
| `email` | text | not null, unique |
| `password` | text | not null |
| `role` | text | enum, not null, default `viewer` |
| `is_active` | boolean | not null, default `true` |
| `created_at` | timestamp | not null, default now |

`role` enum: `admin`, `treasurer`, `fund_manager`, `viewer`

### `banks`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, identity |
| `name` | text | not null |
| `branch` | text | nullable |
| `account_number` | text | nullable |
| `ifsc_code` | text | nullable |
| `current_balance` | numeric | not null, default 0 |
| `notes` | text | nullable |
| `created_at` | timestamp | not null, default now |

### `funds`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, identity |
| `name` | text | not null |
| `type` | text | enum, not null, default `general` |
| `description` | text | nullable |
| `bank_id` | integer | → `banks.id`, nullable |
| `manager_id` | integer | → `users.id`, nullable |
| `target_amount` | numeric | nullable |
| `current_balance` | numeric | not null, default 0 |
| `is_active` | boolean | not null, default `true` |
| `is_member_contribution` | boolean | not null, default `false` |
| `monthly_amount` | numeric | nullable |
| `created_at` | timestamp | not null, default now |

`type` enum: `emergency`, `project`, `operational`, `zakat`, `charity`,
`investment`, `general`

### `transactions`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, identity |
| `fund_id` | integer | → `funds.id`, **not null** |
| `type` | text | enum, not null, no default |
| `amount` | numeric | not null |
| `description` | text | not null |
| `category` | text | enum, not null, default `other` |
| `to_fund_id` | integer | → `funds.id`, nullable (inter-fund transfer) |
| `status` | text | enum, not null, default `pending` |
| `requested_by` | integer | → `users.id`, **not null** |
| `approved_by` | integer | → `users.id`, nullable |
| `approval_note` | text | nullable |
| `reference` | text | nullable |
| `transaction_date` | timestamp | not null, default now |
| `created_at` | timestamp | not null, default now |

`type` enum: `deposit`, `withdrawal`, `transfer_in`, `transfer_out`
`category` enum: `operations`, `emergency`, `investment`, `donation`, `salary`,
`maintenance`, `other`
`status` enum: `pending`, `approved`, `rejected`, `completed`

The approval mutation's validation schema omits `id`, `created_at`,
`approved_by`, and `approval_note` — the server assigns those. This confirms a
two-step request/approve design.

### `members`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, identity |
| `name` | text | not null |
| `phone` | text | nullable |
| `relation` | text | nullable |
| `joined_year` | integer | not null, default 2020 |
| `is_active` | boolean | not null, default `true` |
| `created_at` | timestamp | not null, default now |

Update validator: `name` min 2 characters, `phone` optional/nullable,
`joined_year` integer between 2000 and 2100.

> **Note:** members have **no email field**. A member is a name and a phone
> number. There is no way to contact or authenticate a member digitally. This is
> the single biggest structural gap blocking the member portal (milestone M3).

### `contributions`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, identity |
| `member_id` | integer | → `members.id`, **not null** |
| `fund_id` | integer | → `funds.id`, nullable |
| `year` | integer | not null |
| `month` | integer | not null |
| `amount` | numeric | not null, default 100 |
| `status` | text | enum, not null, default `unpaid` |
| `paid_at` | timestamp | nullable |
| `note` | text | nullable |
| `recorded_by` | integer | → `users.id`, nullable |
| `created_at` | timestamp | not null, default now |

`status` enum: `paid`, `unpaid`, `waived`

One row per member per month per fund. The grid is assembled by querying rows
for a year and pivoting client-side.

### `audit_log`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | integer | PK, identity |
| `user_id` | integer | → `users.id`, nullable |
| `action` | text | not null |
| `entity_type` | text | not null |
| `entity_id` | integer | nullable |
| `details` | text | nullable |
| `created_at` | timestamp | not null, default now |

Correctly designed, and never surfaced in the UI.

---

## Design flaws in the original model

These are the reasons the product is not merely "unfinished" but would be
untrustworthy if shipped as designed. Each has a fix in
[ARCHITECTURE.md](ARCHITECTURE.md).

### 1. Duplicated money state — the critical flaw

`funds.current_balance` and `banks.current_balance` are both denormalized
counters, both mutated when a transaction is approved. Two counters, two code
paths, no reconciliation mechanism. They **will** drift, and when they do there
is no way to detect it.

There is no immutable record of what happened. A balance is a number someone
computed and stored, not a fact derived from entries.

**Fix:** a single append-only ledger; all balances derived. See
[ARCHITECTURE.md § The ledger](ARCHITECTURE.md#the-ledger).

### 2. Currency stored as floating point

Every money column is `numeric` → SQLite `real`. Summing 200 monthly
contributions in binary floating point will produce off-by-paise discrepancies.
For a fund whose credibility rests on the totals being right, this is not
acceptable.

**Fix:** integer paise everywhere. Format for display at the edge only.

### 3. `joined_year` is stored but never used

Members have a join year, and `funds.monthly_amount` exists, but nothing
derives an obligation from them. A member who joins in July is charged a full
year's dues. Proration was never implemented.

**Fix:** derive dues from join date and a proration rule rather than storing
the expected amount.

### 4. `POST /api/admin/reset`

One endpoint that deletes all contributions, transactions, and audit logs, and
resets every fund and bank balance to ₹0. The dialog even lists what will be
destroyed. No dry run, no typed confirmation, no scoping.

**Fix:** remove it. Destructive demo tooling does not belong in a product
holding community money.

### 5. The audit log is write-only

The table exists, the UI copy promises it, and no endpoint ever reads it. An
invisible audit trail is worse than none, because it invites trust it cannot
deliver.

**Fix:** make it a first-class, queryable, org-scoped feature.

### 6. Hand-rolled authentication

Raw `password` column, no sessions, no rate limiting, no lockout, no reset
flow, no expiry. Roles live in the same client-visible schema.

**Fix:** Convex Auth, server-side authorization on every function, and no
password material in application tables.

### 7. No reconciliation, ever

`banks.current_balance` is a number a human types in. Nothing compares it to
the sum of transactions. That comparison *is* the product's core value
proposition and it did not exist.

**Fix:** the reconciliation screen (milestone M2).

### 8. No collection of money

`contributions.status` can be `paid`, but nothing records *how* it was paid,
who collected it, or a receipt number. Payments are not representable, so
partial payments, prepayments, and refunds cannot be expressed.

**Fix:** separate the *obligation* (`contributions`) from the *payment*
(`payments` / `ledger_entries`).

---

## What was good

Worth carrying forward into the rebuild:

- A clean, small relational model with sensible enums
- A real four-role permission scheme
- A genuine two-step approval workflow with a requester and an approver
- `waived` as a first-class contribution status — communities need it
- A year × month collection grid, which is the right shape for this problem
- Inter-fund transfers modelled explicitly rather than as fake transactions
- An audit table designed correctly from the start
- A complete, coherent design system in the stylesheet

The domain instincts were right. The persistence layer and the missing backend
are what need rebuilding.

---

## Copy and strings worth preserving

Recovered UI copy, kept for tone and terminology consistency in the rebuild:

- Fund types surfaced as: Active Funds, Add Member, Active Members
- "Active members appear in the contributions grid"
- "All caught up!" — empty state for the approvals queue
- "Awaiting review" — approvals queue
- "Member Contribution Fund", "Monthly Amount (₹)", "Monthly Collection Grid — ", "Monthly Collection Overview — ", "Contribution Grid — "
- "Monthly Cash Flow", with sub-labels "Outflow: …"
- "Balance updated", "Fund created", "Fund updated", "Fund deleted"
- "Transaction approved", "Transaction rejected", "Transaction submitted for approval"
- "Member added successfully", "Member removed", "Member updated successfully"
- "Bank added", "Bank updated", "Bank removed"
- "User created", "User updated", "User removed"
- "Bulk update failed"
- "Admin access required", "Admin-only configuration and data management"
- Destructive confirmations: "All bank balances (reset to ₹0)", "All fund balances (reset to ₹0)", "All fund movements and requests", "All contribution records", "All audit log entries"
- Destructive warning: "? Their contribution history will be lost."

---

## Related

- [Product brief](PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
