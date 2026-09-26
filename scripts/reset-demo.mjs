/**
 * Clear the demo organisation, one table per call.
 *
 * `seed:resetDemo` takes a single table name because a Convex mutation may read
 * at most 4096 documents, and eight years of payments is nearly 9,500 — a reset
 * that swept everything in one call would throw before deleting anything. This
 * walks the tables in dependency order (children before parents) and repeats each
 * until it reports zero.
 *
 *   bun run seed:reset
 */

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"

async function call(path, args, kind) {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  })
  return res.json()
}

// Children before parents: an entry references a payment, a payment references
// a member. The auth tables go next — they are reached through the user ids, so
// they have to be cleared while those rows still exist — and `users` last,
// because removing them also removes the organisation.
const TABLES = [
  "auditLog",
  "reconciliations",
  "balances",
  "ledgerEntries",
  "payments",
  "contributions",
  "pledges",
  "collectionRounds",
  "transactions",
  "members",
  "funds",
  "banks",
  "authSessions",
  "authRefreshTokens",
  "authAccounts",
  "users",
]

let total = 0
for (const table of TABLES) {
  let wipedThisTable = 0
  for (;;) {
    const res = await call(
      "seed:resetDemo",
      { confirm: "wipe demo data", table },
      "mutation",
    )
    if (res.status !== "success") {
      console.error(
        `\n  Failed on ${table}: ${res.errorMessage ?? JSON.stringify(res)}\n`,
      )
      process.exit(1)
    }
    if (res.value.reason) {
      console.log(`  ${table.padEnd(18)} — ${res.value.reason}`)
      break
    }
    wipedThisTable += res.value.wiped
    if (res.value.done) break
  }
  total += wipedThisTable
  if (wipedThisTable > 0) {
    console.log(`  ${table.padEnd(18)} ${wipedThisTable} rows`)
  }
}

console.log(`\n  Demo data cleared: ${total} documents.\n`)
