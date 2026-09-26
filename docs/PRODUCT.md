# Product Brief — CommunityFund

## The problem

Every community organization that collects money — a housing society, a masjid
committee, a jamaat, a wakf, an NGO — runs the same operation on a spreadsheet
or a notebook:

1. Decide what each member owes this month
2. Chase the people who haven't paid
3. Record what came in
4. Record what went out, and get it approved
5. Tell the bank balance
6. Explain the position to the committee

They do this with a shared Excel file, WhatsApp messages, and a passbook. It
breaks in predictable ways. The spreadsheet is edited by several people and
nobody knows whose version is right. Balances get overwritten instead of
appended, so there is no history. Receipts are hand-written. A member who
wants to know what they've paid has to ask a person. The treasurer is a
data-entry clerk whose real job is chasing people.

The failure is not effort. It is **trust**: nobody, including the treasurer,
can prove the numbers are right.

## The insight

Two things make this tractable as software:

- **The obligation and the payment are different things.** A member owes ₹500
  for March. Paying ₹500 in April is a different event from owing it. Almost
  every naive fund app conflates the two, which is why partial payments and
  prepayments break.
- **Almost all money is still collected by hand, in a room, in cash.** A product
  that only works online will lose to the notebook. It has to be excellent at
  recording an offline cash collection and merely *good* at taking a payment
  online.

## Who it's for

**Primary: the treasurer or committee secretary** of a small-to-medium
community organization. Non-technical. Often part-time. Answerable to a
committee. Handles 30–500 members, ₹1L–₹50L a year, and a handful of funds.

**Secondary: the members.** They want one thing — to know what they owe, pay
it, and get a receipt. Today they ask a person.

**Tertiary: the auditor or committee member** reviewing the accounts at
year-end. Wants statements, a ledger, and an audit trail.

## Personas

### The Treasurer

Runs the monthly cycle. Needs the grid to be fast to fill in the night of the
meeting, needs approvals to be a formality rather than a bottleneck, and needs
the bank to reconcile at month-end. Their recurring fear is being asked a
question at the committee meeting they cannot answer.

### The Member

Pays ₹500 a month. Wants a number, a way to pay, and proof. Will not install an
app. Will click a link on WhatsApp. Notices immediately if they're told they
owe money they've already paid — that single failure loses the whole community.

### The Auditor

Needs an immutable trail: who approved what, when, and why. Needs annual
statements. Needs the books to have been closed, not retroactively edited.

## Product principles

1. **The number must be provable.** Derived from an append-only ledger, never a
   stored counter. If it can't be traced to entries, it isn't shown.
2. **Offline-first in practice.** Cash collection at a meeting is the primary
   event. The product must be fast and reliable on a bad connection, and
   recover gracefully.
3. **Never lose a payment.** Webhooks are retried, payments are idempotent, and
   a webhook arriving late must not double-count.
4. **No surprise destructive action.** Nothing important is deleted without a
   typed confirmation, and nothing is edited in a closed period.
5. **One link for the member.** Everything a member needs fits in a WhatsApp
   message.
6. **A committee can be shown the screen.** Design for projecting to a room of
   people who distrust spreadsheets.

## Feature pillars

| Pillar | What it delivers | Milestone |
| --- | --- | --- |
| **Books you can trust** | Ledger, reconciliation, passbook, financial-year close, audit log | M2 |
| **Self-service for members** | See dues, pay, download receipts, no treasurer needed | M3 |
| **Actually collecting money** | UPI/cards, payment links, QR, offline cash with receipt numbers | M4 |
| **Chasing the money** | Scheduled reminders, arrears aging, defaulter lists | M5 |
| **Works for any community** | Multi-tenancy, self-serve signup, data isolation | M6 |
| **Answering the committee** | Reports, exports, statements, certificates | M7 |

## Scope

### In scope

- Multiple funds, each with a bank account, a manager, and a target
- Monthly member contributions with proration, arrears, and waivers
- Deposits, withdrawals, and inter-fund transfers with a request/approve flow
- Bank reconciliation and per-member passbooks
- Online collection (UPI, cards) and offline collection (cash, cheque, UPI
  reference)
- Receipts, statements, and annual reports
- Reminders over email, SMS, and WhatsApp
- Four roles: admin, treasurer, fund manager, viewer
- Multi-tenant: many communities, isolated

### Out of scope (v1 of the product)

