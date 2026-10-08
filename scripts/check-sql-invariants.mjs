/**
 * Stage 0 — the money invariant, and whether it can actually fail.
 *
 *   bun run sql:invariants
 *
 * ## Why this is the first thing the port proves
 *
 * The port replaces the guarantee the money paths depend on. Today a Convex
 * mutation is a serialisable transaction, so `postEntry`'s entry and the balance
 * it moves cannot disagree. A port supplies that guarantee deliberately, and the
 * only way to know it did is to have the invariant written down, executable, and
 * *able to fail*.
 *
 * So this does three things, in the order that matters:
 *
 *   1. Builds a small set of ledger entries and computes the balances they imply
 *      using **the existing implementation** — `truthFromEntries` from
 *      `convex/lib/balances.ts`, imported straight into this script, because its
 *      imports are type-only and Node can load it.
 *   2. Runs the SQL invariant from `db/invariants.sql` over those same rows and
 *      asserts it finds nothing. Two implementations, one fixture, the same
 *      answer: that is an equivalence check, not a restatement of the SQL.
 *   3. Corrupts a balance and asserts the invariant *does* find it, naming the
 *      scope. A check that cannot fail is not a check — and this application has
 *      already been burned once by a verification suite that would have passed
 *      against the broken build it existed to catch.
 *
 * Runs against PGlite, so it needs no server and no credentials, and can run on
 * every commit rather than on the day somebody remembers.
 */

import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { truthFromEntries } from "../convex/lib/balances.ts"

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass += 1
  } else {
    fail += 1
    console.log(`  FAIL  ${name}`)
    if (detail) console.log(`        ${detail}`)
  }
}

/* --------------------------------------------------------------- the fixture */

const ORG = "org1"
const FUND = "fund1"
const BANK = "bank1"
const OTHER_BANK = "bank2"
const MEMBER = "mem1"

/**
 * Six entries, chosen for the scopes they do *not* move.
 *
 * - e1, e2  a fund and a bank, in 2024 and 2025
 * - e3      a backdated entry, which must move only its own `bank_year`
 * - e4      a bank entry with no fund, which must move no fund
 * - e5      a member entry, which moves neither fund nor bank
 * - e6      a negative entry, because a refund is a negative, not a deletion
 */
const ENTRIES = [
  { id: "e1", fundId: FUND, bankId: BANK, memberId: MEMBER, amountPaise: 15000, effectiveDate: "2024-03-10" },
  { id: "e2", fundId: FUND, bankId: BANK, memberId: MEMBER, amountPaise: 15000, effectiveDate: "2025-03-10" },
  { id: "e3", fundId: FUND, bankId: BANK, memberId: null, amountPaise: 5000, effectiveDate: "2024-11-02" },
  { id: "e4", fundId: null, bankId: OTHER_BANK, memberId: null, amountPaise: 250000, effectiveDate: "2024-04-01" },
  { id: "e5", fundId: null, bankId: null, memberId: MEMBER, amountPaise: 700, effectiveDate: "2025-01-15" },
  { id: "e6", fundId: FUND, bankId: BANK, memberId: null, amountPaise: -2000, effectiveDate: "2025-06-30" },
]

const db = await PGlite.create()
await db.exec(readFileSync("db/schema.sql", "utf8"))

await db.exec(`
  INSERT INTO organizations (id, creation_time, name, slug, created_at)
    VALUES ('${ORG}', 1, 'Test Jamaat', 'test-jamaat', 1);
  INSERT INTO banks (id, creation_time, org_id, name, created_at)
    VALUES ('${BANK}', 1, '${ORG}', 'HDFC', 1), ('${OTHER_BANK}', 1, '${ORG}', 'ICICI', 1);
  INSERT INTO funds (id, creation_time, org_id, name, type, is_active, is_member_contribution, created_at)
    VALUES ('${FUND}', 1, '${ORG}', 'Monthly', 'general', true, true, 1);
  INSERT INTO members (id, creation_time, org_id, name, joined_year, joined_month, is_active, created_at)
    VALUES ('${MEMBER}', 1, '${ORG}', 'Ayesha Khan', 2024, 1, true, 1);
`)

for (const e of ENTRIES) {
  await db.exec(`
    INSERT INTO ledger_entries
      (id, creation_time, org_id, fund_id, bank_id, member_id, amount_paise, direction, category, effective_date, source)
    VALUES
      ('${e.id}', 1, '${ORG}', ${e.fundId ? `'${e.fundId}'` : "NULL"}, ${e.bankId ? `'${e.bankId}'` : "NULL"},
       ${e.memberId ? `'${e.memberId}'` : "NULL"}, ${e.amountPaise}, '${e.amountPaise >= 0 ? "credit" : "debit"}',
       'donation', '${e.effectiveDate}', 'payment');
  `)
}

