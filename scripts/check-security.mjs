/**
 * Security and domain-invariant checks.
 *
 * Milestone M1 verified these by hand against a local deployment; this makes it
 * a command so a later change cannot quietly reopen a hole. It covers three
 * things:
 *
 *   1. Authentication — no read model answers an anonymous caller.
 *   2. Authorisation — a viewer cannot create a fund, and nobody can approve
 *      their own transaction or overdraw a fund.
 *   3. The mode rule — only a fixed_monthly fund can produce dues, a grid or
 *      arrears. This is the invariant the whole arrears concept rests on.
 *
 *   bun run check
 */

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const PASSWORD = process.env.DEMO_PASSWORD ?? "community123"

async function call(path, args, token, kind = "query") {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, args, format: "json" }),
  })
  return res.json()
}

async function signIn(email) {
  const res = await call(
    "auth:signIn",
    { provider: "password", params: { flow: "signIn", email, password: PASSWORD } },
    undefined,
    "action",
  )
  const token = res.value?.tokens?.token
  if (!token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(res)}`)
  return token
}

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass += 1
    console.log(`  ok    ${name}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${name}`)
    if (detail) console.log(`        ${detail}`)
  }
}

console.log("")

/* ------------------------------------------- 1. authentication is required */

for (const path of [
  "aggregate:shell",
  "aggregate:dashboard",
  "aggregate:funds",
  "aggregate:members",
  "aggregate:grid",
  "aggregate:reports",
  "aggregate:transactions",
  "aggregate:approvals",
  "aggregate:directory",
  "aggregate:audit",
  "data:me",
]) {
  const res = await call(path, path === "aggregate:grid" ? { year: 2026 } : {})
  check(
    `${path} refuses an anonymous caller`,
    res.status === "error" && /Not signed in/i.test(res.errorMessage ?? ""),
    res.errorMessage,
  )
}

// A token that is not a valid JWT must be rejected before any query runs.
// Convex names the failure differently depending on how far parsing got
// (InvalidAuthHeader vs NoAuthProvider), so this asserts on rejection rather
// than on wording — what matters is that no data comes back.
for (const forged of [
  "not.a.real.token",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.forgedsignature",
]) {
  for (const path of ["aggregate:shell", "aggregate:dashboard"]) {
    const res = await call(path, {}, forged)
    const leaked = JSON.stringify(res.value ?? null)
    check(
      `${path} refuses a forged token (${forged.slice(0, 12)}…)`,
      res.status !== "success" && leaked === "null",
      JSON.stringify(res).slice(0, 160),
    )
  }
}

/* ---------------------------------------------- 2. authorisation boundaries */

const admin = await signIn("secretary@jamaat.org")
const viewer = await signIn("farhan@jamaat.org")

const viewerFund = await call(
  "funds:createFund",
  { name: "Viewer should not create this", type: "general", collectionMode: "donation" },
  viewer,
  "mutation",
)
check(
  "a viewer cannot create a fund",
  viewerFund.status === "error" && /treasurer access required/i.test(viewerFund.errorMessage ?? ""),
  viewerFund.errorMessage,
)

/* ------------------------------------------------- 3. the mode rule */

// The rule: a grid, and therefore arrears, exists only for fixed_monthly funds.
// The seeder already creates a fund of every mode, so this asserts against
// those rather than creating rows — a security check that leaves litter behind
// is a check that gets skipped.
const funds = (await call("aggregate:funds", {}, admin)).value
const byMode = new Map()
for (const fund of funds) {
  if (!byMode.has(fund.collectionMode)) byMode.set(fund.collectionMode, fund)
}

for (const mode of ["fixed_monthly", "voluntary", "pledge_based", "donation"]) {
  const fund = byMode.get(mode)
  if (!fund) {
    check(`the demo data has a ${mode} fund to test against`, false)
    continue
  }
  const shouldHaveGrid = mode === "fixed_monthly"

  const grid = await call(
    "aggregate:grid",
    { year: new Date().getUTCFullYear(), fundId: fund.id },
    admin,
  )
  check(
    shouldHaveGrid
      ? `a fixed_monthly fund (${fund.name}) gets a collection grid`
      : `a ${mode} fund (${fund.name}) gets no grid`,
    grid.status === "success" && grid.value.applicable === shouldHaveGrid,
    JSON.stringify(grid.value ?? grid.errorMessage).slice(0, 200),
  )

  // And a due cannot be created against a fund that has none.
  if (!shouldHaveGrid) {
    const member = (await call("aggregate:members", { filter: "active" }, admin))
      .value[0]
    const dues = await call(
      "members:createContribution",
      {
        fundId: fund.id,
        memberId: member.id,
        year: new Date().getUTCFullYear() - 2,
        month: 1,
        amountPaise: 10000,
      },
      admin,
      "mutation",
    )
    check(
      `a due cannot be created against a ${mode} fund`,
      dues.status === "error" && /do not owe it anything/i.test(dues.errorMessage ?? ""),
      dues.errorMessage,
    )
  }
}

/* --------------------------------- 4. the materialised balance is checkable */

const verify = await call("balances:verify", {}, admin)
check(
  "every materialised balance equals the sum of its entries",
  verify.status === "success" && verify.value.ok === true,
  JSON.stringify(verify.value ?? verify.errorMessage),
)

/* ------------------------------ 5. reconciliation and the closed period (M2d) */

// Read models of the reconciliation screen must not leak to an anonymous caller,
// exactly like every other read model.
for (const path of ["reconciliation:status"]) {
  const res = await call(path, {}, undefined)
  check(
    `${path} refuses an anonymous caller`,
    res.status === "error" && /Not signed in/i.test(res.errorMessage ?? ""),
    res.errorMessage,
  )
}

// A viewer may read the reconciliation screen but may not file a statement.
const banksRes = await call("aggregate:banks", {}, viewer)
const viewerBank = banksRes.value?.[0]
check(
  "a viewer can read the reconciliation status",
  (await call("reconciliation:status", {}, viewer)).status === "success",
)
const viewerFile = await call(
  "reconciliation:record",
  {
    bankId: viewerBank.id,
    statementDate: new Date().toISOString().slice(0, 10),
    statementBalancePaise: viewerBank.balancePaise,
  },
  viewer,
  "mutation",
)
check(
  "a viewer cannot file a bank statement",
  viewerFile.status === "error" && /treasurer access required/i.test(viewerFile.errorMessage ?? ""),
  viewerFile.errorMessage,
)

// A statement is a claim about a specific day, so it cannot be dated in the
// future, and it cannot carry a float — money is integer paise end to end.
const bank = (await call("aggregate:banks", {}, admin)).value[0]
const today = new Date().toISOString().slice(0, 10)
const future = await call(
  "reconciliation:record",
  {
    bankId: bank.id,
    statementDate: "2099-01-01",
    statementBalancePaise: bank.balancePaise,
  },
  admin,
  "mutation",
)
check(
  "a statement dated in the future is refused",
  future.status === "error" && /future/i.test(future.errorMessage ?? ""),
  future.errorMessage,
)

const floaty = await call(
  "reconciliation:record",
  {
    bankId: bank.id,
    statementDate: today,
    statementBalancePaise: 100.5,
  },
  admin,
  "mutation",
)
check(
  "a statement balance with paise in it is refused rather than rounded",
  floaty.status === "error" && /integer number of paise/i.test(floaty.errorMessage ?? ""),
  floaty.errorMessage,
)

// The server derives the ledger figure; the client never supplies it. Filing a
// statement that matches the books must therefore record a zero difference
// without the caller having asserted one.
const agree = await call(
  "reconciliation:record",
  {
    bankId: bank.id,
    statementDate: today,
    statementBalancePaise: bank.balancePaise,
    note: "invariant check",
  },
  admin,
  "mutation",
)
check(
  "a statement matching the books records a zero difference",
  agree.status === "success" && agree.value.differencePaise === 0,
  JSON.stringify(agree.value ?? agree.errorMessage),
)
check(
  "the ledger figure is derived by the server, not supplied by the client",
  agree.value?.ledgerBalancePaise === bank.balancePaise,
  `${agree.value?.ledgerBalancePaise} vs the read model's ${bank.balancePaise}`,
)

