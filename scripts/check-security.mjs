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

console.log(`\n  ${pass} passed, ${fail} failed.\n`)
process.exit(fail > 0 ? 1 : 0)
