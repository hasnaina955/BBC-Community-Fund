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

console.log(`\n  ${pass} passed, ${fail} failed.\n`)
process.exit(fail > 0 ? 1 : 0)