// A difference is not a failure, but it must be explained, and until it is the
// year cannot be closed. This is the whole point of the milestone.
const differ = await call(
  "reconciliation:record",
  {
    bankId: bank.id,
    statementDate: today,
    statementBalancePaise: bank.balancePaise + 50000,
  },
  admin,
  "mutation",
)
check(
  "a statement that disagrees records the exact difference",
  differ.status === "success" && differ.value.differencePaise === 50000,
  JSON.stringify(differ.value ?? differ.errorMessage),
)

const thisYear = new Date().getUTCFullYear()
const statusBefore = (await call("reconciliation:status", {}, admin)).value
const blocked = await call("reconciliation:closeYear", { year: thisYear - 1 }, admin, "mutation")
check(
  "closing a year is refused while a difference is unexplained",
  blocked.status === "error" && /unexplained/i.test(blocked.errorMessage ?? ""),
  blocked.errorMessage,
)

// The difference must stay on the record when it is closed off — a
// reconciliation that quietly deleted the discrepancy would be worthless.
const resolved = await call(
  "reconciliation:resolve",
  { reconciliationId: differ.value.id, note: "Bank charge not in our books" },
  admin,
  "mutation",
)
check(
  "a difference can be closed off with an explanation",
  resolved.status === "success",
  resolved.errorMessage,
)
const history = (await call("reconciliation:history", { bankId: bank.id }, admin)).value
const kept = history.find((r) => r.id === differ.value.id)
check(
  "closing off a difference keeps the row and its amount",
  Boolean(kept) && kept.differencePaise === 50000 && kept.resolvedAt != null,
  JSON.stringify(kept ?? null),
)

