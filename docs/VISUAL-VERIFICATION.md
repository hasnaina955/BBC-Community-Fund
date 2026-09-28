# Visual verification

`bun run visual` drives a real browser through every screen, cross-checks the
numbers on screen against the read model that produced them, and asserts the
`collectionMode` rules. Screenshots and a pass/fail report land in `.visual/`
(gitignored). It needs the preview running (`freebuff-preview start`) and a
seeded deployment.

The latest pass was run on 28 September 2026 against 10,051 ledger entries
spanning 2018–2026: **232 checks, all passing.** Two defects that made *every*
screen blank were found this way; neither was visible to `bun run check`,
`bun run smoke` or `bun run measure`, all of which speak HTTP and never render a
pixel.

## What it checks, and why each thing is checked

| Area | Assertion |
| --- | --- |
| Every route | Renders real content, no `console.error`, no `pageerror`, no failed request, no HTTP ≥ 400, and never the error boundary. |
| Both origins | The whole pass runs a second time against the preview's public URL, because a loopback backend is reachable from `127.0.0.1` and from nowhere else, and an in-sandbox browser cannot tell the difference. |
| Every headline figure | The money on screen equals the paise the server sent — banks, funds, grid, reports, member passbooks. |
| `collectionMode` | Arrears, dues and the grid for `fixed_monthly` only; pledged-vs-received for `pledge_based`; no debt language near the Friday fund. |
| `skip` paths | A search matching no account runs no passbook query; the members screen runs none until a dialog opens, one when it opens, and releases it on close. |
| Roles | A viewer can read every screen, is refused `/users` and `/settings` in the UI, and is offered no control that could only fail. |
| Error paths | A malformed fund id, a deactivated account, an unknown URL, `/auth` while signed in. |
| Money, written live | The collection desk opens a session, records cash and cheque against it, and the running total, the receipt number and the member's balance all follow. |

The `skip` assertions are direct rather than inferred. Convex records a query
subscription as an `Add` in a `ModifyQuerySet` message and releases it with a
`Remove`; the driver wraps `WebSocket.prototype.send` and counts them, so
"the query was skipped" is observed rather than assumed from what happens to be
visible.

---

## M2d — reconciliation and close

The reconciliation screen is the first one that **writes** and then has to keep
the server's numbers and the screen's numbers in agreement, so it was exercised
as a workflow rather than a route sweep. Three real defects surfaced, and all
three were only findable by doing the workflow.

### 10. "Latest statement" ignored the filing time, so a correction never took effect

`status` and `history` ordered reconciliations by `statementDate` alone. The most
common correction a treasurer makes is re-reading a statement they mistyped, and
that produces a **second row for the same date** — so the two rows tied, the
order fell out of the index rather than the intent, and the summary card kept
showing the figure that had just been corrected. Filing a statement 500 rupees
higher produced `difference=0` on screen while the server had stored 500.

Ordering now falls back to `createdAt` when the dates tie (`newestFirst` in
`convex/reconciliation.ts`). The later filing is what the screen shows; the
earlier one stays in the history as the record of what was first claimed, which is
the behaviour an auditor wants.

### 11. The control that unblocks closing the year could never render

The card offering to close off a difference tested `active.latest.resolvedAt ===
undefined`. The read model normalises an absent `resolvedAt` to `null` — so the
test was never true, the card never rendered, and the only thing standing between
the treasurer and a closed year was a button that did not exist. The suite did
not catch this because the *server* behaviour was correct throughout; only
driving the screen found that the UI could not express it.

This is the same class of bug as finding 6 (a viewer offered controls that could
only fail), and it is why the visual pass drives the workflow rather than
asserting on read models alone.

### 12. A resolved difference was still counted as outstanding

`outstandingCount` was computed from `differencePaise !== 0` and ignored
`resolvedAt`. Closing off a difference therefore left the screen reporting it as
open — the count did not move — and, worse, **the same field is what `closeYear`
consults**, so the year stayed blocked after the treasurer had done the work the
screen told them to do. Two symptoms, one cause.

