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

console.log("\nCSV export — the bytes a spreadsheet will actually read")
/*
 * This section is not about the product, it is about a format, and the format
 * fails on someone else's machine. Every one of these assertions is a way the
 * file can open successfully and still be wrong:
 *
 *   - a name containing a comma silently becomes two columns, and the arrears
 *     total no longer matches the column the treasurer is looking at;
 *   - a name containing a quote makes the row unparseable past that point;
 *   - a name beginning with `=` is not text in Excel, it is a *formula*, and
 *     this is the one with teeth: the member list is user-supplied, so a name
 *     of `=HYPERLINK("http://phish.example","Verify")` lands a clickable link
 *     in a treasurer's spreadsheet. The guard is asserted directly rather than
 *     inferred, because the failure is invisible until someone opens the file;
 *   - without the BOM, Excel reads UTF-8 as the local codepage and a name comes
 *     out mangled;
 *   - amounts written as `₹1,23,456` are text to a spreadsheet and cannot be
 *     summed, which is the only reason anyone opens the file.
 *
 * The module under test is the same file the app imports, not a copy.
 */
const { toCsv, parseCsv, neutraliseFormula, UTF8_BOM } = await import(
  "../src/lib/csv.ts"
)

const hostile = [
  {
    name: 'Ali, Mohammad',
    amountPaise: 125000,
    months: 5,
    daysPastDue: 210,
    oldestMonth: "April 2024",
    bucket: "d90plus",
    kind: "arrears_summary",
    reachEmail: true,
    reachSms: false,
    optedOut: false,
    lastRemindedAt: 1750000000000,
    lastReminderState: "sms · queued",
  },
  {
    // A legal name, and a formula the moment it reaches Excel.
    name: '=HYPERLINK("http://phish.example","Verify your account")',
    amountPaise: 5000,
    months: 1,
    daysPastDue: 12,
    oldestMonth: "September 2026",
    bucket: "d30",
    kind: "overdue",
    reachEmail: false,
    reachSms: true,
    optedOut: false,
    lastRemindedAt: null,
    lastReminderState: null,
  },
  {
    name: 'Sheikh "Bhai" Saheb',
    amountPaise: 0,
    months: 0,
    daysPastDue: 0,
    oldestMonth: null,
    bucket: "current",
    kind: "due_soon",
    reachEmail: false,
    reachSms: false,
    optedOut: true,
    lastRemindedAt: null,
    lastReminderState: null,
  },
  {
    name: "-1+1",
    amountPaise: 100,
    months: 1,
    daysPastDue: 3,
    oldestMonth: "September 2026",
    bucket: "d30",
    kind: "overdue",
    reachEmail: true,
    reachSms: true,
    optedOut: false,
    lastRemindedAt: null,
    lastReminderState: null,
  },
]

const HOSTILE_COLUMNS = [
  { header: "Member", value: (r) => r.name },
  { header: "Outstanding (INR)", value: (r) => r.amountPaise / 100 },
  { header: "Months owed", value: (r) => r.months },
  { header: "Days past due", value: (r) => r.daysPastDue },
  { header: "Last chased", value: (r) => r.lastRemindedAt ?? "" },
]

const hostileCsv = toCsv(HOSTILE_COLUMNS, hostile)
const parsed = parseCsv(hostileCsv)

