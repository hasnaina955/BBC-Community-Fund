/**
 * End-to-end verification of the historical CSV import (M6).
 *
 *   bun run visual:import
 *
 * ## Why this builds its own community
 *
 * An import writes to the ledger. Running it against the seeded demo community
 * would mean every other suite — the balance invariant in `check`, the passbook
 * arithmetic in `visual`, the arrears figures in `visual:portal` — was asserting
 * against books that a previous run had quietly added to. The order those
 * assertions run in would become part of what they mean.
 *
 * So this suite signs up its own community, gives it a fund, a bank and three
 * members, imports into that, and deletes the whole thing at the end. The
 * seeded data is untouched and every other suite stays independent of it.
 *
 * ## What it actually proves
 *
 * That a spreadsheet becomes a *correct* ledger rather than merely a populated
 * one. The load-bearing assertions are the ones that could not be written
 * without the import path using the ordinary writers:
 *
 *   - the imported payments are visible through the ordinary read models, so
 *     the fund balance and the bank passbook include them;
 *   - the materialised `balances` still equal the sum of the ledger, which only
 *     holds if the import went through `postEntry`/`recordPaymentFor` rather
 *     than writing rows itself;
 *   - a second import of the same file changes nothing;
 *   - a file with one bad row imports *nothing*.
 */

import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:5173"
const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const OUT = process.env.VISUAL_OUT ?? ".visual"
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "community123"

const STAMP = Date.now().toString(36)
const NEW_ADMIN = {
  name: "Nadia Qureshi",
  email: `import-${STAMP}@example.org`,
  password: "welcome-to-the-community",
  community: `Imported Jamaat ${STAMP}`,
  bankName: "HDFC Bank",
  fundName: "Monthly subscription",
}
const PASSWORD = "welcome-to-the-community"

const MONTHLY = 150

/* ------------------------------------------------------------------ report */

const results = []
let currentGroup = "import"

function group(name) {
  currentGroup = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

function check(name, ok, detail = "") {
  const entry = { group: currentGroup, name, ok: Boolean(ok), detail: String(detail) }
  results.push(entry)
  const mark = entry.ok ? "\x1b[32m  ok  \x1b[0m" : "\x1b[31m FAIL \x1b[0m"
  console.log(`${mark} ${name}${entry.detail ? ` — ${entry.detail}` : ""}`)
  return entry.ok
}

/* ------------------------------------------------------------------- utils */

async function convexCall(fnPath, args, jwt, kind = "query") {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ path: fnPath, args, format: "json" }),
  })
  const json = await res.json()
  if (json.errorMessage ?? json.error) {
    return { error: String(json.errorMessage ?? json.error) }
  }
  return { value: json.value }
}

const IGNORED_CONSOLE = [
  "Download the React DevTools",
  "[vite] connect",
  "React Router Future Flag Warning",
]

const money = (paise) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((paise ?? 0) / 100)

const has = (text, needle) => text.includes(needle)

let currentScreen = "boot"
const noise = { pageerror: [], console: [], failed: [], http: [] }

function watch(page, tag) {
  page.on("pageerror", (e) =>
    noise.pageerror.push({ screen: tag ?? currentScreen, text: String(e).slice(0, 400) }),
  )
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return
    if (IGNORED_CONSOLE.some((i) => m.text().includes(i))) return
    noise.console.push({ screen: tag ?? currentScreen, text: m.text().slice(0, 400) })
  })
  page.on("requestfailed", (r) =>
    noise.failed.push({ screen: tag ?? currentScreen, url: r.url() }),
  )
  page.on("response", (r) => {
    if (r.status() >= 400) {
      noise.http.push({ screen: tag ?? currentScreen, status: r.status(), url: r.url() })
    }
  })
}