`outstandingCount` now means "unexplained", and a resolved difference is counted
separately as `explainedCount` and badged differently. The three states —
agrees / explained / differs — are now distinct in the UI, because painting an
explained difference the same red as an open one left no way to tell which
account still needed attention.

### Also fixed along the way

- **`closeYear` only blocked on differences whose statement was dated in or
  before the year being closed.** A statement filed in September about a balance
  that does not match is an open question about the books *now*, and it was
  letting 2025 close over an unexplained difference. Any unexplained difference
  now blocks, whatever its date.
- **31 December was missing from every year-range ledger read.** The upper bound
  was `lte("YYYY-12-31")` and `effectiveDate` is an ISO string, so an entry at
  `2024-12-31T10:30:00.000Z` sorts *after* `2024-12-31` and was dropped. The
  seeder's spending never falls on the 31st, which is why it went unnoticed; a
  real year-end passbook does. All year ranges are now half-open
  (`entriesBetween` in `convex/lib/ledger.ts`).
- **`reconciliation:status` grew with usage.** It returned every statement ever
  filed for every account, on a screen that draws a recent table. It now carries
  the 12 most recent per account plus a `historyCount`, and says so on screen
  rather than truncating silently. Full history is still available per account
  through `reconciliation:history`. 4.2 kB.
- **The visual and security suites are now re-runnable.** Both write (they file
  statements and close a year), and a run that failed partway used to leave state
  that made the *next* run fail for the wrong reason. Both assert against deltas
  from the state they found, and both restore the close watermark before exiting.
  `bun run check` was run twice in succession to confirm.

### Checks added

`bun run check` grew from 24 to 44 assertions, all behavioural: a viewer cannot
file a statement; a statement dated in the future is refused; a balance with paise
in it is refused rather than rounded; a matching statement records a zero
difference; the ledger figure is derived server-side; an unexplained difference
blocks the close and a resolved one does not; closing stamps entries; a payment
dated inside a closed year is refused *and the refusal names the year*; an
opening balance cannot be posted onto a fund that already has entries; and the
balance invariant still holds after all of it.

`bun run visual` gained two groups — `reconciliation — filing a statement` (28
checks) and `reports — ageing by days past due` (10) — plus viewer-role coverage
of the new screen.

### One check that was wrong, deliberately removed

I first asserted that the oldest ageing bucket holds the most money. It is not an
invariant: a community can owe more in the last month than it has owed for years,
and that is a true and useful fact. The assertion is gone with a comment saying
why, so the next person does not add it back. I also briefly asserted that the
bucket month-counts sum to the total across `worst`, which cannot hold because
`worst` is capped at the top 5; that is replaced by per-bucket invariants that
are actually true.

---

## M4a — the collection desk

`/collection` is the first console screen whose job is *entering* money rather
than reading it, so it is asserted as a workflow with the same seriousness as
reconciliation: open a session, record a cash receipt, record a cheque receipt,
and check that every number the treasurer would read afterwards is the server's
number — the running total, the receipt number, the member's balance, the
session's own tally, and the receipt that gets printed.

### The defect it found before the first assertion ran

The first draft put a `<Badge>` inside a `<p>` on the session card. `Badge`
renders a `<div>`, and a `<div>` inside a `<p>` is invalid HTML nesting — the
browser closes the `<p>` early and the rest of the card ends up outside the
paragraph it was written in. It is invisible in a screenshot at a glance and it
is exactly the kind of thing only a real render catches, which is the argument
for this suite existing at all.

### What the group asserts

Eleven checks, and they are about the two things the desk promises: that a
session is a container that starts at zero, and that what it shows is the
server's number.

- The screen says plainly that online collection is not available, and **offers
  no pay button that would fail** — the desk is honest about M4b not existing
  yet rather than a disabled control pretending otherwise.
- A fund that can hold a session exists to test with.
- A session can be opened and appears in the list.
- A new session starts at zero, not at the organisation's other money.
- The new session opens and offers to record money into it.
- Recording money issues a receipt number immediately.
- The session total is exactly what was recorded.
- The receipt is attributed to the member who was picked.
- The method breakdown names cash, which is what it was recorded as.
- The desk produced no runtime errors.

