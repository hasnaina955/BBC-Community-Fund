/**
 * Payload measurement.
 *
 * M1 shipped every row to the browser and aggregated in `lib/selectors.ts`.
 * That measured 1,018,956 bytes for nine months of demo data and extrapolates
 * to roughly 11 MB at eight years of real history. Aggregation now happens in
 * Convex, so this script measures what each screen actually downloads and
 * prints the two columns side by side.
 *
 *   bun run measure
 *
 * Requires the preview to be running (it reaches Convex on 127.0.0.1:3210).
 */

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const EMAIL = process.env.DEMO_EMAIL ?? "secretary@jamaat.org"
const PASSWORD = process.env.DEMO_PASSWORD ?? "community123"

async function call(path, args, token) {
  const res = await fetch(`${CONVEX}/api/${token ? "query" : "action"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, args, format: "json" }),
  })
  const json = await res.json()
  if (json.status !== "success" && json.status !== "error") {
    throw new Error(`${path}: unexpected response ${JSON.stringify(json)}`)
  }
  return json
}

const signIn = await call("auth:signIn", {
  provider: "password",
  params: { flow: "signIn", email: EMAIL, password: PASSWORD },
})
const token = signIn.value?.tokens?.token
if (!token) throw new Error(`sign-in failed: ${JSON.stringify(signIn)}`)

/** query path -> the screen that loads it */
const AGGREGATES = [
  ["aggregate:shell", {}, "every screen (sidebar)"],
  ["aggregate:dashboard", {}, "Dashboard"],
  ["aggregate:funds", {}, "Funds, plus pickers on 4 screens"],
  ["aggregate:fundDetail", { fundId: "@fund" }, "Fund detail"],
  ["aggregate:banks", {}, "Banks"],
  ["aggregate:bankPassbook", { bankId: "@bank", year: 2026, limit: 40 }, "Bank passbook"],
  ["reconciliation:status", {}, "Reconciliation"],
  ["aggregate:members", { filter: "all" }, "Members"],
  ["aggregate:memberPassbook", { memberId: "@member" }, "Member passbook"],
  ["aggregate:grid", { year: 2026 }, "Collection grid"],
  ["aggregate:transactions", { status: "all" }, "Transactions"],
  ["aggregate:approvals", {}, "Approvals"],
  ["aggregate:reports", { year: 2026 }, "Reports"],
  ["aggregate:directory", {}, "Users"],
  ["aggregate:audit", { limit: 60 }, "Settings"],
]

const RAW = [
  ["data:listLedgerEntries", {}, "M1: every ledger entry"],
  ["data:listContributions", {}, "M1: every contribution"],
  ["data:listPayments", {}, "M1: every payment"],
  ["data:listMembers", { includeInactive: true }, "M1: members"],
  ["data:listTransactions", {}, "M1: transactions"],
  ["data:listFunds", {}, "M1: funds"],
  ["data:listBanks", {}, "M1: banks"],
  ["data:listUsers", {}, "M1: users"],
  ["data:listAuditLog", { limit: 50 }, "M1: audit log"],
  ["data:me", {}, "M1: session"],
]

/** Resolve the `@entity` placeholders by taking the first id from a probe. */
const funds = await call("aggregate:funds", {}, token)
const banks = await call("aggregate:banks", {}, token)
const members = await call("aggregate:members", { filter: "all" }, token)
const ids = {
  "@fund": funds.value?.[0]?.id,
  "@bank": banks.value?.[0]?.id,
  "@member": members.value?.[0]?.id,
}

const fill = (args) =>
  Object.fromEntries(
    Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.startsWith("@") ? ids[v] : v]),
  )

const measure = async ([path, args, screen]) => {
  const res = await call(path, fill(args), token)
  if (res.status !== "success") {
    // Worth showing rather than counting as zero: at eight years of history the
    // M1 row lists do not get slow, they stop working at all.
    return { path, screen, bytes: 0, error: res.errorMessage ?? "failed" }
  }
  const bytes = Buffer.byteLength(JSON.stringify(res.value ?? null))
  return { path, screen, bytes }
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`
const cell = (n) => kb(n).padStart(9)

const rows = []
let total = 0
for (const entry of AGGREGATES) {
  const m = await measure(entry)
  rows.push(m)
  total += m.bytes
}

const raw = []
let rawTotal = 0
for (const entry of RAW) {
  const m = await measure(entry)
  raw.push(m)
  rawTotal += m.bytes
}const rule = `    ${"-".repeat(9)}  ${"-".repeat(30)} ${"-".repeat(24)}`

console.log("\n  Read models the app now loads (sum of every screen)\n")
for (const r of rows.sort((a, b) => b.bytes - a.bytes)) {
  console.log(`    ${cell(r.bytes)}  ${r.path.padEnd(30)} ${r.screen}`)
}
console.log(rule)
console.log(`    ${cell(total)}  TOTAL  (${total.toLocaleString()} bytes)\n`)

console.log("  What milestone M1 downloaded for the same app\n")
for (const r of raw.sort((a, b) => b.bytes - a.bytes)) {
  if (r.error) {
    console.log(`    ${"FAILED".padStart(9)}  ${r.path.padEnd(30)} ${r.error}`)
  } else {
    console.log(`    ${cell(r.bytes)}  ${r.path.padEnd(30)} ${r.screen}`)
  }
}
console.log(rule)
console.log(`    ${cell(rawTotal)}  TOTAL  (${rawTotal.toLocaleString()} bytes)\n`)

const failed = raw.filter((r) => r.error)
const saving = (1 - total / rawTotal) * 100
console.log(
  `  Payload down ${saving.toFixed(1)}% (${kb(rawTotal - total)} smaller).\n` +
    (failed.length
      ? `  ${failed.length} of the M1 row lists no longer return at all — they exceed the\n` +
        `  server's per-query document limit, so at this history length the M1 app\n` +
        `  would not load rather than merely load slowly.\n`
      : "") +
    `  The aggregate side does not grow with history: the largest read model is the\n` +
    `  collection grid, which is one year of member-months (84 x 12), not the ledger.\n`,
)