async function settle(page) {
  try {
    await page.waitForSelector("main", { timeout: 25_000 })
  } catch {
    /* recorded by the caller */
  }
  try {
    await page.waitForFunction(
      () => {
        const main = document.querySelector("main")
        if (!main) return false
        return main.querySelector(".animate-spin") === null
      },
      null,
      { timeout: 25_000 },
    )
  } catch {
    /* recorded by the caller */
  }
}

const bodyText = (page) => page.evaluate(() => document.body.innerText ?? "")
const mainText = (page) =>
  page.evaluate(() => document.querySelector("main")?.innerText ?? "")

async function waitForText(page, needle, timeout = 25_000) {
  try {
    await page.waitForFunction(
      (n) => (document.body.innerText ?? "").includes(n),
      needle,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

const sessionToken = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT_"))
    return key ? localStorage.getItem(key) : null
  })

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}

/* --------------------------------------------------------------- csv making */

/** A minimal RFC 4180 writer, matching what `src/lib/csv.ts` emits. */
function csv(header, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return (
    "﻿" +
    [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") +
    "\r\n"
  )
}

const MEMBERS = [
  { name: "Imran Shaikh", email: "imran@example.org" },
  { name: "Ayesha Khan", email: "ayesha@example.org" },
  { name: "Farhan Qureshi", email: "farhan@example.org" },
]

/** Three months of a full grid for three members, two of them paying. */
function contributionsCsv() {
  const rows = []
  for (const month of [1, 2, 3]) {
    for (const [i, m] of MEMBERS.entries()) {
      // Imran pays everything; Ayesha pays months 1 and 3; Farhan pays none.
      const status = i === 0 ? "paid" : i === 1 && month !== 2 ? "paid" : "due"
      const mm = String(month).padStart(2, "0")
      rows.push([
        m.email,
        NEW_ADMIN.fundName,
        2024,
        month,
        MONTHLY,
        status,
        // Day-first, the format the importer documents, and the one an Indian
        // treasurer's spreadsheet will be in.
        status === "paid" ? `10/${mm}/2024` : "",
        "",
      ])
    }
  }
  return csv(
    ["member", "fund", "year", "month", "amount", "status", "paid_at", "note"],
    rows,
  )
}

/* ------------------------------------------------------------------- setup */

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
watch(page)

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex")

/* --------------------------------- 1. a community, built the normal way */

group("setup — a community that can have history imported into it")

currentScreen = "signup"
await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#email", { timeout: 20_000 })
await page.fill("#name", NEW_ADMIN.name)
await page.fill("#community", NEW_ADMIN.community)
await page.fill("#email", NEW_ADMIN.email)
await page.fill("#password", NEW_ADMIN.password)
await page.click('button[type="submit"]')

const onboarded = await waitForText(page, "Set up your community", 25_000)
check("a new community can be created", onboarded, page.url())
if (!onboarded) {
  await browser.close()
  process.exit(1)
}

await page.fill("#bank-name", NEW_ADMIN.bankName)
await page.fill("#fund-name", NEW_ADMIN.fundName)
await page.fill("#monthly", String(MONTHLY))
await page.click('button[type="submit"]')
await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 }).catch(() => {})
await settle(page)

const jwt = await sessionToken(page)
check("the community has a session", Boolean(jwt), jwt ? "jwt present" : "no jwt")

// Members are created through the API rather than the screen: this suite is
// about the import, and a CSV can only name members that already exist. The
// members screen is covered by `visual` and `visual:portal`.
let membersOk = true
for (const m of MEMBERS) {
  const res = await convexCall(
    "members:createMember",
    { name: m.name, email: m.email, joinedYear: 2024, joinedMonth: 1 },
    jwt,
    "mutation",
  )
  if (res.error) {
    membersOk = false
    check(`member ${m.name} created`, false, res.error.slice(0, 140))
  }
}
check("the three members the file will name exist", membersOk, `${MEMBERS.length} members`)

const before = await convexCall("aggregate:shell", {}, jwt)
check(
  "the community starts with nothing in it",
  (before.value?.funds?.[0]?.balancePaise ?? 0) === 0,
  `fund balance ${before.value?.funds?.[0]?.balancePaise ?? "?"} paise`,
)