Two things the desk needs are **not** asserted here, and are asserted in
`bun run check` instead, where they are cheaper and stricter: that two payments
recorded back to back get **different** receipt numbers (the `count + 1` defect —
a visual check would only see one payment at a time), and that replaying an
idempotency key returns the payment it already wrote rather than creating a
second one. The visual suite's job is the part only a rendered page can prove.

---

## Surviving a killed browser

Chromium's renderers in this sandbox are killed by the OOM killer. The first
explanation offered for it — `/dev/shm` at 64 MB — was **wrong**, and the
correction matters because the wrong explanation produces a fix that does
nothing. With `--disable-dev-shm-usage` already set, `/dev/shm` sat at 0% while
crashes continued.

The measured cause: memory, and the budget is smaller than it looks. The
**2 GB cgroup limit** (`/sys/fs/cgroup/memory.max = 2147483648`) is shared by the
Convex backend, Vite, the Convex CLI, esbuild, the IDE server and Chromium, and
`/sys/fs/cgroup/memory.events` records `oom_kill` against it. Chromium alone is
**472 MB** after sign-in and walks past **790 MB** by the twelfth screen without
releasing; full-page screenshots add spikes on top. So
`scripts/visual-check.mjs` now treats a dead renderer as an expected event and
**closes and relaunches the whole browser** on any crash, capped at three
revivals.

Recovering only *after* a crash is a losing trade, because the kill has to happen
first. So the suite also recycles **proactively**: every four groups — or sooner
if Chromium is over 500 MB — it rebuilds the browser, and says so on a dimmed
line that is explicitly not a failure. The rebuild is performed inside `guard()`,
the one place every browser call already passes through, and *before* the call is
issued, so the call lands on the rebuilt page. Doing it in `group()` looked
equivalent and raced twice: the group's opening navigation went out while the
browser it addressed was being closed, which reports `Target page, context or
browser has been closed` and is indistinguishable from a product fault.

Two Chromium flags were measured and are kept. Most make no difference at all
(`--disable-gpu`, `--renderer-process-limit`, the extension/networking/feature
switches: 610 MB → 608 MB), so they are not claimed as a fix.
`--js-flags=--max-old-space-size=192` does help — 749 MB → 694 MB over a heavy
pass — and 128 was not better, so 192 is what is set. The suite is now stable
with no `oom_kill` at all across full runs.

**The other half of the budget was the Convex backend**, at 871 MB. Its local
SQLite store had grown to **425 MB**, because every reset leaves MVCC garbage
behind that a reset does not reclaim. Deleting the store file and restarting the
backend took it from 442 MB to 19 MB; the environment variables and demo data are
restored from the capture and re-seeded, which is why `bun run seed:reset` warns
when the store passes 375 MB.

What the recovery took to get right, and what each mistake was:

- **`isGone()` was missing `Page crashed`.** A screenshot reports `Target
  crashed`; a *navigation* reports `Page crashed`. Only the first was recognised,
  so a crash during `goto` unwound the entire suite instead of recovering.
- **The wording is a race, so matching Playwright's phrasing is not enough.** A
  `goto` issued *after* the renderer is killed says `Page crashed`; one already
  in flight when the kill lands reports Chromium's own `net::ERR_ABORTED`
  instead, or `net::ERR_CONNECTION_CLOSED` / `net::ERR_EMPTY_RESPONSE` if the
  socket went with it. Same event, different string, and the suite unwound on it
  until the list included the `net::ERR_*` half. `net::ERR_CONNECTION_REFUSED` is
  in the list too: refused means the dev server is unreachable, not that the
  product is wrong, and a real outage costs the retries and then surfaces the
  original error, because the last attempt is allowed through.
- **The retry ran against the dead page.** The guard that decides whether a
  handle is still usable received a *thunk* rather than the object, so after a
  rebuild the retry re-issued against the dead handle and failed identically
  three times. The same bug appeared a second time in `guardObject`, where
  `page.keyboard.press("Escape")` resolved to `rawPage.press(...)` because the
  page-level case passed `() => rawPage` instead of `() => rawPage[prop]`.