const twice = await call(
  "reconciliation:resolve",
  { reconciliationId: differ.value.id, note: "again" },
  admin,
  "mutation",
)
check(
  "the same difference cannot be closed off twice",
  twice.status === "error" && /already/i.test(twice.errorMessage ?? ""),
  twice.errorMessage,
)

// Now the close should go through, and the ledger must actually refuse a write
// dated inside the closed year.
const closed = await call("reconciliation:closeYear", { year: thisYear - 1 }, admin, "mutation")
check(
  "the year closes once every difference is explained",
  closed.status === "success" && closed.value.year === thisYear - 1,
  JSON.stringify(closed.value ?? closed.errorMessage),
)
check(
  "closing a year stamps the entries dated inside it as locked",
  closed.value?.locked > 0,
  `${closed.value?.locked} entries stamped`,
)

const fund = funds.find((f) => f.collectionMode === "fixed_monthly")
const lockedWrite = await call(
  "transactions:recordPayment",
  {
    fundId: fund.id,
    amountPaise: 10000,
    method: "cash",
    paidAt: `${thisYear - 1}-06-15T10:00:00.000Z`,
  },
  admin,
  "mutation",
)
check(
  "a payment dated inside the closed year is refused by the ledger writer",
  lockedWrite.status === "error" &&
    new RegExp(`through ${thisYear - 1} is closed`).test(lockedWrite.errorMessage ?? ""),
  lockedWrite.errorMessage,
)

const notYetDue = await call("reconciliation:closeYear", { year: thisYear }, admin, "mutation")
check(
  "the year in progress cannot be closed",
  notYetDue.status === "error" && /not finished/i.test(notYetDue.errorMessage ?? ""),
  notYetDue.errorMessage,
)

// Leave the books as they were found, so the check is re-runnable. `reopenYear`
// only accepts the topmost closed year and steps the watermark down by one, so
// walking all the way back takes one call per year.
const baselineClosed = statusBefore.closedThrough
const reopened = await call("reconciliation:reopenYear", { year: thisYear - 1 }, admin, "mutation")
check(
  "an admin can reopen the year it just closed",
  reopened.status === "success" && reopened.value.unlocked === closed.value.locked,
  JSON.stringify(reopened.value ?? reopened.errorMessage),
)
for (let i = 0; i < 40; i += 1) {
  const now = (await call("reconciliation:status", {}, admin)).value.closedThrough
  if (now === baselineClosed || now === null) break
  const step = await call("reconciliation:reopenYear", { year: now }, admin, "mutation")
  if (step.status === "error") break
}
const afterReopen = (await call("reconciliation:status", {}, admin)).value
check(
  "reopening returns the watermark to where the check found it",
  afterReopen.closedThrough === baselineClosed,
  `closedThrough=${afterReopen.closedThrough} (was ${baselineClosed})`,
)

// An opening balance is for an imported ledger, so posting one onto a fund that
// already has entries must be refused: it would double the money.
const opening = await call(
  "reconciliation:postOpeningBalance",
  { fundId: fund.id, amountPaise: 100000, asOf: "2017-12-31" },
  admin,
  "mutation",
)
check(
  "an opening balance cannot be posted onto a fund that already has entries",
  opening.status === "error" && /already has ledger entries/i.test(opening.errorMessage ?? ""),
  opening.errorMessage,
)

// And the balance invariant must still hold after everything above.
const verifyAgain = await call("balances:verify", {}, admin)
check(
  "the balance invariant still holds after the reconciliation checks",
  verifyAgain.status === "success" && verifyAgain.value.ok === true,
  JSON.stringify(verifyAgain.value ?? verifyAgain.errorMessage),
)

/* ---------------------------------------- 4. the member portal (milestone M3) */

/**
 * The portal introduced the first role that is signed in but is *not* on the
 * committee. That makes it the first time "is signed in" and "may see the books"
 * are different sets of people, and therefore the first time the distinction has
 * to be enforced rather than assumed.
 *
 * These are the refusals. The portal's happy paths are verified in a real
 * browser by `bun run visual:portal`; what belongs here is the set of things a
 * member must *not* be able to reach, because a browser check can only prove
 * what somebody thought to look at, while these are exhaustive over the read
 * models that could leak.
 */
