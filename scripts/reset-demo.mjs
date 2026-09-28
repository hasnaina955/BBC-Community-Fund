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
//
// This list must stay in step with `RESET_ORDER` in `convex/seed.ts`, which is
// what validates the name. It is duplicated rather than shared because this runs
// before Convex is reachable, and a list that has silently fallen behind is worse
// than one that is written twice: the M4a tables were missing from here on first
// write, which meant a reset left a stale `counters` row behind and the next
// seed's receipts started above the old sequence. Harmless for uniqueness, wrong
// for a demo, and invisible.
const TABLES = [
  "auditLog",
  "reconciliations",
  "settlements",
  "gatewayEvents",
  "gatewayIntents",
  "balances",
  "ledgerEntries",
  "payments",
  "counters",
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

/*
 * Report the local Convex store's size, and say something when it is large.
 *
 * Deleting every document does not make the file smaller. SQLite reuses pages
 * rather than returning them, so the store only ever grows across re-seeds — and
 * a local backend that dies partway through a demo looks exactly like an
 * application bug: blank screens, `ECONNREFUSED` on 3210, a Convex client that
 * reconnects forever. That has happened here, at a little over 400 MB, and the
 * first instinct is to blame the code that was just written.
 *
 * So the number is printed every time, and the warning is deliberately about the
 * *next step* rather than offering to take it. Removing `.convex/local` is the
 * only thing that reclaims the space, and it also removes the deployment's
 * environment variables — including the Convex Auth keypair — which then have to
 * be re-provisioned. That is a decision with consequences, not a cleanup step,
 * and it belongs to whoever is looking at the warning.
 */
const storePath = new URL("../.convex/local", import.meta.url).pathname
try {
  // `execFile`, not a promisified `du`: `du` carries a custom `.out` property
  // that `promisify` does not understand, and the resulting rejection lands in
  // the catch below — which meant this report silently never printed, which is
  // the worst possible failure mode for a warning.
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const run = promisify(execFile)
  const { stdout } = await run("du", ["-sm", storePath])
  const mb = Number(stdout.trim().split(/\s+/)[0])
  if (Number.isFinite(mb)) {
    console.log(`  Local Convex store: ${mb} MB (this only grows; a reset does not shrink it)`)
    if (mb >= 350) {
      console.log(
        `\n  \x1b[33mThis store has grown past ${mb} MB.\x1b[0m A local backend in this state\n` +
          "  has crash-looped before, and the symptom looks like an application bug.\n" +
          "  Removing .convex/local reclaims the space but also deletes the deployment's\n" +
          "  environment variables, so the Convex Auth keypair has to be re-provisioned\n" +
          "  afterwards. Do that deliberately, not as part of a reset.\n",
      )
    }
  }
} catch {
  // No local store, or `du` unavailable. Nothing to report and nothing to fix.
}