- **The rebuild marked its own fresh session dead.** The `close` handler fired on
  the browser the rebuild had closed *on purpose*, so the newly built session was
  immediately considered gone — an infinite recovery loop, which looks like a
  hang rather than a bug.
- **A group that cannot finish now stops deliberately.** `SuiteAborted` +
  `bailOut()` write the partial report and exit non-zero, instead of producing a
  `TypeError` on `outstanding.length` from a helper that returned `undefined`.
  A clean stack trace was masking the actual failure.
- **The abort path never wrote the report it exists to write.** `bailOut()` fired
  `writePartialReport()` without awaiting it and then called `process.exit(1)`,
  and the `uncaughtException` handler did not await `bailOut()` either. The
  promise never settled: `report.md` was left truncated to zero bytes and
  `report.json` was never created, so an aborted run produced no evidence at all
  and the next run's full report overwrote whatever had been flushed. Both now
  await.
- **A failure after a recovery is marked `suspect`, and the run still fails.**
  A rebuilt page is not a clean slate, so `check()` prints `FAIL?` rather than
  `FAIL` and the exit code stays non-zero. Reporting a recovery as a pass is the
  failure mode worth avoiding.

`bun run visual:recovery` (`scripts/prove-recovery.mjs`) proves this rather than
asserting it. It runs the real suite in a child process, `SIGKILL`s every
Chromium renderer at a chosen point, and requires two different outcomes:

| Kill point | Required outcome |
| --- | --- |
| Between groups | Full recovery — at least 200 checks pass, exit 0 |
| Mid-group, then repeatedly | Deliberate abort with a written report — no stack trace |

Both pass. The between-groups run recovers, logs 1 recovery note, and finishes
232 passed / 0 failed against a browser that was killed mid-flight. The mid-group
run refuses to pretend: it stops after three rebuilds in a row, and both
`report.md` and `report.json` name the group it abandoned.

The second scenario **keeps** killing rather than killing once, and that is a
change of premise, not a tightening. Once `isGone` recognises the navigation
wording, a single kill is survivable anywhere in the suite: every group
re-establishes the state its next check needs, so the mid-group run completes all
232. That is the behaviour the recovery was built to reach — but it means "a
crash the suite cannot absorb" can no longer be provoked by one kill. A browser
that dies three times in a row still can, and that is what the scenario now
exercises.

Requiring `MAX_REVIVES` to end in a report rather than a stack trace is a change
to the suite too. `retryThrough` used to re-issue the call once more after the cap
and let whatever came back escape — a raw `page.goto` error unwinding the run and
discarding every check that had already passed. It now throws `SuiteAborted`, so
exhausting the revives ends the run the same deliberate way an unfinishable group
does.

---

## Defects found, and what was done about them

### 1. Every screen was blank — React Router refused the route table

`src/App.tsx` put the screens under a `path="*"` parent with absolute children
(`/funds`, `/banks`, …). React Router 6 throws
`Absolute route path "/" nested under path "*" is not valid` during render, so
the entire console — sign-in form included — never painted. Every route returned
HTTP 200, which is why the route-status check passed and the app was still
unusable.

*Fixed:* the shell is a layout route at `/` with an `index` route and relative
children. A `*` child now renders a 404 rather than a blank page.

### 2. `useQueries` re-subscribed on every render

`DataProvider` passed an object literal to `useQueries`. That hook keys its
subscription on the *identity* of its argument, so each render built a new
subscription that re-fired its callback and rendered again — React's "Too many
re-renders" loop, which unmounted the app before a frame was drawn.

*Fixed:* the query set is a module-level constant.

These two are why the pass was worth running. Both were invisible to every
existing check, because all of them test the API and none of them test the DOM.

### 3. The app was unreachable from any browser but this sandbox's