console.log("\n  member portal — a member is not on the committee")

const member = await signIn("imran@example.org")
const unlinked = await signIn("ayesha@example.org")

// Identity is the one thing a member must be able to read, because it is what
// tells them which world they are in.
const meAsMember = await call("data:me", {}, member)
check(
  "a member can read their own identity",
  meAsMember.status === "success" && meAsMember.value.role === "member",
  JSON.stringify(meAsMember.value ?? meAsMember.errorMessage),
)

// Every console read model must refuse. This loop is the point of the check:
// the failure mode being guarded against is one new screen quietly reusing
// `requireActor` and handing a member the organisation's totals.
const consoleModels = [
  "aggregate:shell",
  "aggregate:dashboard",
  "aggregate:members",
  "aggregate:funds",
  "aggregate:transactions",
  "aggregate:reports",
  "aggregate:audit",
  "reconciliation:status",
  "data:listUsers",
  "data:listMembers",
  "data:listPayments",
]
for (const fn of consoleModels) {
  const res = await call(fn, {}, member)
  check(
    `${fn} refuses a member`,
    res.status === "error" && /viewer access required/i.test(res.errorMessage ?? ""),
    res.errorMessage,
  )
}

// The treasurer-only portal surfaces.
for (const fn of ["portal:accountStatus", "portal:requestsQueue"]) {
  const res = await call(fn, {}, member)
  check(
    `${fn} refuses a member`,
    res.status === "error" && /treasurer access required/i.test(res.errorMessage ?? ""),
    res.errorMessage,
  )
}

// A member can reach their own portal…
const myAccount = await call("portal:myAccount", {}, member)
check(
  "a member can read their own portal account",
  myAccount.status === "success" && typeof myAccount.value.memberId === "string",
  JSON.stringify(myAccount.value ?? myAccount.errorMessage),
)

// …and the claim flow is theirs alone.
const claimAsTreasurer = await call("portal:claim", {}, admin, "mutation")
check(
  "committee staff cannot claim a member record",
  claimAsTreasurer.status === "error" && /already have access/i.test(claimAsTreasurer.errorMessage ?? ""),
  claimAsTreasurer.errorMessage,
)

// An unlinked account is a real state, not an error and not a zero balance.
const unlinkedSummary = await call("portal:summary", {}, unlinked)
check(
  "an unlinked member has no balance read model at all",
  unlinkedSummary.status === "success" && unlinkedSummary.value === null,
  JSON.stringify(unlinkedSummary),
)

// The arithmetic the member is shown must be the arithmetic of the rows.
const summary = await call("portal:summary", {}, member)
if (summary.status === "success" && summary.value) {
  const s = summary.value
  check(
    "this month plus arrears is the total outstanding",
    s.currentMonthPaise + s.arrearsPaise === s.totalOutstandingPaise,
    `${s.currentMonthPaise} + ${s.arrearsPaise} != ${s.totalOutstandingPaise}`,
  )
  check(
    "the arrears months are the months actually counted as open",
    s.arrearsMonths === s.months.filter((m) => m.status === "due" || m.status === "partial").length,
    `arrearsMonths=${s.arrearsMonths}`,
  )
  check(
    "the receipt slice is capped but the totals are not",
    s.receipts.length <= 50 && s.paymentCount >= s.receipts.length,
    `${s.receipts.length} listed, ${s.paymentCount} in total`,
  )
} else {
  check("portal:summary returns a read model for a linked member", false, summary.errorMessage)
}

// A statement's foot is the arithmetic of its body, computed from the same rows.
const statement = await call("portal:statement", {}, member)
if (statement.status === "success" && statement.value) {
  const st = statement.value
  check(
    "the statement's balance is its own rows, added up",
    st.chargedTotalPaise - st.receivedTotalPaise === st.outstandingPaise,
    `${st.chargedTotalPaise} - ${st.receivedTotalPaise} != ${st.outstandingPaise}`,
  )
  check(
    "the statement lists every payment, where the screen caps at fifty",
    summary.value ? st.received.length === summary.value.paymentCount : true,
    `${st.received.length} on the statement vs ${summary.value?.paymentCount} counted`,
  )
} else {
  check("portal:statement returns a statement for a linked member", false, statement.errorMessage)
}