- Double-entry accounting and full statutory bookkeeping — this is fund
  management, not a Tally replacement
- Investment execution or trading — the product tracks balances, it does not
  move money into instruments
- Payroll
- Building a custom WhatsApp Business API integration from scratch — a managed
  provider is used instead
- Native mobile apps — responsive web, installable as a PWA

## Monetization

Not required to make the product good, but it shapes two decisions:

- **Free tier:** one organization, up to ~50 members, one fund. Enough for a
  small society to adopt and feel the value before paying.
- **Paid:** unlimited members and funds, member portal, online collection,
  automated reminders, exports.
- **Per-transaction fee** is the obvious alternative once online collection is
  live (M4), and is the only structure that scales with the organization's
  success.

Pricing and billing are deliberately deferred until the core is trustworthy —
selling a fund ledger before the reconciliation works would be indefensible.

## Domain glossary

Terms as used in this product, and as they appear in the recovered UI.

| Term | Meaning |
| --- | --- |
| **Fund** | A named pool of money with a purpose — general, zakat, charity, emergency, project, operational, investment |
| **Bank** | A bank account a fund is held in, tracked with account number and IFSC |
| **Member** | A person who owes a periodic contribution. Not a login user |
| **Contribution** | The obligation: member X owes ₹500 for March 2026 |
| **Payment** | The event: member X paid ₹500 on 4 April |
| **Ledger entry** | An immutable financial fact — the only thing balances derive from |
| **Reconciliation** | Comparing the bank's reported balance against the ledger's, and explaining the difference |
| **Passbook** | A member's running statement: paid, due, waived, arrears |
| **Waiver** | A contribution the committee formally forgives |
| **Arrears** | Contributions due from past months, still unpaid |
| **Proration** | Charging a member who joined mid-year only for the months since they joined |
| **Defaulter** | A member with unpaid or overdue contributions |
| **Financial year close** | Locking a period so its figures can no longer change |
| **Approval** | A second person authorizing a transaction before it affects a balance |
| **Zakat** | Obligatory almsgiving in Islam; a distinct fund type here, with its own rules and reporting |
| **Waqf** | An endowment under Islamic law, often held in a dedicated fund |
| **Passbook / receipt book** | Physical or digital proof of payment; the predecessor to this product's receipts |

> **Design consequence:** Zakat and zakat-eligible assets carry distribution
> rules that differ from ordinary expenditure. The fund *type* distinction
> matters for reporting, and v1 preserves it. Eligibility rules beyond
> "restricted to zakat purposes" are a later milestone, not a v1 requirement.

## Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Scope creep past a working core | High | Ship M0–M2 first. A working, accurate single-org tool beats a broad broken one |
| Rebuild effort underestimated | High | Decide recover-vs-rebuild in M0 before committing to a date |
| Multi-tenancy retrofitted late | Critical | Never build past M2 on a single-org schema — retrofitting an `orgId` column is miserable |
| Trust in the numbers | Critical | Ledger and reconciliation ship in M2, before any member-facing feature |
| Sensitive personal data | Medium | Retention policy, export and delete, encryption at rest, least-privilege roles |
| Destructive operations | Medium | Delete `/api/admin/reset`; typed confirmation; no hard deletes of financial records |
| Uptime expectations in communities | Medium | Offline-tolerant collection, retry-safe webhooks, clear degraded state |

## Definition of done

CommunityFund is a finished product when all of the following are true:

1. **It works.** Every screen loads real data from a real backend; the 23
   recovered endpoints have real equivalents; authentication is real
   authentication.
2. **The money is provable.** Balances are derived from an immutable ledger and
   reconcile against bank statements, with a screen that shows the difference.
3. **A member is self-sufficient.** They can see what they owe, pay it, and
   download a receipt without asking a human.
4. **The money actually gets chased.** Reminders send on schedule and unpaid
   contributions are followed up.
5. **More than one community uses it,** with provable isolation between
   organizations.
6. **A treasurer can hand over the role** and trust that the audit log explains
   everything that happened.
7. **Offline collection is first class.** Cash at a meeting with bad signal is
   recorded reliably and synced.
8. **It can be operated.** Backups exist and a restore has been tested, errors
   are monitored, and there is documentation for the next maintainer.

Items 1 and 2 are the gates. Everything else is degree.

## Related

- [Technical recovery notes](RECOVERY.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