check(
  "a comma in a name does not become a second column",
  parsed.every((r) => r.length === HOSTILE_COLUMNS.length),
  parsed.map((r) => r.length).join(", ") + " cells per row, expected " + HOSTILE_COLUMNS.length,
)
check(
  "a quote in a name survives the round trip intact",
  parsed[3]?.[0] === 'Sheikh "Bhai" Saheb',
  JSON.stringify(parsed[3]?.[0]),
)
check(
  "a name that would execute as a formula is neutralised",
  /HYPERLINK/.test(hostileCsv) && !/^=/m.test(hostileCsv) && parsed[2]?.[0]?.startsWith("'="),
  parsed[2]?.[0]?.slice(0, 40),
)
check(
  "the guard covers every character that opens a formula, not just =",
  ["=1", "+1", "-1", "@x", "\tx"].every((s) => neutraliseFormula(s).startsWith("'")),
  ["=1", "+1", "-1", "@x", "\\tx"].map(neutraliseFormula).join(" "),
)
check(
  "a name that is already text is left alone",
  neutraliseFormula("Abdullah Khan") === "Abdullah Khan",
  neutraliseFormula("Abdullah Khan"),
)
check(
  "amounts are numbers a spreadsheet can sum, not formatted currency",
  parsed[1]?.[1] === "1250" && Number(parsed[1][1]) === 1250,
  `Outstanding (INR) wrote ${JSON.stringify(parsed[1]?.[1])}`,
)
check(
  "the header record names the columns and the unit",
  parsed[0]?.[0] === "Member" && parsed[0]?.[1] === "Outstanding (INR)",
  parsed[0]?.join(", "),
)
check(
  "the file carries a byte-order mark so Excel reads it as UTF-8",
  hostileCsv.startsWith(UTF8_BOM) && parseCsv(hostileCsv).length === hostile.length + 1,
  `starts with ${JSON.stringify(hostileCsv.slice(0, 1))}`,
)
check(
  "and the BOM is written exactly once, not again by the downloader",
  !hostileCsv.slice(UTF8_BOM.length).startsWith(UTF8_BOM),
  "a second BOM renders as a stray character in the first header cell",
)
check(
  "records are CRLF-separated, as RFC 4180 specifies",
  hostileCsv.includes("\r\n") && !/[^\r]\n/.test(hostileCsv),
  `${hostileCsv.split("\r\n").length - 1} record breaks`,
)
check(
  "an empty list still opens to show which columns exist",
  parseCsv(toCsv(HOSTILE_COLUMNS, [])).length === 1,
  "a zero-row export should be a header, not a zero-byte file",
)
check(
  "a missing value is an empty cell, not the word null",
  parseCsv(toCsv(HOSTILE_COLUMNS, [hostile[2]]))[1]?.[4] === "",
  JSON.stringify(parseCsv(toCsv(HOSTILE_COLUMNS, [hostile[2]]))[1]?.[4]),
)

/* ------------------------------------------------------------------ UPI ----
 *
 * The static UPI QR, and the one property it must never lose.
 *
 * The committee decided that this application records money rather than taking
 * it (docs/M4-PLAN.md §8). Members are shown the bank account and a QR code,
 * pay from their own UPI app, and then tell the treasurer. Nothing here
 * confirms a payment, and the QR must keep being a *printed instruction* rather
 * than drifting into something that looks like a checkout — which is exactly
 * what happens if somebody helpfully adds the member's outstanding amount to it.
 *
 * A QR that carries `am=100` says, to a member and to a treasurer alike, that
 * the app knows what is owed and what was paid. It knows neither. A member who
 * believes it does stops telling the treasurer, and the contribution is simply
 * never recorded — a silent failure in a system whose entire value is that its
 * books are right.
 *
 * So the absence of an amount is asserted here, alongside the encoding rules
 * that make the QR actually scan.
 */
const { upiIntentUri, isValidVpa, isValidIfsc, formatAccountNumber, PAYEE_NAME } =
  await import("../src/lib/upi.ts")

const uri = upiIntentUri({ vpa: "bbc.hdfc@example" })

check(
  "the QR carries the UPI address it was given",
  uri.startsWith("upi://pay?pa=bbc.hdfc%40example") ||
    uri.startsWith("upi://pay?pa=bbc.hdfc@example"),
  uri,
)
check(
  "the payee name is BBC, the string a member reads in their UPI app",
  uri.includes(`pn=${PAYEE_NAME}`) && PAYEE_NAME === "BBC",
  `pn=${decodeURIComponent(uri.split("pn=")[1]?.split("&")[0] ?? "?")}`,
)
check(
  "the currency is fixed to rupees and is not an argument",
  uri.includes("cu=INR") && !uri.includes("cu=USD"),
  uri,
)
check(
  "and it carries NO amount, because the app does not know what is owed",
  !/[?&]am=/.test(uri) && !/[?&]tr=/.test(uri),
  "an amount or a trackable reference turns a printed instruction into a checkout",
)
check(
  "nor a transaction reference this system would ever look up",
  !/[?&]mc=/.test(uri) && !/[?&]tr=/.test(uri),
  "a reference nobody resolves invites a treasurer to trust a match",
)