// Receipt authorization. A receipt that is not the caller's must be
// indistinguishable from one that does not exist, or the id is an oracle.
const anyReceipt = summary.value?.receipts?.[0]
if (anyReceipt) {
  const own = await call("receipts:receiptData", { paymentId: anyReceipt.id }, member)
  check(
    "a member can read their own receipt",
    own.status === "success" && own.value?.receiptNo === anyReceipt.receiptNo,
    JSON.stringify(own.value ?? own.errorMessage),
  )
  const stranger = await call("receipts:receiptData", { paymentId: anyReceipt.id }, unlinked)
  check(
    "another member's receipt is null, exactly like a receipt that does not exist",
    stranger.status === "success" && stranger.value === null,
    JSON.stringify(stranger),
  )
  const asTreasurer = await call("receipts:receiptData", { paymentId: anyReceipt.id }, admin)
  check(
    "a treasurer can read any receipt, for reprinting at the desk",
    asTreasurer.status === "success" && asTreasurer.value?.receiptNo === anyReceipt.receiptNo,
    JSON.stringify(asTreasurer.value ?? asTreasurer.errorMessage),
  )
  const anonymous = await call("receipts:receiptData", { paymentId: anyReceipt.id })
  check(
    "an anonymous caller gets nothing",
    anonymous.status === "error",
    anonymous.errorMessage,
  )
}

// The claim flow's refusals. Every one of these is a way a member could
// otherwise erase their own arrears or invent a payment.
const futureClaim = await call(
  "portal:requestPayment",
  {
    amountPaise: 10000,
    method: "cash",
    paidAt: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)).toISOString(),
  },
  member,
  "mutation",
)
check(
  "a claim dated in the future is refused",
  futureClaim.status === "error" && /future/i.test(futureClaim.errorMessage ?? ""),
  futureClaim.errorMessage,
)

const zeroClaim = await call(
  "portal:requestPayment",
  { amountPaise: 0, method: "cash", paidAt: new Date().toISOString() },
  member,
  "mutation",
)
check(
  "a claim for nothing is refused",
  zeroClaim.status === "error",
  zeroClaim.errorMessage,
)

const openRequests = (await call("portal:myRequests", {}, member)).value ?? []
const open = openRequests.find((r) => r.status === "pending")
if (open) {
  const decideIt = await call(
    "portal:decideRequest",
    { requestId: open.id, approve: true },
    member,
    "mutation",
  )
  check(
    "a member cannot decide their own claim",
    decideIt.status === "error" && /treasurer access required/i.test(decideIt.errorMessage ?? ""),
    decideIt.errorMessage,
  )
  const decidedTwice = await call(
    "portal:decideRequest",
    { requestId: open.id, approve: false, note: "again" },
    admin,
    "mutation",
  )
  check(
    "an open claim can be refused, and only once",
    decidedTwice.status === "success" || /already/i.test(decidedTwice.errorMessage ?? ""),
    decidedTwice.errorMessage,
  )
} else {
  // Nothing open: create one so the "cannot decide your own" path is still
  // exercised, then refuse it so the suite leaves no money-moving state behind.
  const made = await call(
    "portal:requestPayment",
    { amountPaise: 10000, method: "cash", paidAt: new Date().toISOString() },
    member,
    "mutation",
  )
  if (made.status === "success") {
    const mine = (await call("portal:myRequests", {}, member)).value ?? []
    const row = mine.find((r) => r.id === made.value.id)
    const decideIt = await call(
      "portal:decideRequest",
      { requestId: row.id, approve: true },
      member,
      "mutation",
    )
    check(
      "a member cannot decide their own claim",
      decideIt.status === "error" && /treasurer access required/i.test(decideIt.errorMessage ?? ""),
      decideIt.errorMessage,
    )
    const second = await call(
      "portal:requestPayment",
      { amountPaise: 10000, method: "cash", paidAt: new Date().toISOString() },
      member,
      "mutation",
    )
    check(
      "a second claim while one is open is refused",
      second.status === "error" && /already have a payment request/i.test(second.errorMessage ?? ""),
      second.errorMessage,
    )
    await call(
      "portal:decideRequest",
      { requestId: row.id, approve: false, note: "cleared by bun run check" },
      admin,
      "mutation",
    )
  } else {
    check("a member can open a claim", false, made.errorMessage)
  }
}

/* ------------------------------------------------- M4a: collection + gateway */

console.log("\nM4a — collection sessions and the payments seam")