/* ------------------------------------------ 2. a file that must be refused */

group("import — validation happens before anything is written")

const BAD = csv(
  ["member", "fund", "year", "month", "amount", "status", "paid_at", "note"],
  [
    ["imran@example.org", NEW_ADMIN.fundName, 2024, "01", "150", "paid", "10/01/2024", ""],
    // Three different ways to be wrong in one row, plus one bad row each after.
    ["nobody@example.org", NEW_ADMIN.fundName, 2024, "02", "150", "paid", "10/02/2024", ""],
    ["ayesha@example.org", NEW_ADMIN.fundName, 2024, "13", "150", "due", "", ""],
    ["farhan@example.org", NEW_ADMIN.fundName, 2024, "03", "150.005", "due", "", ""],
    ["farhan@example.org", "No Such Fund", 2024, "03", "150", "due", "", ""],
    ["farhan@example.org", NEW_ADMIN.fundName, 2024, "03", "150", "paid", "", ""],
  ],
)

currentScreen = "import-bad"
await page.goto(`${BASE}/import`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#import-file", { timeout: 20_000 })
check("the import screen is reachable", page.url().endsWith("/import"), page.url())

await page.setInputFiles("#import-file", {
  name: "broken.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(BAD, "utf8"),
})

const refused = await waitForText(page, "This file cannot be imported", 25_000)
check("a file with problems is refused up front", refused, "")

const refusedText = await bodyText(page)
check(
  "the unknown member is named",
  has(refusedText, "nobody@example.org"),
  "",
)
check("the impossible month is named", has(refusedText, "13"), "")
check("the un-roundable amount is named", has(refusedText, "150.005"), "")
check("the unknown fund is named", has(refusedText, "No Such Fund"), "")
check("the paid row with no date is named", has(refusedText, "paid_at"), "")

const importButton = await page
  .getByRole("button", { name: /^Import \d+ record/ })
  .count()
check(
  "the import button does not exist while the file is broken",
  importButton === 0,
  `${importButton} matching buttons`,
)
check(
  "the screen says why the button is missing",
  has(refusedText, "a ledger cannot be un-imported"),
  "",
)
await shot(page, "import-refused")

const afterRefusal = await convexCall("aggregate:shell", {}, jwt)
check(
  "and still nothing was written",
  (afterRefusal.value?.funds?.[0]?.balancePaise ?? 0) === 0,
  `fund balance ${afterRefusal.value?.funds?.[0]?.balancePaise ?? "?"} paise`,
)

/* ------------------------------------------ 3. a file that must be accepted */

group("import — a real grid, through the screen")

const GOOD = contributionsCsv()
currentScreen = "import-good"
await page.setInputFiles("#import-file", {
  name: "contributions-2024.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(GOOD, "utf8"),
})

const ready = await waitForText(page, "Ready to import", 25_000)
check(
  "a clean file is accepted",
  ready,
  ready
    ? ""
    : (await bodyText(page))
        .split("\n")
        .filter((l) => l.includes("row ") || l.includes("cannot be imported"))
        .slice(0, 5)
        .join(" | "),
)

const previewText = await bodyText(page)
check(
  "the preview recognises it as a contribution grid",
  has(previewText, "Recognised as contribution grid"),
  "",
)
check(
  "and says how many rows it found",
  has(previewText, `${MEMBERS.length * 3} rows`),
  "",
)
check(
  "the preview explains that paid months are replayed, before it happens",
  has(previewText, "oldest first"),
  "",
)
await shot(page, "import-preview")

const preview = await convexCall(
  "imports:previewImport",
  { text: GOOD },
  jwt,
)
check(
  "the server's own preview agrees",
  preview.value?.ok === true && preview.value?.summary?.contributions === 9,
  preview.value?.ok
    ? `contributions=${preview.value?.summary?.contributions}`
    : // Name the first few problems, so a failure says what is wrong with the
      // file rather than only that there is something wrong with it.
      `${(preview.value?.issues ?? [])
        .slice(0, 4)
        .map((i) => `row ${i.row} ${i.field}: ${i.message}`)
        .join(" | ")}`,
)

currentScreen = "import-commit"
await page.getByRole("button", { name: /^Import \d+ record/ }).click()
const done = await waitForText(page, "records written", 40_000)
check("the import commits", done, "")

const afterText = await bodyText(page)
check(
  "the screen reports what it wrote",
  has(afterText, "9 contributions") && has(afterText, "5 payments"),
  afterText.split("\n").filter((l) => /contribution|payment/.test(l)).join(" / "),
)
check(
  "and the receipt numbers it issued",
  /receipts R-\d+/.test(afterText),
  (afterText.match(/receipts [^\n]+/) ?? ["none"])[0],
)
check(
  "and tells the treasurer which month the reassigned payment landed on",
  has(afterText, "oldest unpaid month") || has(afterText, "oldest due first"),
  "",
)
await shot(page, "import-done")

/* ---------------------------------------- 4. the books are actually right */

group("import — the books are correct, not merely populated")

const after = await convexCall("aggregate:shell", {}, jwt)
const fund = (after.value?.funds ?? []).find((f) => f.name === NEW_ADMIN.fundName)
const bank = (await convexCall("data:listBanks", {}, jwt)).value ?? []

// 9 rows of ₹150. Imran paid 3, Ayesha paid 2, Farhan paid 0 → 5 × ₹150.
const expected = 5 * MONTHLY * 100
check(
  "the fund balance is the sum of the paid rows, and nothing else",
  fund?.balancePaise === expected,
  `${money(fund?.balancePaise)} — expected ${money(expected)}`,
)

// Year 2024, because that is the year the file said. `bankPassbook` defaults
// to the current year, and asking it for the wrong one returns a correctly
// zeroed empty passbook — which would have "passed" a closing-balance check
// while the entries were sitting in a different year entirely.
const passbook = await convexCall(
  "aggregate:bankPassbook",
  { bankId: bank[0]?.id, year: 2024 },
  jwt,
)
check(
  "the bank passbook for 2024 carries the imported money",
  passbook.value?.closingPaise === expected,
  `closing ${money(passbook.value?.closingPaise)}`,
)
check(
  "every imported entry landed in the year the file said, not today",
  passbook.value?.entries?.length === 5 &&
    (passbook.value?.entries ?? []).every((e) => e.date.startsWith("2024")),
  `${passbook.value?.entries?.length} entries: ${(passbook.value?.entries ?? [])
    .slice(0, 2)
    .map((e) => e.date.slice(0, 10))
    .join(", ")}`,
)

const passbookThisYear = await convexCall(
  "aggregate:bankPassbook",
  { bankId: bank[0]?.id },
  jwt,
)
check(
  "and the current year is empty, rather than everything dated today",
  (passbookThisYear.value?.entries ?? []).length === 0,
  `${(passbookThisYear.value?.entries ?? []).length} entries dated today`,
)

const grid = await convexCall("aggregate:grid", { year: 2024 }, jwt)
const gridRows = grid.value?.rows ?? []
check(
  "the collection grid can read the imported months",
  gridRows.length === 3,
  `${gridRows.length} members in the grid`,
)

// A member who paid every month must be paid in every cell; a member who paid
// none must be in arrears for all three. This is the assertion that the replay
// settled the right month rather than merely settling *something*.
const cellsFor = (name) =>
  (gridRows.find((r) => r.name === name)?.cells ?? [])
    .filter(Boolean)
    .map((c) => `${c.month}:${c.status}`)
    .join(" ")

const imranCells = cellsFor(MEMBERS[0].name)
const ayeshaCells = cellsFor(MEMBERS[1].name)
const farhanCells = cellsFor(MEMBERS[2].name)

check(
  "a member who paid every month is paid in every month",
  imranCells === "1:paid 2:paid 3:paid",
  imranCells,
)
check(
  "a member who paid nothing is in arrears for all three",
  farhanCells === "1:due 2:due 3:due",
  farhanCells,
)

// Ayesha's file said January and March paid, leaving February open. The ledger
// settles the oldest due first, so the March payment landed on February and
// March is still due.
//
// The earlier version of the importer forced the file's stated status onto
// March instead, which showed her as paid for all three months — a grid
// claiming ₹450 from a member who had paid ₹300. This is the one assertion in
// the suite that exists because that bug was found, so it is stated exactly:
// **a month is only ever paid because a payment settled it.**
check(
  "a payment lands on the oldest unpaid month, not the month the file names",
  ayeshaCells === "1:paid 2:paid 3:due",
  `Ayesha: ${ayeshaCells} — the file said January and March paid`,
)
check(
  "and the grid never shows more collected than arrived",
  (gridRows.find((r) => r.name === MEMBERS[1].name)?.paidPaise ?? 0) <=
    (gridRows.find((r) => r.name === MEMBERS[1].name)?.paidCount ?? 0) * MONTHLY * 100,
  `Ayesha paidCount/paidPaise: ${gridRows.find((r) => r.name === MEMBERS[1].name)?.paidCount} / ${money(
    gridRows.find((r) => r.name === MEMBERS[1].name)?.paidPaise,
  )}`,
)

const verify = await convexCall("balances:verify", {}, jwt)
check(
  "the materialised balances still equal the sum of the ledger",
  verify.value?.ok === true,
  verify.error
    ? verify.error.slice(0, 140)
    : `${verify.value?.scopesChecked ?? "?"} scopes, ${verify.value?.ledgerEntries ?? "?"} entries`,
)

const audit = await convexCall("aggregate:audit", { limit: 20 }, jwt)
check(
  "the import is in the audit log",
  (audit.value ?? []).some((a) => a.action === "import.contributions"),
  (audit.value ?? []).slice(0, 4).map((a) => a.action).join(", "),
)

/* ------------------------------------------------- 5. the dashboard shows it */

group("import — the dashboard reflects it")

currentScreen = "dashboard"
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
await settle(page)
const dash = await mainText(page)
check("the dashboard renders", dash.length > 100, `${dash.length} chars`)
check(
  "and shows the imported money",
  has(dash, money(expected)) || has(await bodyText(page), money(expected)),
  `looking for ${money(expected)}`,
)
check(
  "and counts the members it was given",
  has(await bodyText(page), "3 members"),
  "",
)
await shot(page, "import-dashboard")

/* -------------------------------------------------- 6. importing it again */

group("import — the same file twice")

const again = await convexCall(
  "imports:runImport",
  { text: GOOD, batchKey: sha(GOOD) },
  jwt,
  "mutation",
)
check(
  "a second import of the same file reports success",
  again.value?.ok === true,
  again.error ? again.error.slice(0, 140) : "",
)

const twice = await convexCall("aggregate:shell", {}, jwt)
const fundTwice = (twice.value?.funds ?? []).find((f) => f.name === NEW_ADMIN.fundName)
check(
  "and does not count it twice",
  fundTwice?.balancePaise === expected,
  `${money(fundTwice?.balancePaise)} — expected ${money(expected)}`,
)

check(
  "the second import skipped the months that already existed",
  again.value?.skipped > 0,
  `skipped ${again.value?.skipped}`,
)

/* ------------------------------------------------------- 7. the other org */

group("import — isolation")

await page.evaluate(() => window.localStorage.clear())
await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#email", { timeout: 20_000 })
await page.fill("#email", "treasurer@jamaat.org")
await page.fill("#password", DEMO_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
await settle(page)
const demoToken = await sessionToken(page)

const demoShell = await convexCall("aggregate:shell", {}, demoToken)
check(
  "the demo community still sees only its own money",
  demoShell.value?.orgName === "Jamaat Anjuman" &&
    (demoShell.value?.funds ?? []).every((f) => f.balancePaise !== expected),
  `demo total ${money(demoShell.value?.totalBalance)}`,
)

const demoFunds = await convexCall("aggregate:funds", {}, demoToken)
check(
  "the imported fund is not in the demo community's list",
  !(demoFunds.value ?? []).some((f) => f.name === NEW_ADMIN.fundName),
  `${(demoFunds.value ?? []).length} demo funds`,
)

const viewerToken = await convexCall(
  "auth:signIn",
  {
    provider: "password",
    params: { flow: "signIn", email: "farhan@jamaat.org", password: DEMO_PASSWORD },
  },
  undefined,
  "action",
)
const viewerJwt = viewerToken.value?.tokens?.token
const viewerImport = await convexCall(
  "imports:runImport",
  { text: GOOD, batchKey: sha(GOOD) },
  viewerJwt,
  "mutation",
)
check(
  "a viewer cannot import — it writes to the ledger",
  Boolean(viewerImport.error) && /treasurer access required/i.test(viewerImport.error),
  viewerImport.error ? "refused" : "ALLOWED",
)

const anon = await convexCall(
  "imports:previewImport",
  { text: GOOD },
  null,
)
check("an anonymous caller cannot even preview", Boolean(anon.error), anon.error?.slice(0, 100))

/* --------------------------------------------------------- 8. clean up */

group("import — leaving nothing behind")

const deleted = await convexCall("orgs:deleteOrganization", {}, jwt, "mutation")
check(
  "the imported community deletes itself",
  !deleted.error && deleted.value?.removed > 0,
  deleted.error ? deleted.error.slice(0, 140) : `removed ${deleted.value?.removed} rows`,
)

const demoAfter = await convexCall("aggregate:shell", {}, demoToken)
check(
  "the demo community is exactly as it was",
  demoAfter.value?.orgName === "Jamaat Anjuman" &&
    (demoAfter.value?.funds ?? []).length === 6,
  `${(demoAfter.value?.funds ?? []).length} funds`,
)

/* --------------------------------------------------------- browser noise */

group("browser noise")

check(
  "no uncaught page errors during the whole run",
  noise.pageerror.length === 0,
  noise.pageerror.map((e) => e.text).join(" | ").slice(0, 200),
)
check(
  "no unexpected console errors",
  noise.console.length === 0,
  noise.console.map((e) => e.text).join(" | ").slice(0, 200),
)
check(
  "no failed requests",
  noise.failed.length === 0,
  noise.failed.map((e) => e.url).join(" | ").slice(0, 200),
)

await browser.close()

/* ----------------------------------------------------------------- report */

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed

const md = []
md.push("# CSV import report (M6)")
md.push("")
md.push(`Base URL: \`${BASE}\`  ·  Convex: \`${CONVEX}\``)
md.push("")
md.push(`**${passed} passed, ${failed} failed** of ${results.length} checks.`)
md.push("")
md.push("## Checks")
md.push("")
let lastGroup = null
for (const r of results) {
  if (r.group !== lastGroup) {
    md.push(`\n### ${r.group}\n`)
    lastGroup = r.group
  }
  md.push(`- ${r.ok ? "PASS" : "**FAIL**"} — ${r.name}${r.detail ? ` _(${r.detail})_` : ""}`)
}
md.push("")
md.push("## Browser noise")
md.push("")
md.push("```json")
md.push(JSON.stringify(noise, null, 2))
md.push("```")

await writeFile(path.join(OUT, "import-report.md"), md.join("\n"))
await writeFile(
  path.join(OUT, "import-report.json"),
  JSON.stringify({ base: BASE, results, noise }, null, 2),
)

console.log(
  `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m — report in ${OUT}/import-report.md`,
)
process.exit(failed === 0 ? 0 : 1)