// The note is a convenience for the payer. It is the one free-text value in
// the payload, and UPI apps split on & and = without escaping, so a note with a
// space, an ampersand or a hash silently truncates what the member sees — or
// throws the rest of the payload away as a fragment.
const hostileNote = upiIntentUri({
  vpa: "bbc.hdfc@example",
  note: "Aman & Sons #3 <March>",
})
check(
  "a note with an ampersand and a hash cannot truncate the payload",
  !/[?&=][^?&=]*[\s#]/.test(hostileNote.split("tn=")[1] ?? "") &&
    hostileNote.split("tn=").length === 2,
  hostileNote,
)
check(
  "an empty note is omitted rather than sent blank",
  !upiIntentUri({ vpa: "bbc.hdfc@example", note: "   " }).includes("tn="),
  "tn= with nothing after it is noise in a payer's app",
)

// A VPA that is one character wrong produces a QR that scans perfectly and
// sends the money to a stranger. Rejecting is the only safe behaviour; the
// mutation rejects too, so this is the first of two gates rather than the only
// one.
check(
  "a mistyped UPI address is rejected rather than rendered",
  !isValidVpa("bbc.example") && !isValidVpa("bbc@") && !isValidVpa("@example"),
  "each of these would produce a QR that scans and pays nobody",
)
check(
  "a real one is accepted",
  isValidVpa("bbc.hdfc@example") && isValidVpa("bbc@okicici"),
  "the shape members' own banks issue",
)
check(
  "an IFSC is checked the same way",
  isValidIfsc("HDFC0000521") && !isValidIfsc("HDFC00521") && !isValidIfsc("HDF10000521"),
  "four letters, a zero, then fifteen — the RBI's own layout",
)
check(
  "a 16-digit account number is grouped in fours, because it gets read aloud",
  formatAccountNumber("50200034778912") === "5020 0034 7789 12",
  formatAccountNumber("50200034778912"),
)


/* -------------------------------------------------------------------------- *
 * M6 — cross-organisation isolation
 *
 * Everything above proves that one organisation behaves. This proves a second
 * one cannot be reached, which is the M6 exit criterion stated as "tested, not
 * assumed".
 *
 * The method is the only honest one available: sign in as each org's admin,
 * take the *other* org's real document ids, and point every id-taking query at
 * them. A handler that filters by orgId returns null; one that forgets returns
 * a stranger's bank details. Both read identically in the source, which is
 * exactly why this has to be a test and not a code review.
 *
 * The second org is a fixture, not a demo — see convex/seedSecondOrg.ts.
 * -------------------------------------------------------------------------- */

console.log("\nM6 — cross-organisation isolation")

// `JSON.stringify(undefined)` is `undefined`, so a `.slice()` on it throws and
// takes the whole suite down before the final tally prints. A detail string is
// never worth losing 126 passing assertions over, so every one goes through
// this, which also has to cope with a Convex error payload.
const brief = (value, n = 200) => {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, n)
  } catch {
    return String(value).slice(0, n)
  }
}

const second = await call(
  "seedSecondOrg:seedSecondOrg",
  { confirm: "seed second org" },
  undefined,
  "mutation",
)