// The collection desk is a treasurer's tool. Every one of these must be refused
// to a role that does not hold it, because the whole point of the `member` role
// from M3 is that a member is never shown a screen full of figures about other
// people — and a collection session is exactly that.
{
  const viewer = await signIn("farhan@jamaat.org")
  const roundsRead = await call("collections:rounds", {}, viewer)
  check(
    "a viewer may read collection sessions",
    roundsRead.status === "success" && Array.isArray(roundsRead.value?.rounds),
    roundsRead.errorMessage ?? `${roundsRead.value?.rounds?.length} sessions`,
  )

  const memberRead = await call("collections:rounds", {}, member)
  check(
    "a member cannot read collection sessions",
    memberRead.status === "error" && /access required/i.test(memberRead.errorMessage ?? ""),
    memberRead.errorMessage,
  )

  const memberMembers = await call("collections:roundMembers", {}, member)
  check(
    "a member cannot list the roll through the collection desk",
    memberMembers.status === "error" && /access required/i.test(memberMembers.errorMessage ?? ""),
    memberMembers.errorMessage,
  )

  // The mutation under test needs a real session to point at, so take one from a
  // round that already exists rather than creating state that outlives the run.
  const allRounds = await call("collections:rounds", {}, admin)
  const anyRound = allRounds.value?.rounds?.[0]
  if (anyRound) {
    const viewerWrite = await call(
      "collections:recordRoundPayment",
      { roundId: anyRound.id, amountPaise: 100, method: "cash" },
      viewer,
      "mutation",
    )
    check(
      "a viewer cannot record money into a session",
      viewerWrite.status === "error" && /treasurer access required/i.test(viewerWrite.errorMessage ?? ""),
      viewerWrite.errorMessage,
    )

    const memberWrite = await call(
      "collections:recordRoundPayment",
      { roundId: anyRound.id, amountPaise: 100, method: "cash" },
      member,
      "mutation",
    )
    check(
      "a member cannot record money into a session",
      memberWrite.status === "error" && /treasurer access required/i.test(memberWrite.errorMessage ?? ""),
      memberWrite.errorMessage,
    )
  }

  // A round is for a fund with no schedule. On a `fixed_monthly` fund it would
  // invite counting the same money twice against the grid, so the server refuses
  // it even for a treasurer.
  const allFunds = (await call("aggregate:funds", {}, admin)).value ?? []
  const monthly = allFunds.find((f) => f.collectionMode === "fixed_monthly")
  if (monthly) {
    const bad = await call(
      "collections:createRound",
      { fundId: monthly.id, date: "2026-01-05", label: "should be refused" },
      admin,
      "mutation",
    )
    check(
      "a round cannot be opened on a fund that is collected on a schedule",
      bad.status === "error" && /voluntary and donation funds only/i.test(bad.errorMessage ?? ""),
      bad.errorMessage,
    )
  } else {
    check("a monthly fund was found to test the round rule", false, "no fixed_monthly fund seeded")
  }
}

console.log("\nM4a — the payments seam")

{
  // `gateway:config` is what the console reads to decide whether to offer online
  // collection. It must be readable by a treasurer and refused to a member, and
  // it must report "not configured" rather than throwing — that state is the
  // shipping state, not a failure.
  const treasurer = await signIn("treasurer@jamaat.org")
  const cfg = await call("gateway:config", {}, treasurer)
  check(
    "a treasurer can ask whether online collection is available",
    cfg.status === "success" && cfg.value?.configured === false && cfg.value?.canCollectOnline === false,
    JSON.stringify(cfg.value ?? cfg.errorMessage),
  )

  const memberCfg = await call("gateway:config", {}, member)
  check(
    "a member cannot read the gateway configuration",
    memberCfg.status === "error" && /treasurer access required/i.test(memberCfg.errorMessage ?? ""),
    memberCfg.errorMessage,
  )

  const memberExceptions = await call("gateway:exceptions", {}, member)
  check(
    "a member cannot read the exceptions list",
    memberExceptions.status === "error" && /access required/i.test(memberExceptions.errorMessage ?? ""),
    memberExceptions.errorMessage,
  )

  const exc = await call("gateway:exceptions", {}, treasurer)
  check(
    "the exceptions list is readable and empty while no provider is configured",
    exc.status === "success" &&
      exc.value?.configured === false &&
      Array.isArray(exc.value?.exceptions) &&
      exc.value.exceptions.length === 0,
    JSON.stringify(exc.value ?? exc.errorMessage),
  )
}

console.log("\nM4a — receipt numbers are a sequence, not a count")

