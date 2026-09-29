/**
 * Seed the base demo organisation.
 *
 *   bun run convex:seed
 *
 * This is the same call as `bunx convex run seed:seedDemo '{"confirm":"seed"}'`,
 * issued over HTTP instead. It exists so `bun run seed:fresh` can drive all
 * three reset phases with one mechanism: `bunx convex` resolves and re-bundles
 * the CLI on every invocation, which costs more than the seed itself.
 *
 * The seeder refuses to run against a database that already holds an
 * organisation, so this is safe to run twice — the second call errors rather
 * than duplicating anything.
 */

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"

const res = await fetch(`${CONVEX}/api/mutation`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "seed:seedDemo",
    args: { confirm: "seed" },
    format: "json",
  }),
})
const body = await res.json()

if (body.status !== "success") {
  console.error(
    `\n  Seeding failed: ${body.errorMessage ?? JSON.stringify(body)}\n`,
  )
  process.exit(1)
}

const v = body.value
console.log(
  `  ${v.users} users, ${v.members} members, ${v.funds} funds, ${v.banks} banks\n` +
    `  ${v.monthlyDues} monthly dues, ${v.fridayRounds} Friday rounds, ` +
    `${v.ledgerEntries} ledger entries, ${v.balances} balances\n` +
    `  Sign in as ${v.signInAs} / ${v.demoPassword}\n`,
)
