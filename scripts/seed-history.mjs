/**
 * Back-fill the demo organisation's real history, one year at a time.
 *
 * `seed:seedHistory` deliberately takes a single year: Convex allows 16000
 * writes per mutation and a year of dues for 84 members is already several
 * thousand documents. This drives the loop and then reports the resulting shape.
 *
 *   bun run seed:history
 */

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"

async function call(path, args, token, kind) {
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
  console.error(
    "Sign-in failed. Run `bun run seed` first, and note that Convex Auth\n" +
      "rate-limits sign-in attempts — if you have just run `bun run check` or\n" +
      "`bun run measure`, wait a minute and try again.\n" +
      `\n  ${JSON.stringify(signIn).slice(0, 300)}\n`,
  )
  process.exit(1)
}

const FIRST_YEAR = Number(process.env.HISTORY_FROM ?? 2018)
const LAST_YEAR = new Date().getUTCFullYear() - 1

let last = null
let backoffMs = 2000
let added = 0
for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
  process.stdout.write(`  ${year} … `)
  const res = await call(
    "seed:seedHistory",
    { confirm: "backfill history", year },
    token,
    "mutation",
  )
  if (res.status !== "success") {
    // The local deployment allows 4 MiB of writes per second, which one year
    // of history can exceed. Backing off and resuming is the whole fix — the
    // per-year idempotency guard in the mutation makes a retry safe.
    const message = res.errorMessage ?? res.message ?? JSON.stringify(res)
    const rateLimited =
      res.code === "TooManyWrites" || /too many writes/i.test(message)
    if (rateLimited) {
      backoffMs = Math.min(backoffMs * 2, 20000)
      console.log(`write rate limited — retrying in ${backoffMs / 1000}s`)
      await new Promise((r) => setTimeout(r, backoffMs))
      year--
      continue
    }
    backoffMs = 2000
    console.log(`failed\n${message}`)
    process.exit(1)
  }
  last = res.value
  if (last.skipped) {
    console.log("already seeded")
    continue
  }
  added += last.ledgerEntriesAdded
  console.log(
    `${last.contributions} dues, ${last.fridayRounds} Fridays, ` +
      `${last.ledgerEntriesAdded.toLocaleString()} ledger entries`,
  )
}

console.log(
  `\n  History back-filled ${FIRST_YEAR}–${LAST_YEAR}: ${added.toLocaleString()}` +
    ` ledger entries written.\n` +
    `  Run \`bun run check\` to confirm every materialised balance equals the sum of\n` +
    `  its entries, then \`bun run measure\` to confirm the read models did not grow.\n`,
)