Found immediately afterwards, by pointing the same driver at the preview's
public URL instead of `127.0.0.1:5173`. `VITE_CONVEX_URL` pointed at
`http://127.0.0.1:3210`, a loopback address, so a page served from any other
origin could not reach the backend: Chrome refused it under its local-network
access checks (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). The symptom was the
app hanging on the sign-in button indefinitely — `signIn()` waits on a client
whose socket never connects, and nothing errors, because nothing failed; it
simply never started.

The first 164-check pass missed this outright, because the driver ran an
in-sandbox browser on loopback, where the deployment is reachable by definition.
The fix is to make the browser's traffic same-origin: the Vite dev server proxies
`/__convex` to the backend with websockets enabled, and `src/lib/convex.tsx`
points the client there whenever the page itself is not on loopback. The prefix
is `__convex` rather than `convex` because the repository has a real `convex/`
directory that Vite serves as `/convex/_generated/api.js`; proxying that name
hands the app's own modules to the backend and blanks the page.

Both origins now pass all 232 checks.

### 4. A historical bank passbook showed the wrong year, and was slow

`aggregate:bankPassbook` range-selected `effectiveDate >= <year>-01-01` with no
upper bound, so asking for 2018 returned every entry from 2018 to today,
`slice(-40)`'d the *newest* 40, and labelled them "entries in 2018". Its opening
balance was derived as *all-time balance − everything since the chosen year*,
which is only the right answer for the current year: 2024 reported an opening of
₹16,66,700 against rows dated 2026, and 2018 reported ₹0. The 2018 read also took
**6.6 s**, because it scanned the whole ledger.

*Fixed* in two parts. The entry range is now bounded to the year, and the
opening balance is derived from a new materialised `balances` scope,
`bank_year:<bankId>:<year>`, holding that account's net movement *in* that year.
A movement total is safe to materialise where a per-year balance would not be:
an entry only ever moves the year it is dated in, so a backdated entry does not
invalidate every later year, and the write path stays O(1). Closing for a year is
today's balance minus the movement of all later years — a handful of rows
instead of thousands of entries.

Result on the same data: **2018 went from 6,614 ms to 102 ms** (65×), 2024 from
823 ms to 218 ms, and every passbook now shows only its own year. The 27 new
rows were derived, not typed: `bun run balances:backfill` runs the same
`balances:recompute` path as every other scope, and `balances:verify` now checks
120 scopes instead of 93.

### 5. A completed year was reported as year-to-date

`aggregate:reports` filtered its headline to `month <= MONTHS_ELAPSED` for every
year, not just the current one. The 2024 report headlined **₹69,700** while the
collection-efficiency chart directly beside it, over the same dues, totalled
**₹93,300** — October to December simply missing. The Contributions grid showed
the correct figure for the same year and fund, so the two screens disagreed.

*Fixed:* the month-to-date cut-off now applies to the current year only. The
driver asserts that a completed year's headline equals the sum of its own
efficiency buckets.

### 6. A viewer was offered buttons that could only fail

Every mutation in the app was called as `void somePromise(...)`, so a rejected
write produced no message, no error and no change. A viewer was shown all 711
clickable cells on the collection grid and all 8 Approve/Reject buttons in the
approvals queue; clicking either did nothing at all, because the server refuses
both. The same applied to "Add fund" and to the error surface generally — no
write anywhere in the app reported its own failure.

*Fixed:* `src/lib/types.ts` now mirrors the server's role ranking, and the
screens use it to hide controls the signed-in role cannot use, to say why
("View only"), and to surface the server's message when a write does fail. The
server remains the only enforcement point.

### 7. Smaller ones

- **The banks search box unmounted when it matched nothing.** It lived inside the
  results branch, so the one control that could undo the search disappeared the
  moment you needed it — recoverable only by reloading. Moved outside the branch.
- **"collected in total" was an all-time figure.** The reports card paired a
  year-scoped round count with the *lifetime* balance of every unscheduled fund.
  It now sums that year's credits into voluntary and donation funds, so the
  number answers the question the label asks.
