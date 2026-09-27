/**
 * Backfill the `bank_year` balance scope.
 *
 * The scope is derived state, so it is rebuilt from the ledger rather than
 * inserted by hand — the same path `balances:recompute` uses for every other
 * scope. Safe to run more than once: it only writes rows that disagree.
 *
 *   bun run balances:backfill
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
  const body = await res.json()
  if (body.errorMessage ?? body.error) {
    throw new Error(`${path}: ${body.errorMessage ?? body.error}`)
  }
  return { value: body.value, ms: Date.now() - started }
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
  console.error("Sign-in failed. Is the deployment seeded?")
  process.exit(1)
}

const recompute = await call("balances:recompute", {}, token, "mutation")
console.log(
  `recompute: ${recompute.value.corrected} of ${recompute.value.checked} scopes corrected in ${recompute.ms}ms`,
)
for (const change of recompute.value.changes) console.log(`  ${change}`)

const verify = await call("balances:verify", {}, token)
console.log(
  `verify: ok=${verify.value.ok} · ${verify.value.scopesChecked} scopes · ${verify.value.ledgerEntries} entries`,
)
for (const m of verify.value.mismatches) {
  console.log(`  MISMATCH ${m.scope}: ${m.materialised} vs ${m.computed}`)
}

// The per-year rows the passbook now depends on.
const all = await call("balances:listAll", {}, token)
const years = all.value
  .filter((r) => r.scope === "bank_year")
  .sort((a, b) => a.scopeId.localeCompare(b.scopeId))
console.log(`bank_year rows: ${years.length}`)
for (const row of years) {
  console.log(`  ${row.scopeId} = ${row.amountPaise}`)
}

process.exit(verify.value.ok ? 0 : 1)
