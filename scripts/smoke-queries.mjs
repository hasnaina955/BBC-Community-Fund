/**
 * Smoke test for every read model the app depends on.
 *
 * Run it after seeding, including after back-filling history: the point is that
 * each query returns a real result against a full eight years of data, and
 * that none of them is silently truncated by a document limit.
 *
 *   bun run smoke
 */

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"

async function call(path, args, token, kind = "query") {
  const started = Date.now()
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, args, format: "json" }),
  })
  const json = await res.json()
  return { ...json, ms: Date.now() - started }
}

const signIn = await call(
  "auth:signIn",
  {
    provider: "password",
    params: {
      flow: "signIn",
      email: process.env.DEMO_EMAIL ?? "secretary@jamaat.org",
      password: process.env.DEMO_PASSWORD ?? "community123",
    },
  },
  undefined,
  "action",
)
const token = signIn.value?.tokens?.token
if (!token) {
  console.error("Sign-in failed. Run `bun run seed` first.")
  process.exit(1)
}

const year = new Date().getUTCFullYear()
const funds = await call("aggregate:funds", {}, token)
const banks = await call("aggregate:banks", {}, token)
const members = await call("aggregate:members", { filter: "all" }, token)
const shell = await call("aggregate:shell", {}, token)

const cases = [
  ["aggregate:shell", {}],
  ["aggregate:dashboard", {}],
  ["aggregate:funds", {}],
  ["aggregate:banks", {}],
  ["aggregate:members", { filter: "arrears" }],
  ["aggregate:members", { filter: "clear" }],
  ["aggregate:directory", {}],
  ["aggregate:audit", { limit: 60 }],
  ["aggregate:approvals", {}],
  ["aggregate:transactions", { status: "all" }],
  ["aggregate:transactions", { status: "pending" }],
  ["aggregate:reports", { year }],
  ["aggregate:reports", { year: shell.value.yearRange.from }],
  ["aggregate:grid", { year }],
  ["aggregate:grid", { year: shell.value.yearRange.from }],
  ["balances:verify", {}],
]

for (const fund of funds.value) {
  cases.push([`aggregate:fundDetail (${fund.name})`, { fundId: fund.id }])
  // The grid must refuse every mode that is not fixed_monthly, and say why.
  cases.push([`aggregate:grid (${fund.name})`, { year, fundId: fund.id }])
}
for (const bank of banks.value.slice(0, 1)) {
  cases.push([`aggregate:bankPassbook (${bank.name})`, { bankId: bank.id, year }])
}
for (const member of members.value.slice(0, 1)) {
  cases.push([`aggregate:memberPassbook (${member.name})`, { memberId: member.id }])
}

let failures = 0
console.log("")
for (const [label, args] of cases) {
  // A label may be "aggregate:grid (Friday Fund)"; the path is everything up
  // to the first space.
  const path = label.split(" ")[0]
  const res = await call(path, args, token)
  const ok = res.status === "success"
  if (!ok) failures += 1
  const bytes = ok ? Buffer.byteLength(JSON.stringify(res.value)) : 0
  // `balances:verify` is a diagnostic, not a screen: it deliberately reads the
  // entire ledger to prove the materialised balances match it, so a few seconds
  // is the point rather than a problem.
  const slow = ok && res.ms > 1000 && !path.startsWith("balances:")
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${String(res.ms).padStart(4)}ms  ` +
      `${kb(bytes).padStart(9)}  ${label}${slow ? "   <- slow" : ""}`,
  )
  if (!ok) console.log(`        ${res.errorMessage}`)
}
console.log(
  `\n  ${cases.length - failures}/${cases.length} read models returned a result.\n`,
)
process.exit(failures > 0 ? 1 : 0)

function kb(n) {
  return `${(n / 1024).toFixed(1)} kB`
}