if (second.status !== "success" || !second.value?.ids) {
  // A missing or unusable fixture is not a pass. Saying so is the whole point:
  // "isolation is fine" is not a claim this suite can make if there was never
  // a second org to attack.
  check(
    "the second organisation exists to test isolation against",
    false,
    second.errorMessage ?? brief(second, 300),
  )
} else {
  const other = second.value
  const otherIds = other.ids

  const demoToken = await signIn("secretary@jamaat.org")
  const otherToken = await signIn(other.signInAs)

  const demoFunds = await call("data:listFunds", {}, demoToken)
  const demoMembers = await call("data:listMembers", {}, demoToken)
  const demoFundId = demoFunds.value?.[0]?.id
  const demoMemberId = demoMembers.value?.[0]?.id

  // Establish that both orgs are real and readable by their own admin FIRST.
  // If either of these fails, every "refused" result below is vacuous — an
  // empty database refuses everything.
  const ownDemo = await call(
    "aggregate:fundDetail",
    { fundId: demoFundId },
    demoToken,
  )
  const ownOther = await call(
    "aggregate:fundDetail",
    { fundId: otherIds.fundId },
    otherToken,
  )
  check(
    "each organisation can read its own fund, so the refusals below mean something",
    ownDemo.status === "success" &&
      ownDemo.value !== null &&
      ownOther.status === "success" &&
      ownOther.value !== null,
    `demo: ${brief(ownDemo.value ?? ownDemo.errorMessage, 120)} | ` +
      `other: ${brief(ownOther.value ?? ownOther.errorMessage, 120)}`,
  )

  /* ---- the demo admin, holding the second org's ids ---- */

  for (const [label, path, args] of [
    ["fundDetail", "aggregate:fundDetail", { fundId: otherIds.fundId }],
    [
      "memberPassbook",
      "aggregate:memberPassbook",
      { memberId: otherIds.memberId },
    ],
    ["bankPassbook", "aggregate:bankPassbook", { bankId: otherIds.bankId }],
  ]) {
    const res = await call(path, args, demoToken)
    // `null` is the correct refusal. A thrown error is also safe, so both pass;
    // what must never happen is a populated result.
    const leaked =
      res.status === "success" && res.value !== null && res.value !== undefined
    check(
      `${label} refuses another organisation's id`,
      !leaked,
      leaked ? `LEAKED: ${brief(res.value, 250)}` : res.errorMessage,
    )
  }

  // Assert on the money, not just on the null. A handler could return a
  // correctly-shaped but empty object having queried the wrong org, and that
  // would pass a bare `=== null` check while still being a scoping mistake.
  const foreignPassbook = await call(
    "aggregate:memberPassbook",
    { memberId: otherIds.memberId },
    demoToken,
  )
  const disclosed =
    foreignPassbook.status === "success" && foreignPassbook.value !== null
      ? (foreignPassbook.value.totalReceivedPaise ?? 0)
      : 0
  check(
    "a foreign passbook discloses no money",
    disclosed === 0,
    `totalReceivedPaise was ${disclosed}`,
  )

  /* ---- the other direction, so the check is not one-sided ---- */

  const reverse = await call(
    "aggregate:fundDetail",
    { fundId: demoFundId },
    otherToken,
  )
  check(
    "isolation holds in both directions",
    reverse.status !== "success" || reverse.value === null,
    `LEAKED: ${brief(reverse.value, 250)}`,
  )

  /* ---- listings: no ids required, so a subtler hole ---- */

  const [demoBanks, otherBanks, demoMemberList, otherMemberList] =
    await Promise.all([
      call("data:listBanks", {}, demoToken),
      call("data:listBanks", {}, otherToken),
      call("data:listMembers", {}, demoToken),
      call("data:listMembers", {}, otherToken),
    ])

  const demoBankRows = demoBanks.value ?? []
  const otherBankRows = otherBanks.value ?? []
  const demoMemberRows = demoMemberList.value ?? []
  const otherMemberRows = otherMemberList.value ?? []

  check(
    "neither bank list contains the other organisation's account",
    !demoBankRows.some((r) => r.id === otherIds.bankId) &&
      !otherBankRows.some((r) => r.id === demoBanks.value?.[0]?.id) &&
      demoBankRows.length > 0 &&
      otherBankRows.length > 0,
    `demo: ${demoBankRows.map((r) => r.name).join(", ")} | ` +
      `other: ${otherBankRows.map((r) => r.name).join(", ")}`,
  )

  check(
    "neither member list contains the other organisation's members",
    !demoMemberRows.some((r) => r.id === otherIds.memberId) &&
      !otherMemberRows.some((r) => r.id === demoMemberId) &&
      demoMemberRows.length > 0 &&
      otherMemberRows.length > 0,
    `demo ${demoMemberRows.length} members, other ${otherMemberRows.length}`,
  )

  // The aggregate read models are what every screen is built on. If any of them
  // counted across orgs, the numbers on a treasurer's dashboard would silently
  // include another community's money.
  // `shell` returns a flat summary keyed `orgName` — there is no nested
  // `organization` object to compare, so the identity assertion is on the
  // name the header actually renders.
  const [demoShell, otherShell] = await Promise.all([
    call("aggregate:shell", {}, demoToken),
    call("aggregate:shell", {}, otherToken),
  ])
  check(
    "the shell reports each organisation's own name",
    demoShell.status === "success" &&
      otherShell.status === "success" &&
      typeof demoShell.value?.orgName === "string" &&
      typeof otherShell.value?.orgName === "string" &&
      demoShell.value.orgName.length > 0 &&
      otherShell.value.orgName.length > 0 &&
      demoShell.value.orgName !== otherShell.value.orgName,
    `demo: ${brief(demoShell.value?.orgName ?? demoShell.errorMessage, 120)} | ` +
      `other: ${brief(otherShell.value?.orgName ?? otherShell.errorMessage, 120)}`,
  )

  const [demoFundsAgg, otherFundsAgg] = await Promise.all([
    call("aggregate:funds", {}, demoToken),
    call("aggregate:funds", {}, otherToken),
  ])

  // `aggregate:funds` returns the array itself, not a wrapper object.
  const demoFundRows = Array.isArray(demoFundsAgg.value) ? demoFundsAgg.value : []
  const otherFundRows = Array.isArray(otherFundsAgg.value)
    ? otherFundsAgg.value
    : []
  check(
    "the fund read model counts only the caller's own funds",
    demoFundsAgg.status === "success" &&
      otherFundsAgg.status === "success" &&
      demoFundRows.length > 0 &&
      otherFundRows.length > 0 &&
      !demoFundRows.some((f) => f.id === otherIds.fundId) &&
      !otherFundRows.some((f) => f.id === demoFundId),
    `demo ${brief(demoFundRows.map((f) => f.name), 120)}, ` +
      `other ${brief(otherFundRows.map((f) => f.name), 120)}`,
  )

  /* ---- a plain member, who has the least authority ---- */

  // Not `aggregate:shell`: `aggregate.ts` aliases `requireConsole as
  // requireMember`, so the whole console read model is refused a `member` role
  // by design (asserted separately above, on the refusal itself). The member
  // portal's own read model is what a member can actually reach, so that is
  // what has to resolve to their own organisation and not the other one.
  const memberToken = await signIn("imran@example.org")
  const memberSummary = await call("portal:summary", {}, memberToken)
  check(
    "a member's portal resolves to their own organisation",
    memberSummary.status === "success" &&
      typeof memberSummary.value?.orgName === "string" &&
      memberSummary.value.orgName === demoShell.value?.orgName &&
      memberSummary.value.orgName !== otherShell.value?.orgName,
    `resolved to ${brief(memberSummary.value?.orgName ?? memberSummary.errorMessage, 120)}`,
  )

  // A matching name is cheap. This is the part that costs something: the
  // member's dues are computed by summing charges and receipts, and if any of
  // those reads dropped its org filter the total would quietly include another
  // community's money. Assert the figure is real and the fund list is theirs.
  const memberFundNames = [
    ...(memberSummary.value?.dueFunds ?? []),
    ...(memberSummary.value?.voluntaryFunds ?? []),
  ]
  check(
    "a member's dues are computed inside their own organisation only",
    memberSummary.status === "success" &&
      (memberSummary.value?.totalReceivedPaise ?? 0) > 0 &&
      memberFundNames.length > 0 &&
      !memberFundNames.some((f) => f.id === otherIds.fundId),
    `received ${brief(memberSummary.value?.totalReceivedPaise)} paise across ` +
      `${brief(memberFundNames.map((f) => f.name), 120)}`,
  )

  const memberForeign = await call(
    "aggregate:memberPassbook",
    { memberId: otherIds.memberId },
    memberToken,
  )
  check(
    "a member cannot read another organisation's passbook",
    memberForeign.status !== "success" || memberForeign.value === null,
    `LEAKED: ${brief(memberForeign.value, 250)}`,
  )
}

console.log(`\n  ${pass} passed, ${fail} failed.\n`)
process.exit(fail > 0 ? 1 : 0)