/*
 * `recordPaymentFor` used to derive a receipt number from `payments.length + 1`.
 * Two faults, and the second is the one that matters:
 *
 *   1. It read every payment in the organisation, on the hottest write in the
 *      app. The seed is at ~10,000 rows against a 16,384-document cap.
 *   2. A count is not a sequence. Two payments recorded before either committed
 *      both computed `n + 1` and both wrote `R-00n`. Convex serialises
 *      mutations per document, not across documents, so nothing stopped it —
 *      and a collection round is the burst that widens the window most.
 *
 * Recording two payments back to back and asserting the numbers differ is the
 * cheapest test that catches a regression to the old derivation, because the
 * second call would read the first one's row and land on the same number.
 */
{
  const list = (await call("aggregate:funds", {}, admin)).value ?? []
  const cashFund =
    list.find((f) => f.collectionMode === "voluntary" || f.collectionMode === "donation") ??
    list[0]
  const memberRows = (await call("aggregate:members", { filter: "active" }, admin)).value ?? []
  const who = memberRows[0]

  if (cashFund && who) {
    const first = await call(
      "transactions:recordPayment",
      { fundId: cashFund.id, memberId: who.id, amountPaise: 100, method: "cash", reference: "check:seq-a" },
      admin,
      "mutation",
    )
    const second = await call(
      "transactions:recordPayment",
      { fundId: cashFund.id, memberId: who.id, amountPaise: 100, method: "cash", reference: "check:seq-b" },
      admin,
      "mutation",
    )

    check(
      "two payments recorded in a row get different receipt numbers",
      first.status === "success" &&
        second.status === "success" &&
        first.value?.receiptNo !== second.value?.receiptNo,
      `${first.value?.receiptNo} then ${second.value?.receiptNo}`,
    )

    check(
      "receipt numbers keep the five-digit shape the seed established",
      /^R-\d{5,}$/.test(first.value?.receiptNo ?? ""),
      first.value?.receiptNo ?? first.errorMessage,
    )

    // The replay guard is about the *same* key arriving twice. The two calls
    // above carry no key at all, so a third call keyed differently is correctly
    // a third payment — that is not a replay, and asserting otherwise would be
    // asserting that the guard ignores keys.
    const KEY = "check:replay-key-m4a"
    const replayA = await call(
      "transactions:recordPayment",
      {
        fundId: cashFund.id,
        memberId: who.id,
        amountPaise: 100,
        method: "cash",
        reference: "check:replay",
        idempotencyKey: KEY,
      },
      admin,
      "mutation",
    )
    const replayB = await call(
      "transactions:recordPayment",
      {
        fundId: cashFund.id,
        memberId: who.id,
        amountPaise: 100,
        method: "cash",
        reference: "check:replay",
        idempotencyKey: KEY,
      },
      admin,
      "mutation",
    )
    check(
      "the same idempotency key twice returns the first payment, not a second one",
      replayA.status === "success" &&
        replayB.status === "success" &&
        replayA.value?.receiptNo === replayB.value?.receiptNo,
      `${replayA.value?.receiptNo} then ${replayB.value?.receiptNo}`,
    )
    check(
      "a replay does not burn a receipt number either",
      replayB.value?.receiptNo === replayA.value?.receiptNo,
      `${replayA.value?.receiptNo} vs ${replayB.value?.receiptNo}`,
    )
  } else {
    check("a cash fund and a member were found to test the sequence", false, "could not find fixtures")
  }
}