- **Arrears figures implied the selected year.** Outstanding and ageing are
  genuinely all-time — a 2019 due is still outstanding — but the screen sat under
  a year picker and read as if it were the year's. Both now say "all years".
- **The sign-in page's demo-accounts sentence was truncated** mid-clause
  ("seeding the deployment, every account uses").

## Two empty states that cannot be reached from the UI

Both are guards, and both are recorded here rather than asserted, because a test
that cannot fail is not a test.

- **"No grid for this fund"** (`src/routes/contributions.tsx`) is unreachable in
  the seeded organisation: the fund picker filters to `fixed_monthly`, so it can
  only be reached through the "Default monthly fund" option when no
  `fixed_monthly` fund exists at all. The server branch it guards **is** asserted
  directly, per fund, for all five non-`fixed_monthly` funds, with the exact
  `reason` string the screen would render.
- **"That fund does not exist"** (`src/routes/fund-detail.tsx`) guards a *valid*
  `funds` id belonging to another organisation. `v.id("funds")` validates the
  whole id, not its shape: every mutation of a real id, and every plausible
  synthetic id, is rejected by the validator before the handler runs. With one
  organisation seeded there is no way to produce the case. What the screen *does*
  meet in practice — a bad id in the URL — is asserted, and is caught by the error
  boundary with the sidebar intact.

## `visual:ui` — the phone, and the palette

`bun run visual:ui` (30 assertions) is a third, separate suite. The other two
drive a desktop viewport, which is precisely why a console with **no navigation
at all below the `lg` breakpoint** could pass 232 console assertions, 71 portal
assertions, 34 smoke checks and 88 security checks. The sidebar is
`hidden lg:flex`; the phone header carried the logo, the theme toggle and a
sign-out button. A treasurer on a phone could open the app, see the dashboard,
and reach none of the other twelve routes. Nothing failed, because the app was
working exactly as it had been built.

It also checks the theme in both applications, and measures contrast from the
computed style in both themes rather than asserting it by hand.

### Three findings

1. **The portal's theme toggle never persisted.** `useTheme` existed twice — once
   in each shell — and the portal's copy set the class but never wrote
   `localStorage`, so a member who chose dark mode and reloaded got light mode
   back. The console's copy *did* persist, so nothing looked wrong: a member is
   never shown the console, which means the working half of the pair is exactly
   the half they never load. One hook in `src/lib/theme.ts` now serves both.

2. **The console had no navigation on a phone.** A drawer built on the Radix
   dialog, so it gets the focus trap, Escape, and the scroll lock. The regression
   is held by a 390×844 pass that opens the drawer, follows a link, and checks
   the drawer closed itself.

3. **The palette was unreadable in ways nothing else caught.** Every token was
   replaced, and the thing a token retune breaks silently is text contrast —
   nothing crashes, a treasurer simply cannot read the screen. Both suites now
   assert measured ratios for the primary button, body and muted text, the
   sidebar, the stat tiles, the meter fill and the card edge, in both themes.

   Two of those assertions failed on first run, and both failures were in the
   *probe*, not the product: it compared a meter's inherited text colour against
   its fill, and it looked for `.text-success` in the live DOM when that class
   only renders on a branch the seed data never takes. Both are fixed, and the
   distinction is documented in the script because "no spinner in `main`" and
   "text on its own background" are the kind of thing that gets re-broken by
   someone tidying.

### What was measured, not assumed

Every number in the contrast group is read from `getComputedStyle` in the
browser, so it tests the cascade as shipped. The current worst case is the
muted text in light mode at **4.93:1** against a 4.5:1 requirement, and the
card edge in dark mode at **1.29:1** against a 1.25:1 requirement. Both pass,
neither has a lot of headroom, and both are the first things to break if a token
is edited.

## Not fixed, on purpose

The collection-efficiency denominator counts dues raised for members who have
since been made inactive, while the Contributions grid counts only active
members. The two screens therefore differ by ~₹5,900 for 2024. Both are
defensible readings of "what was collected in 2024"; changing either would alter
a published number, so it is left as a decision for the committee rather than
made silently during a verification pass.