/* -- the balances the *existing* implementation says these imply ---------- */

const truth = truthFromEntries(ENTRIES)
for (const [key, amountPaise] of truth) {
  const [scope, ...rest] = key.split(":")
  const scopeId = rest.join(":")
  await db.exec(`
    INSERT INTO balances (id, creation_time, org_id, scope, scope_id, amount_paise, updated_at)
    VALUES ('b-${key}', 1, '${ORG}', '${scope}', '${scopeId}', ${amountPaise}, 1);
  `)
}

console.log("\nsql:invariants — the money invariant, and whether it can fail")
/* -- 1. the two implementations agree ------------------------------------- */

const invariant = readFileSync("db/invariants.sql", "utf8")
const clean = await db.query(invariant)

check(
  "the invariant finds nothing when the balances come from the current implementation",
  clean.rows.length === 0,
  clean.rows
    .map((r) => `${r.scope}:${r.scope_id} ${r.reason} (${r.difference_paise} paise)`)
    .join(", "),
)
check(
  "the fixture produces exactly the scopes these entries name, and no others",
  [...truth.keys()].sort().join(" | ") ===
    [
      `bank:${BANK}`,
      `bank:${OTHER_BANK}`,
      `bank_year:${BANK}:2024`,
      `bank_year:${BANK}:2025`,
      `bank_year:${OTHER_BANK}:2024`,
      `fund:${FUND}`,
      `member:${MEMBER}`,
    ]
      .sort()
      .join(" | "),
  `${truth.size} rows: ${[...truth.keys()].sort().join(", ")}`,
)

/* -- 2. the scopes an entry does not move --------------------------------- */

check(
  "a backdated entry moves only its own bank-year, not every year after it",
  truth.get(`bank_year:${BANK}:2024`) === 20000 && truth.get(`bank_year:${BANK}:2025`) === 13000,
  `2024=${truth.get(`bank_year:${BANK}:2024`)} 2025=${truth.get(`bank_year:${BANK}:2025`)}`,
)
check(
  "an entry with no fund moves no fund",
  truth.get(`fund:${FUND}`) === 33000,
  `fund=${truth.get(`fund:${FUND}`)} — e4 names no fund, so it must not count`,
)
check(
  "a member entry moves neither a fund nor a bank",
  truth.get(`member:${MEMBER}`) === 30700 && !truth.has("member:null"),
  `member=${truth.get(`member:${MEMBER}`)}`,
)
check(
  "a negative entry subtracts, rather than being dropped as a deletion",
  truth.get(`bank:${BANK}`) === 33000,
  `bank=${truth.get(`bank:${BANK}`)} — 15000+15000+5000-2000`,
)

/* -- 3. it detects a drift, which is the point ---------------------------- */

await db.exec(`UPDATE balances SET amount_paise = amount_paise + 1 WHERE scope = 'fund'`)

const drifted = await db.query(invariant)
check(
  "one paise of drift in one fund is reported",
  drifted.rows.length === 1 &&
    drifted.rows[0].scope === "fund" &&
    drifted.rows[0].scope_id === FUND &&
    Number(drifted.rows[0].difference_paise) === 1,
  JSON.stringify(drifted.rows),
)

await db.exec(`UPDATE balances SET amount_paise = amount_paise - 1 WHERE scope = 'fund'`)
await db.exec(`DELETE FROM balances WHERE scope = 'bank_year' AND scope_id = '${BANK}:2024'`)

const missingRow = await db.query(invariant)
check(
  "a missing balance row against real entries is reported too",
  missingRow.rows.length === 1 &&
    missingRow.rows[0].scope === "bank_year" &&
    /no balance row/.test(missingRow.rows[0].reason),
  JSON.stringify(missingRow.rows),
)

await db.exec(`
  INSERT INTO balances (id, creation_time, org_id, scope, scope_id, amount_paise, updated_at)
  VALUES ('b-restore', 1, '${ORG}', 'bank_year', '${BANK}:2024', 20000, 1);
`)

const beforeDelete = await db.query(invariant)
await db.exec(`DELETE FROM ledger_entries WHERE id = 'e5'`)
const afterDelete = await db.query(invariant)
check(
  "a balance row with no entries behind it is reported as well",
  beforeDelete.rows.length === 0 &&
    afterDelete.rows.length === 1 &&
    afterDelete.rows[0].scope === "member",
  `before=${beforeDelete.rows.length} after=${JSON.stringify(afterDelete.rows)}`,
)

console.log(`\n  ${pass} passed, ${fail} failed.\n`)
process.exit(fail > 0 ? 1 : 0)