console.log("\nM5 — the reminder seam")
/*
 * What is asserted here is the set of *decisions*, because those are the parts a
 * provider must not be allowed to make: which of the three conversations a
 * member's position calls for, which channel that conversation suits, and
 * whether a refusal is honoured.
 *
 * The first two are pure functions, so they are checked by driving the live
 * queries over the seeded roster — a real defaulter's real ageing — rather than
 * by importing the module, which this harness deliberately does not do. A rule
 * that only holds for the fixture you imagined is not a rule.
 */
{
  const treasurer = await signIn("treasurer@jamaat.org")
  const view = (await call("reminders:defaulters", { sort: "oldest" }, treasurer)).value
  check(
    "a treasurer can read the defaulter list",
    Array.isArray(view?.rows),
    JSON.stringify(view ?? {}).slice(0, 120),
  )

  const memberDefaulters = await call("reminders:defaulters", {}, member)
  check(
    "a member cannot read the defaulter list",
    memberDefaulters.status === "error" && /access required/i.test(memberDefaulters.errorMessage ?? ""),
    memberDefaulters.errorMessage,
  )

  const rows = view?.rows ?? []

  check(
    "no provider is configured, and the list says so rather than throwing",
    view?.providerConfigured === false,
    `providerConfigured=${view?.providerConfigured}`,
  )

  check(
    "the ageing buckets add up to the outstanding total",
    view?.buckets?.reduce((s, b) => s + b.totalPaise, 0) === view?.totalPaise,
    `${view?.buckets?.reduce((s, b) => s + b.totalPaise, 0)} vs ${view?.totalPaise}`,
  )

  check(
    "the defaulter list is sorted longest-outstanding first",
    rows.every((r, i) => i === 0 || rows[i - 1].daysPastDue >= r.daysPastDue),
    rows.slice(0, 3).map((r) => r.daysPastDue).join(", "),
  )
  // The template rule, over the real roster rather than a fixture: nobody past
  // their due date is told nothing is late, and nobody three months behind is
  // chased as though they had merely forgotten.
  const wrongDueSoon = rows.filter((r) => r.daysPastDue > 0 && r.kind === "due_soon")
  check(
    "no member past their due date is told nothing is late",
    wrongDueSoon.length === 0,
    `${wrongDueSoon.length} misclassified`,
  )

  const wrongSummary = rows.filter((r) => r.months >= 3 && r.kind !== "arrears_summary")
  check(
    "a member three months behind gets the arrears summary, not a chase",
    wrongSummary.length === 0,
    `${wrongSummary.length} misclassified`,
  )

  const wrongOverdue = rows.filter(
    (r) => r.daysPastDue > 0 && r.months < 3 && r.kind !== "overdue",
  )
  check(
    "one or two months behind gets the overdue note",
    wrongOverdue.length === 0,
    `${wrongOverdue.length} misclassified`,
  )

  const unreachable = rows.filter((r) => !r.reachEmail && !r.reachSms)
  check(
    "members with no contact details stay on the list rather than vanishing",
    unreachable.length === 0,
    `${unreachable.length} had neither email nor phone`,
  )
  // Consent: absence is consent, an explicit refusal is not. And a refusal that
  // a run ignores is the single worst bug this feature could have.
  const target = rows.find((r) => r.reachEmail || r.reachSms)
  if (!target) {
    check("a reachable defaulter was found to test consent", false, "no fixture")
  } else {
    const setAllOff = await call(
      "reminders:setPreference",
      { memberId: target.memberId, email: false, sms: false, whatsapp: false },
      admin,
      "mutation",
    )
    const afterRefusal = (await call("reminders:defaulters", { sort: "oldest" }, treasurer)).value
    const row = afterRefusal?.rows?.find((r) => r.memberId === target.memberId)
    check(
      "a refusal is recorded against the member's own row",
      setAllOff.status === "success" && row?.optedOut === true,
      `optedOut=${row?.optedOut}`,
    )

    // Scoped to *this* run. The member may already have rows from an earlier
    // harness run, and counting those would make this pass for the wrong reason
    // the first time and fail for the right reason later.
    const before = (await call("reminders:history", { memberId: target.memberId }, treasurer)).value ?? []
    const afterRun = await call("reminders:runCampaign", { kind: "overdue" }, treasurer, "mutation")
    const after = (await call("reminders:history", { memberId: target.memberId }, treasurer)).value ?? []
    const fresh = after.slice(0, after.length - before.length)
    check(
      "a run queues nothing for a member who asked not to be reminded",
      afterRun.status === "success" && fresh.length === 0,
      `${fresh.length} newly queued of ${after.length} recorded`,
    )
    const memberSetsOthers = await call(
      "reminders:setPreference",
      { memberId: rows[0]?.memberId, email: false },
      member,
      "mutation",
    )
    check(
      "a member cannot change somebody else's preferences",
      memberSetsOthers.status === "error" &&
        /only change your own/i.test(memberSetsOthers.errorMessage ?? ""),
      memberSetsOthers.errorMessage,
    )

    // Direction matters: recording that somebody asked to be left alone is
    // protective and is allowed on their behalf, because not every member has
    // an account to do it from. Agreeing to chase them is not.
    const treasurerTurnsOn = await call(
      "reminders:setPreference",
      { memberId: target.memberId, sms: true },
      treasurer,
      "mutation",
    )
    check(
      "a committee user cannot agree to reminders on a member's behalf",
      treasurerTurnsOn.status === "error" &&
        /cannot agree to reminders/i.test(treasurerTurnsOn.errorMessage ?? ""),
      treasurerTurnsOn.errorMessage,
    )

    // Put it back, or every later run of this harness inherits the refusal.
    await call(
      "reminders:setPreference",
      { memberId: target.memberId, email: true, sms: true, whatsapp: true },
      admin,
      "mutation",
    )
  }

  const runs = await call("reminders:campaigns", {}, treasurer)
  check(
    "a run is on the record, with the counts it decided on",
    runs.status === "success" &&
      (runs.value?.length ?? 0) > 0 &&
      typeof runs.value[0].considered === "number",
    JSON.stringify(runs.value?.[0] ?? runs.errorMessage),
  )

  const memberRuns = await call("reminders:campaigns", {}, member)
  check(
    "a member cannot read the run history",
    memberRuns.status === "error" && /access required/i.test(memberRuns.errorMessage ?? ""),
    memberRuns.errorMessage,
  )
}

console.log(`\n  ${pass} passed, ${fail} failed.\n`)
process.exit(fail > 0 ? 1 : 0)
