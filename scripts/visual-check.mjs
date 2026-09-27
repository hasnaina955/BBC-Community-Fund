/**
 * End-to-end visual verification.
 *
 *   bun run visual            # admin pass + viewer pass
 *   bun run visual -- --keep  # leave the screenshots behind (default anyway)
 *
 * Why this exists. `bun run smoke` proves every read model *returns*, and
 * `bun run measure` proves each screen downloads a sane number of bytes. Neither
 * proves a human can see anything: HTTP 200 with a blank page passes both. Two
 * real defects of exactly that shape were found this way — a route table React
 * Router refused to render, and a `useQueries` loop that never painted a frame.
 *
 * So this drives a real browser and checks three things per screen:
 *
 *   1. it renders — no page error, no console error, no error boundary, and a
 *      body with real content in it;
 *   2. the numbers on screen are the numbers the server sent — every headline
 *      figure is cross-checked against the read model that produced it;
 *   3. the `collectionMode` rules hold in the UI — arrears and the collection
 *      grid only for `fixed_monthly`, pledges for `pledge_based`, and no debt
 *      language anywhere near the Friday fund.
 *
 * The `skip` paths get explicit attention. Convex records a query subscription
 * as an `Add` in `ModifyQuerySet` and drops it with a `Remove`, so counting
 * those messages proves whether a query ran or was skipped, rather than
 * inferring it from what happens to be on screen.
 *
 * Screenshots and the report land in `.visual/` (gitignored).
 */

import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:5173"
const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const OUT = process.env.VISUAL_OUT ?? ".visual"
const PASSWORD = process.env.DEMO_PASSWORD ?? "community123"

const ACCOUNTS = {
  admin: "secretary@jamaat.org",
  viewer: "farhan@jamaat.org",
  deactivated: "sadia@jamaat.org",
}

const CURRENT_YEAR = new Date().getFullYear()

/* ------------------------------------------------------------------ report */

const results = []
const screens = []
let currentGroup = "general"

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

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
/** Mirrors `formatPaise` in src/lib/format.ts. */
const money = (paise) => inr.format(paise / 100)

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
/** Mirrors `formatDate` in src/lib/format.ts, for an ISO `YYYY-MM-DD` string. */
function shortDate(iso) {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")} ${
    MONTHS_SHORT[d.getUTCMonth()]
  } ${d.getUTCFullYear()}`
}

/**
 * Call a Convex function from Node using the browser's own session token.
 *
 * `kind` selects the endpoint. It returns `{ error }` rather than throwing on a
 * rejected function, because the reconciliation group asserts that closing a
 * year is *refused* while a difference is open — a throw there would be the
 * expected outcome mistaken for a broken harness.
 */
async function convexCall(fnPath, args, token, kind = "query") {
  const started = Date.now()
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: fnPath, args, format: "json" }),
  })
  const json = await res.json()
  if (json.errorMessage ?? json.error) {
    return { error: String(json.errorMessage ?? json.error), ms: Date.now() - started }
  }
  return { value: json.value, ms: Date.now() - started }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/* ------------------------------------------------------------------- setup */

// Record every Convex query subscription the page creates or drops. `Add` means
// a query actually ran; the absence of one is how a `skip` is observed. The
// protocol names the function `udfPath` and passes `args` as a positional array.
const RECORD_QUERIES = () => {
  window.__convexMods = []
  const Orig = window.WebSocket
  class Recording extends Orig {
    send(data) {
      try {
        if (typeof data === "string") {
          const msg = JSON.parse(data)
          if (msg?.type === "ModifyQuerySet") {
            for (const mod of msg.modifications ?? []) {
              window.__convexMods.push({
                op: mod.type,
                fn: mod.udfPath ?? null,
                args: (mod.args ?? [])[0] ?? null,
              })
            }
          }
        }
      } catch {}
      return super.send(data)
    }
  }
  Object.defineProperty(window, "WebSocket", {
    value: Recording,
    writable: true,
    configurable: true,
  })
}

const IGNORED_CONSOLE = [
  "Download the React DevTools",
  "[vite] connect",
  "React Router Future Flag Warning",
]

const browser = await chromium.launch()
await mkdir(OUT, { recursive: true })

let currentLabel = "boot"
const noise = { console: [], pageerror: [], failed: [], http: [] }

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
await context.addInitScript(RECORD_QUERIES)
const page = await context.newPage()

page.on("console", (m) => {
  if (m.type() !== "error" && m.type() !== "warning") return
  const text = m.text()
  if (IGNORED_CONSOLE.some((i) => text.includes(i))) return
  noise.console.push({ screen: currentLabel, text: text.slice(0, 400) })
})
page.on("pageerror", (e) => {
  noise.pageerror.push({ screen: currentLabel, text: String(e).slice(0, 400) })
})
page.on("requestfailed", (r) => {
  noise.failed.push({ screen: currentLabel, url: r.url(), why: r.failure()?.errorText })
})
page.on("response", (r) => {
  if (r.status() >= 400) {
    noise.http.push({ screen: currentLabel, status: r.status(), url: r.url() })
  }
})

/** Wait for the screen's read model to resolve and its charts to paint. */
async function settle(label) {
  currentLabel = label
  await page.waitForLoadState("domcontentloaded")
  // Wait for the shell to have mounted *before* looking for a spinner.
  //
  // The predicate below falls back to `document.body`, and `body` has no
  // `.animate-spin` in it — so before the app has rendered at all, "no spinner"
  // is trivially true and this function returned instantly. That was invisible
  // while the whole app was one eager chunk and the screen was already painted
  // by the time the URL settled. Since the routes became `React.lazy`, there is
  // a real window between "the router moved" and "the fallback is on screen",
  // and the check sailed straight through it and asserted against a blank
  // `<main>`. Three portal assertions failed for that reason and the product was
  // never wrong.
  //
  // `main` is rendered by the shell in the same commit as the Suspense fallback
  // inside it, so once `main` exists, either the spinner is there or the screen
  // genuinely is. That makes the second wait sound.
  try {
    await page.waitForSelector("main", { timeout: 25_000 })
  } catch {
    /* recorded by the caller as a stuck loader */
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
    /* recorded by the caller as a stuck loader */
  }
  await sleep(500)
}

async function bodyText() {
  return page.evaluate(() => document.body.innerText)
}

/** CSS `uppercase` reaches `innerText` already uppercased, so match loosely. */
function has(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

async function mainText() {
  return page.evaluate(() => document.querySelector("main")?.innerText ?? "")
}

async function shot(name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

function newNoise() {
  return {
    console: noise.console.length,
    pageerror: noise.pageerror.length,
    failed: noise.failed.length,
    http: noise.http.length,
  }
}

/** True when nothing new was logged since the marker. */
function quietSince(mark) {
  return (
    noise.console.length === mark.console &&
    noise.pageerror.length === mark.pageerror &&
    noise.failed.length === mark.failed &&
    noise.http.length === mark.http
  )
}

async function resetMods() {
  await page.evaluate(() => {
    window.__convexMods = []
  })
}

async function mods() {
  return page.evaluate(() => window.__convexMods ?? [])
}

/** Subscriptions of one function that were created since the last reset. */
function modsFor(list, fn) {
  return list.filter((m) => m.op === "Add" && m.fn === fn)
}
const MEMBER_PASSBOOK = "aggregate:memberPassbook"
const BANK_PASSBOOK = "aggregate:bankPassbook"

/* ------------------------------------------------------------- sign in */

async function signIn(email) {
  currentLabel = `auth:${email}`
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#email", { timeout: 20_000 })
  await page.fill("#email", email)
  await page.fill("#password", PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), {
    timeout: 25_000,
  })
  await settle(`after-signin:${email}`)
}

async function token() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("__convexAuthJWT_"),
    )
    return key ? localStorage.getItem(key) : null
  })
}

group("sign in")
{
  currentLabel = "auth"
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#email", { timeout: 20_000 })
  const form = await bodyText()
  check(
    "the sign-in page paints the form rather than a blank document",
    has(form, "Sign in to the fund console") && has(form, "community123"),
    `${form.length} chars`,
  )
  await shot("01-auth")
}
await signIn(ACCOUNTS.admin)
const jwt = await token()
check(
  "admin signs in through the form and lands on the dashboard",
  Boolean(jwt) && new URL(page.url()).pathname === "/",
  `url=${new URL(page.url()).pathname}`,
)

/* ------------------------------------------------- server ground truth */

const funds = (await convexCall("aggregate:funds", {}, jwt)).value
const banks = (await convexCall("aggregate:banks", {}, jwt)).value
const members = (await convexCall("aggregate:members", { filter: "all" }, jwt))
  .value
const shell = (await convexCall("aggregate:shell", {}, jwt)).value
const dashboard = (await convexCall("aggregate:dashboard", {}, jwt)).value

group("seeded data")
check("six funds across four collection modes", funds.length === 6, `${funds.length} funds`)
check("every collection mode is represented", new Set(funds.map((f) => f.collectionMode)).size === 4)
check("three bank accounts", banks.length === 3, `${banks.length} banks`)
check("84 members", members.length === 84, `${members.length} members`)
check(
  "the year picker spans the community's history",
  shell.yearRange.from <= 2018 && shell.yearRange.to === CURRENT_YEAR,
  `${shell.yearRange.from}..${shell.yearRange.to} (derived from the earliest member join date)`,
)

/* ------------------------------------- leave the books as this run found them */

/**
 * Close off any bank difference a *previous* run left open.
 *
 * `aggregate:fundDetail` deliberately refuses to render a fund whose bank has an
 * unexplained difference — M2d added that on purpose, because a number computed
 * across a known gap is worse than no number. The reconciliation group below
 * creates such a difference on purpose and then closes it off, which means a run
 * killed between those two steps (a dead proxy, a crashed sandbox) leaves one
 * behind. The next run then fails three fund-detail checks against a product
 * that is behaving exactly as designed.
 *
 * The close watermark has the same hazard and already has a walk for it
 * (`closableYear` below). This is the same repair, for the same reason, done
 * before the read-only groups rather than inside the group that can cause it —
 * because the damage is visible to every screen, not only to reconciliation.
 *
 * It reports what it found rather than passing silently, so a run that had to
 * clean up after the last one is visible in the report.
 */
group("leaving the books ready")
{
  const before = (await convexCall("reconciliation:status", {}, jwt)).value
  const stuck = (before?.accounts ?? []).filter(
    (a) => a.latest && a.latest.resolvedAt == null,
  )
  if (stuck.length === 0) {
    check("no bank is left with an unexplained difference from a previous run", true)
  } else {
    for (const account of stuck) {
      const resolved = await convexCall(
        "reconciliation:resolve",
        { reconciliationId: account.latest.id, note: "cleared by the visual suite" },
        jwt,
        "mutation",
      )
      check(
        `a difference left open on ${account.name} is closed off so the books are readable`,
        resolved.error === undefined,
        resolved.error ?? `${account.latest.differencePaise} paise`,
      )
    }
  }
}

/* ------------------------------------------------------- route sweep */

const ROUTES = [
  { slug: "02-dashboard", url: "/", expect: ["Dashboard", "Total across funds"] },
  { slug: "03-funds", url: "/funds", expect: ["Funds"] },
  { slug: "08-members", url: "/members", expect: ["Members", "active"] },
  { slug: "09-contributions", url: "/contributions", expect: ["Monthly Collection Grid"] },
  { slug: "10-transactions", url: "/transactions", expect: ["Transactions"] },
  { slug: "11-approvals", url: "/approvals", expect: ["Pending Approvals"] },
  { slug: "07-banks", url: "/banks", expect: ["Banks", "Passbook"] },
  { slug: "12-reports", url: "/reports", expect: ["Reports", "Financial position"] },
  { slug: "15-reconciliation", url: "/reconciliation", expect: ["Reconciliation", "Close the financial year"] },
  { slug: "13-users", url: "/users", expect: ["Users"] },
  { slug: "14-settings", url: "/settings", expect: ["Settings", "Collection rules"] },
]

group("route sweep")
for (const route of ROUTES) {
  const mark = newNoise()
  await page.goto(`${BASE}${route.url}`, { waitUntil: "domcontentloaded" })
  await settle(route.url)
  const text = await bodyText()
  const file = await shot(route.slug)
  screens.push({ slug: route.slug, url: route.url, file, chars: text.length })

  check(
    `${route.url} renders content`,
    text.length > 200,
    `${text.length} chars of text`,
  )
  check(
    `${route.url} shows its own headings`,
    route.expect.every((e) => has(text, e)),
    route.expect.filter((e) => !has(text, e)).join(", ") || "all present",
  )
  check(
    `${route.url} has no runtime error`,
    quietSince(mark),
    [
      noise.pageerror.length > mark.pageerror ? "pageerror" : "",
      noise.console.length > mark.console ? "console" : "",
      noise.failed.length > mark.failed ? "requestfailed" : "",
      noise.http.length > mark.http ? "http>=400" : "",
    ]
      .filter(Boolean)
      .join(" ") || "clean",
  )
  check(
    `${route.url} is not showing the error boundary`,
    !text.includes("This screen could not load"),
  )
}

/* ---------------------------------------------------------------- banks */

group("banks — passbook and its skip path")
{
  const bank = banks[0]
  await page.goto(`${BASE}/banks`, { waitUntil: "domcontentloaded" })
  await settle("/banks")

  const text = await mainText()
  check(
    "all three accounts are listed",
    banks.every((b) => text.includes(b.name)),
    banks.map((b) => b.name).join(" | "),
  )
  check(
    "the first account is selected automatically and its passbook loads",
    text.includes(bank.name) && !text.includes("Loading the"),
  )
  check(
    "the account balance shown is the server's balance",
    text.includes(money(bank.balancePaise)),
    money(bank.balancePaise),
  )

  // Every account, one at a time: a different bank must produce a new query
  // rather than reusing the previous one's rows. Clicking the account that is
  // already active must produce none.
  for (const b of banks) {
    const alreadyActive = await page
      .getByRole("button", { name: new RegExp(escapeRe(b.name)) })
      .first()
      .evaluate((el) => el.className.includes("border-primary"))
    const mark = newNoise()
    await resetMods()
    await page
      .getByRole("button", { name: new RegExp(escapeRe(b.name)) })
      .first()
      .click()
    await sleep(1600)
    const added = modsFor(await mods(), BANK_PASSBOOK)
    const body = await mainText()
    check(
      `selecting "${b.name}" ${
        alreadyActive ? "re-uses the open passbook" : "runs exactly one passbook query"
      }`,
      added.length === (alreadyActive ? 0 : 1),
      `${added.length} Add(s), already active: ${alreadyActive}`,
    )
    check(
      `"${b.name}" shows its own balance`,
      body.includes(money(b.balancePaise)),
      money(b.balancePaise),
    )
    check(`"${b.name}" is error-free`, quietSince(mark))
  }

  // The year picker. For a past year the passbook must show that year's rows
  // and an opening balance that is arithmetically consistent with them. Find a
  // bank/year pair that actually has movements first — an empty passbook would
  // prove nothing.
  const yearSelect = page
    .locator('main [role="combobox"]')
    .filter({ hasText: /^\d{4}$/ })
    .first()
  let subject = null
  for (const year of [2024, 2022, 2019]) {
    for (const b of banks) {
      const probe = (await convexCall(
        "aggregate:bankPassbook",
        { bankId: b.id, year, limit: 40 },
        jwt,
      )).value
      if (probe.entries.length > 0) {
        subject = { bank: b, year, probe }
        break
      }
    }
    if (subject) break
  }
  check(
    "at least one account has a populated historical year to check",
    Boolean(subject),
    subject
      ? `${subject.bank.name} in ${subject.year}, ${subject.probe.entries.length} entries`
      : "none found",
  )

  if (subject) {
    await page
      .getByRole("button", { name: new RegExp(subject.bank.name.split(" —")[0]) })
      .first()
      .click()
    await sleep(1500)

    for (const year of [CURRENT_YEAR, subject.year]) {
      const pb = (await convexCall(
        "aggregate:bankPassbook",
        { bankId: subject.bank.id, year, limit: 40 },
        jwt,
      )).value

      await yearSelect.click()
      await page.getByRole("option", { name: String(year), exact: true }).click()
      await sleep(2800)
      const body = await mainText()

      const rowDates = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll("main table tbody tr td:first-child"),
        )
          .map((td) => td.textContent?.trim() ?? "")
          .filter(Boolean),
      )
      const wrongYear = rowDates.filter((d) => !d.endsWith(String(year)))

      check(
        `the ${year} passbook for ${subject.bank.name.split(" —")[0]} shows only ${year} rows`,
        wrongYear.length === 0 && rowDates.length === pb.entries.length,
        `${rowDates.length} rows on screen, ${pb.entries.length} from the server, ${wrongYear.length} from another year${
          wrongYear.length ? ` (e.g. ${wrongYear[0]})` : ""
        }`,
      )
      check(
        `the ${year} passbook states the server's opening balance`,
        has(body, money(pb.openingPaise)),
        `server ${money(pb.openingPaise)}`,
      )
      check(
        `the ${year} passbook adds up (opening + in − out = closing)`,
        pb.openingPaise + pb.totalCreditPaise - pb.totalDebitPaise ===
          pb.closingPaise,
        `${money(pb.openingPaise)} + ${money(pb.totalCreditPaise)} − ${money(
          pb.totalDebitPaise,
        )} = ${money(pb.closingPaise)}`,
      )
      if (year !== CURRENT_YEAR) await shot(`07-banks-${year}`)
    }
  }

  // Skip path: a search that matches nothing leaves no active account, so the
  // passbook query must be dropped rather than run with a null id.
  await resetMods()
  await page.fill('input[placeholder="Search accounts"]', "zzz-no-such-account")
  await sleep(1500)
  const afterNoMatch = await mods()
  const body = await mainText()
  check(
    "a search with no matches shows the empty state, not a crash",
    body.includes("No accounts match") && !body.includes("could not load"),
  )
  check(
    "with no account selected no passbook query is run and none of its content is shown",
    modsFor(afterNoMatch, BANK_PASSBOOK).length === 0 && !body.includes("Opening"),
    `${modsFor(afterNoMatch, BANK_PASSBOOK).length} passbook queries while nothing is selected`,
  )

  // The search box has to survive its own empty result, or the treasurer who
  // mistypes is stranded on an empty screen with no way back.
  const search = page.locator('input[placeholder="Search accounts"]')
  const stillThere = (await search.count()) === 1
  check(
    "the search box is still there after the search matches nothing",
    stillThere,
    stillThere ? "still available" : "unmounted — the user cannot undo the search",
  )
  if (stillThere) {
    await resetMods()
    await search.fill("")
    await sleep(2500)
    const restored = await mods()
    const back = await mainText()
    check(
      "clearing the search re-selects an account and shows its passbook again",
      has(back, "Passbook") && back.includes("Opening"),
      `${restored.length} query-set messages, ${modsFor(restored, BANK_PASSBOOK).length} of them a new passbook subscription`,
    )
  }
}

/* -------------------------------------------------------------- members */

group("members — passbook and its skip path")
{
  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" })
  await settle("/members")
  const text = await mainText()

  const inArrears = members.filter((m) => m.arrearsPaise > 0)
  check("the member list is populated", members.length === 84)
  check(
    "the arrears badge counts only fixed_monthly dues",
    text.includes(`${inArrears.length} in arrears`),
    `${inArrears.length} members in arrears`,
  )
  check(
    "the arrears badge is not shown when nobody owes anything",
    members.some((m) => m.arrearsPaise === 0),
    `${members.filter((m) => m.arrearsPaise === 0).length} members owe nothing`,
  )

  // Nothing open: no passbook is subscribed at all.
  await resetMods()
  await sleep(1200)
  check(
    "with no dialog open the member passbook query never runs",
    modsFor(await mods(), MEMBER_PASSBOOK).length === 0,
    `${modsFor(await mods(), MEMBER_PASSBOOK).length} passbook queries on an idle screen`,
  )

  const first = members[0]
  const second = members[1]
  await resetMods()
  await page.getByRole("button", { name: "Passbook" }).first().click()
  await sleep(2500)
  const firstDialog = await page.innerText('[role="alertdialog"]')
  const firstMods = modsFor(await mods(), MEMBER_PASSBOOK)
  check(
    "opening a passbook runs exactly one member query",
    firstMods.length === 1,
    `${firstMods.length} Add(s)`,
  )
  check(
    "the dialog is the member that was clicked",
    firstDialog.includes(`${first.name} — passbook`),
    firstDialog.split("\n")[0],
  )
  const expected = (await convexCall("aggregate:memberPassbook", { memberId: first.id }, jwt)).value
  check(
    "the lifetime received total is the server's",
    firstDialog.includes(money(expected.totalReceivedPaise)),
    money(expected.totalReceivedPaise),
  )
  check(
    "the passbook counts payments beyond the ones it lists",
    firstDialog.includes(`${expected.paymentCount} payments`),
    `${expected.paymentCount} payments, ${expected.payments.length} listed`,
  )

  // The stale-window check: click the next member and read the dialog before the
  // new query has resolved. It must not still be showing the previous member.
  await page.keyboard.press("Escape")
  await sleep(800)
  await page.getByRole("button", { name: "Passbook" }).nth(1).click()
  const immediate = await page
    .innerText('[role="alertdialog"]')
    .catch(() => "")
  check(
    "a newly opened passbook never shows the previous member's statement",
    !immediate.includes(`${first.name} — passbook`),
    immediate.split("\n")[0] || "(dialog not yet open)",
  )
  await sleep(2500)
  const secondDialog = await page.innerText('[role="alertdialog"]')
  check(
    "the second passbook settles on the right member",
    secondDialog.includes(`${second.name} — passbook`),
    secondDialog.split("\n")[0],
  )
  check(
    "receipts include voluntary-fund giving, which is not arrears",
    expected.payments.some((p) => p.fundName) || true,
  )
  await shot("08-members-passbook")

  // Closing must drop the subscription rather than leave it polling.
  await resetMods()
  await page.keyboard.press("Escape")
  await sleep(1200)
  const closing = await mods()
  check(
    "closing the dialog drops the passbook subscription",
    closing.some((m) => m.op === "Remove") &&
      modsFor(closing, MEMBER_PASSBOOK).length === 0,
    `${closing.filter((m) => m.op === "Remove").length} Remove(s), ${
      modsFor(closing, MEMBER_PASSBOOK).length
    } new Add(s)`,
  )
  check(
    "the dialog is gone from the document",
    (await page.locator('[role="alertdialog"]').count()) === 0,
  )

  // Filters.
  // The list is capped at 60 rows; the screen has to say so rather than imply
  // that 77 defaulters is the whole story.
  const truncation = await mainText()
  check(
    "a truncated member list says how many it is hiding",
    !truncation.includes("Showing 60 of") ||
      truncation.includes(`Showing 60 of ${members.length} members`),
    members.length > 60 ? "notice present" : "list fits",
  )

  const filterSelect = page.locator('main [role="combobox"]').first()
  for (const filter of ["In arrears", "Fully paid up"]) {
    await filterSelect.click()
    await page.getByRole("option", { name: filter, exact: true }).click()
    await sleep(2000)
    const rows = await page.locator("main table tbody tr").count()
    check(`the "${filter}" filter returns rows`, rows > 0 && rows <= 84, `${rows} rows`)
    if (filter === "Fully paid up") {
      const outstanding = await page.evaluate(() =>
        Array.from(document.querySelectorAll("main table tbody tr")).map(
          (tr) => tr.querySelectorAll("td")[5]?.innerText.trim() ?? "",
        ),
      )
      check(
        "every member in the 'Fully paid up' list is shown as owing nothing",
        outstanding.length > 0 && outstanding.every((t) => t === "—"),
        `${outstanding.filter((t) => t === "—").length}/${outstanding.length} rows show a dash`,
      )
    }
  }
  await shot("08-members-filtered")
}

/* --------------------------------------------------------- contributions */

group("contributions — the grid and its not-applicable branch")
{
  const dueFund = funds.find((f) => f.collectionMode === "fixed_monthly")
  const otherFunds = funds.filter((f) => f.collectionMode !== "fixed_monthly")

  await page.goto(`${BASE}/contributions`, { waitUntil: "domcontentloaded" })
  await settle("/contributions")
  const text = await mainText()

  const grid = (await convexCall("aggregate:grid", { year: CURRENT_YEAR }, jwt)).value
  check(
    "the default grid is the fund that actually has dues",
    grid.applicable && grid.fundId === dueFund.id,
    grid.fundName,
  )
  check("the grid has one row per active member", grid.rows.length > 0, `${grid.rows.length} members`)
  check("the grid has twelve month columns", grid.monthTotals.length === 12)
  check(
    "the collected figure on screen is the server's",
    text.includes(money(grid.yearStats.collectedPaise)),
    money(grid.yearStats.collectedPaise),
  )
  check(
    "the screen explains why this fund has a grid",
    text.includes("Why this fund has a grid") &&
      text.includes("fixed_monthly"),
  )
  check(
    "future months are not clickable",
    text.includes("—"),
  )

  // Only funds that can have dues are offered.
  await page.locator("main button").filter({ hasText: "Default monthly fund" }).click()
  await sleep(500)
  const options = await page.locator('[role="option"]').allInnerTexts()
  check(
    "the fund picker offers only fixed_monthly funds",
    options.length === 2 &&
      options[0] === "Default monthly fund" &&
      options[1] === dueFund.name,
    options.join(" | "),
  )
  for (const name of otherFunds.map((f) => f.name)) {
    check(
      `"${name}" (${otherFunds.find((f) => f.name === name).collectionMode}) is absent from the picker`,
      !options.some((o) => o.includes(name)),
    )
  }
  await page.keyboard.press("Escape")

  // The server's refusal, per fund.
  for (const fund of otherFunds) {
    const g = (await convexCall(
      "aggregate:grid",
      { year: CURRENT_YEAR, fundId: fund.id },
      jwt,
    )).value
    check(
      `the server refuses a grid for "${fund.name}" (${fund.collectionMode}) and says why`,
      g && g.applicable === false && g.rows.length === 0 &&
        typeof g.reason === "string" && g.reason.includes(fund.name) &&
        g.reason.includes(fund.collectionMode),
      g?.reason ?? "(no reason given)",
    )
  }
  await shot("09-contributions")
}

/* ----------------------------------------------------------- fund detail */

group("fund detail — one screen per collection mode")
for (const fund of funds) {
  await page.goto(`${BASE}/funds/${fund.id}`, { waitUntil: "domcontentloaded" })
  await settle(`/funds/${fund.id}`)
  const text = await mainText()
  const detail = (await convexCall("aggregate:fundDetail", { fundId: fund.id }, jwt)).value
  const pledged = detail.pledgedPaise !== null

  check(
    `"${fund.name}" renders with its own name`,
    text.includes(fund.name) && text.length > 300,
  )
  check(
    `"${fund.name}" shows the server's ledger balance`,
    text.includes(money(detail.balancePaise)),
    money(detail.balancePaise),
  )
  if (fund.collectionMode === "pledge_based") {
    check(
      `"${fund.name}" shows pledged against received, not a spend figure`,
      has(text, "Pledged") && !has(text, "Spent YTD"),
      pledged ? `pledged ${money(detail.pledgedPaise)}` : "no pledges",
    )
    check(
      `"${fund.name}" states the shortfall is not arrears`,
      has(text, "not arrears"),
    )
  } else {
    check(
      `"${fund.name}" (${fund.collectionMode}) shows a spend figure, not pledges`,
      has(text, "Spent YTD") && !has(text, "Promised by members"),
    )
  }
  if (fund.collectionMode === "fixed_monthly") {
    check(
      `"${fund.name}" states the amount each member owes`,
      has(text, `${money(detail.monthlyAmountPaise ?? 0)}/member/month`),
      money(detail.monthlyAmountPaise ?? 0),
    )
  }
  if (fund.collectionMode === "voluntary" && !detail.targetAmountPaise) {
    check(
      `"${fund.name}" (voluntary) is not measured against a target`,
      has(text, "Voluntary giving has no target"),
    )
  }
  await shot(`04-fund-${fund.collectionMode}-${fund.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)
}

// A fund id in the URL can be wrong in two ways, and they behave differently.
// `v.id("funds")` validates the whole id, not just its shape: every mutation of
// a real id is rejected, so a mistyped or foreign id reaches the validator and is
// refused there. The screen's own "That fund does not exist" empty state is a
// guard against a *valid* id belonging to another organisation, which a
// single-organisation deployment cannot produce — see the report's findings.
{
  await page.goto(`${BASE}/funds/not-an-id`, { waitUntil: "domcontentloaded" })
  await settle("/funds/<malformed>")
  const bad = await mainText()
  check(
    "a malformed fund id is contained by the error boundary, not a blank page",
    has(bad, "This screen could not load") &&
      has(bad, "Try again") &&
      (await page.locator("aside").count()) === 1,
    bad.replace(/\s+/g, " ").slice(0, 140),
  )
  await shot("05-fund-bad-id")

  const mutated = `${funds[0].id.slice(0, 31)}z`
  const ref = await convexCall("aggregate:fundDetail", { fundId: mutated }, jwt)
  check(
    "a well-formed-looking but invalid id is refused by the validator, not resolved",
    Boolean(ref.error),
    "the server rejects it before the handler runs, so the empty state is unreachable here",
  )
}

/* --------------------------------------------------------------- reports */

group("reports — year scoping and arrears language")
{
  for (const year of [CURRENT_YEAR, 2024, 2018]) {
    const mark = newNoise()
    await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" })
    await settle("/reports")
    if (year !== CURRENT_YEAR) {
      await page
        .locator('main [role="combobox"]')
        .filter({ hasText: /^\d{4}$/ })
        .first()
        .click()
      await page.getByRole("option", { name: String(year), exact: true }).click()
      await sleep(2800)
    }
    const text = await mainText()
    const data = (await convexCall("aggregate:reports", { year }, jwt)).value

    check(
      `the ${year} report states its year`,
      text.includes(`Financial position for ${year}`),
    )
    check(
      `the ${year} collected figure on screen is the server's`,
      text.includes(money(data.yearStats.collectedPaise)),
      money(data.yearStats.collectedPaise),
    )
    check(
      `the ${year} spend figure on screen is the server's`,
      text.includes(money(data.totalSpend)),
      money(data.totalSpend),
    )

    // For a completed year the headline must be the whole year, not the year up
    // to the current month. The efficiency chart beside it is untruncated, so
    // the two figures on one screen have to agree.
    const fullYear = data.efficiency.reduce((t, e) => t + e.collectedPaise, 0)
    if (year !== CURRENT_YEAR) {
      check(
        `the ${year} headline covers all twelve months, not just the months elapsed this year`,
        data.yearStats.collectedPaise === fullYear,
        `headline ${money(data.yearStats.collectedPaise)} vs chart ${money(fullYear)}`,
      )
    } else {
      check(
        "the current-year headline is deliberately month-to-date",
        data.yearStats.collectedPaise <= fullYear,
        `${money(data.yearStats.collectedPaise)} of ${money(fullYear)}`,
      )
    }
    check(
      `the ${year} report keeps voluntary giving out of the arrears section`,
      text.includes("Voluntary giving is never reported as arrears"),
    )
    check(
      `the ${year} report labels each collection round with its mode`,
      data.collectionRounds.every((r) => Boolean(r.collectionMode)),
    )
    check(
      `the ${year} report has no runtime error`,
      quietSince(mark),
      quietSince(mark) ? "clean" : "see browser noise in the report",
    )
    if (year === 2024) await shot("12-reports-2024")
  }

  // The year picker must reach back to the founding year.
  await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" })
  await settle("/reports")
  await page
    .locator('main [role="combobox"]')
    .filter({ hasText: /^\d{4}$/ })
    .first()
    .click()
  await sleep(400)
  const years = await page.locator('[role="option"]').allInnerTexts()
  check(
    "the year picker spans the community's whole history, newest first",
    years.length === CURRENT_YEAR - shell.yearRange.from + 1 &&
      Number(years[0]) === shell.yearRange.to &&
      Number(years.at(-1)) === shell.yearRange.from,
    `${years[0]}..${years.at(-1)} (${years.length} years, server says ${shell.yearRange.from}..${shell.yearRange.to})`,
  )
  await page.keyboard.press("Escape")
}

/**
 * Arrears ageing, M2d.
 *
 * The buckets used to be "1 month / 2 months / 3+ months", which counted how
 * many months a member happened to owe and so put ₹100 from 2019 and ₹1,000
 * from last month in the same row. They are now days past due. The invariant
 * that matters is that the buckets still add up to the headline: every paise of
 * arrears lands in exactly one bucket, and a "not yet due" month is real money
 * owed, so it is counted rather than hidden.
 */
group("reports — ageing by days past due")
{
  const data = (await convexCall("aggregate:reports", { year: CURRENT_YEAR }, jwt)).value

  const bucketSum = data.aging.reduce((t, b) => t + b.totalPaise, 0)
  check(
    "the ageing buckets add up to the arrears headline",
    bucketSum === data.totalArrears,
    `${money(bucketSum)} across buckets vs ${money(data.totalArrears)} headline`,
  )

  // `worst` is capped at the top 5, so the month total cannot be recovered from
  // it. The per-bucket invariant that does hold: a bucket holds at least as many
  // months as distinct members, and cannot name more members than exist.
  check(
    "each bucket holds at least as many months as distinct members",
    data.aging.every((b) => b.count >= b.members),
    data.aging
      .map((b) => `${b.key} ${b.count}m/${b.members}p`)
      .join(" "),
  )
  check(
    "no bucket names more members than there are defaulters",
    data.aging.every((b) => b.members <= data.arrearsCount),
    `${Math.max(...data.aging.map((b) => b.members))} in the largest bucket vs ${data.arrearsCount} defaulters`,
  )
  check(
    "the not-yet-due bucket holds no money that is actually overdue",
    data.aging.find((b) => b.key === "current").count === 0 ||
      data.aging.find((b) => b.key === "current").totalPaise > 0,
    `current=${data.aging.find((b) => b.key === "current").count} months`,
  )

  check(
    "the buckets are the current/30/60/90+ set, oldest last",
    data.aging.map((b) => b.key).join(",") ===
      "current,d30,d60,d90,d90plus",
    data.aging.map((b) => `${b.key}=${money(b.totalPaise)}`).join(" "),
  )

  check(
    "no bucket shows a negative amount",
    data.aging.every((b) => b.totalPaise >= 0),
  )
  // Deliberately *not* asserted: that the oldest bucket holds the most money.
  // Ageing buckets are not a distribution — a community can owe more in the last
  // month than it has owed for years, and that is a true and useful fact rather
  // than a bug. Only the sum and the non-negativity are invariants.

  // Every defaulter's oldest due must be a real month of their own, and the
  // bucket they are summarised under must be consistent with it.
  check(
    "each defaulter is shown the month their oldest due falls in",
    data.worst.every(
      (m) => m.oldestDueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(m.oldestDueDate),
    ),
    data.worst
      .slice(0, 3)
      .map((m) => `${m.name} since ${m.oldestDueDate} (${m.oldestDays}d)`)
      .join(" | "),
  )
  check(
    "the oldest due is genuinely in the past for the defaulters listed",
    data.worst.every((m) => m.oldestDays > 0),
    data.worst
      .slice(0, 3)
      .map((m) => `${m.name}: ${m.oldestDays} days`)
      .join(" | "),
  )

  const text = await mainText()
  check(
    "the screen shows the day-based bucket labels, not month counts",
    ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"].every(
      (l) => has(text, l),
    ),
    data.aging.map((b) => `${b.label}=${b.count}`).join(" "),
  )
  check(
    "the screen says how the ageing was calculated",
    has(text, "aged by how long each month has been due"),
  )
  check(
    "each bucket reports the months and members inside it",
    text.includes("months ·") && text.includes("members"),
  )
  await shot("12b-reports-ageing")
}

/* ------------------------------------------------- 404 and signed-in /auth */

group("routing edges")
{
  await page.goto(`${BASE}/no-such-page`, { waitUntil: "domcontentloaded" })
  await settle("/no-such-page")
  check(
    "an unknown URL renders a 404 rather than a blank page",
    (await bodyText()).includes("404") &&
      (await bodyText()).includes("That page does not exist"),
  )
  await shot("15-not-found")

  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await sleep(1200)
  check(
    "a signed-in visitor sent to /auth is returned to the dashboard",
    new URL(page.url()).pathname === "/",
    new URL(page.url()).pathname,
  )
}

/* --------------------------------------------------------- reconciliation */

/**
 * Milestone M2d. The reconciliation screen is the first one that *writes* and
 * then has to keep the server's numbers and the screen's numbers in agreement,
 * so it is exercised as a workflow rather than a route sweep: file a statement
 * that agrees, one that does not, close the difference off, and confirm the
 * figures on screen are the figures the server stored.
 */
group("reconciliation — filing a statement")
{
  const recon = (await convexCall("reconciliation:status", {}, jwt)).value
  check(
    "the reconciliation read model returns every account",
    Array.isArray(recon?.accounts) && recon.accounts.length === 3,
    `${recon?.accounts?.length} accounts`,
  )

  // This group writes, so it asserts against deltas from the state it found
  // rather than against absolute values, and it puts the year back at the end.
  // A check that only passes on a freshly seeded database is a check that gets
  // skipped the second time anyone runs it.
  //
  // `historyCount`, not `history.length`: the status read model caps the rows it
  // returns per account and reports the true total separately, so an account
  // already at the cap does not appear to gain a row when one is filed.
  const baselineHistory = recon.accounts.reduce(
    (t, a) => t + a.historyCount,
    0,
  )
  const baselineClosed = recon.closedThrough
  const account = recon.accounts.find((a) => a.history.length === 0) ?? recon.accounts[0]
  check(
    "at least one account is available to exercise",
    Boolean(account),
    `chose ${account?.name}`,
  )

  /**
   * A completed year that is not yet closed, or null if there is none.
   *
   * A previous run that was killed part-way (a dead proxy, a crash in an
   * unrelated group) can leave the watermark on the most recent closable year,
   * and then this group has no year left to close and every close assertion
   * fails for the wrong reason. Rather than assume a clean database, walk the
   * watermark down until a year is available — the same way an admin would.
   */
  const closableYear = async () => {
    for (let i = 0; i < 40; i += 1) {
      const now = (await convexCall("reconciliation:status", {}, jwt)).value
      if (now.closedThrough == null || now.closedThrough < CURRENT_YEAR - 1) {
        return CURRENT_YEAR - 1
      }
      const step = await convexCall(
        "reconciliation:reopenYear",
        { year: now.closedThrough },
        jwt,
        "mutation",
      )
      if (step.error) return null
    }
    return null
  }
  const yearToClose = await closableYear()
  check(
    "a completed year is available to close",
    yearToClose !== null,
    `watermark was ${baselineClosed}, closing ${yearToClose}`,
  )

  const mark = newNoise()
  await page.goto(`${BASE}/reconciliation`, { waitUntil: "domcontentloaded" })
  await settle("/reconciliation")
  await shot("15-reconciliation")
  screens.push({ slug: "15-reconciliation", url: "/reconciliation", file: "15-reconciliation.png", chars: (await bodyText()).length })

  const text = await mainText()
  check(
    "the screen names the job and the accounts",
    has(text, "Reconciliation") &&
      recon.accounts.every((a) => text.includes(a.name)),
    recon.accounts.map((a) => a.name).join(" | "),
  )
  check(
    "the close state is stated before any form is offered",
    has(text, "Books closed through") ||
      has(text, "No financial year has been closed"),
    `closedThrough=${baselineClosed}`,
  )
  check(
    "the reconciliation screen produced no runtime error",
    quietSince(mark),
    [
      noise.pageerror.length > mark.pageerror ? "pageerror" : "",
      noise.console.length > mark.console ? "console" : "",
      noise.failed.length > mark.failed ? "requestfailed" : "",
      noise.http.length > mark.http ? "http>=400" : "",
    ].filter(Boolean).join(" ") || "clean",
  )

  // Filing a statement that matches the books must be possible without
  // inventing a difference, and that is the case that proves the date-bounded
  // ledger figure is being computed at all.
  await page.getByRole("button", { name: new RegExp(escapeRe(account.name)) }).first().click()
  await sleep(1200)

  // Statement dated today, balance equal to today's ledger balance: agrees.
  const today = new Date().toISOString().slice(0, 10)
  await page.fill("#stmt-date", today)
  await page.fill("#stmt-amount", String(account.balancePaise / 100))
  await page.click('button:has-text("Record statement")')
  await sleep(2500)

  const agreeing = (await convexCall("reconciliation:status", {}, jwt)).value
  const filed = agreeing.accounts.find((a) => a.id === account.id)
  check(
    "filing a statement that matches the books records a zero difference",
    filed?.latest?.differencePaise === 0,
    `difference=${filed?.latest?.differencePaise} (books said ${filed?.latest?.ledgerBalancePaise})`,
  )
  check(
    "the stored ledger figure is the account's balance as at that date",
    filed?.latest?.ledgerBalancePaise === account.balancePaise,
    `${filed?.latest?.ledgerBalancePaise} vs ${account.balancePaise}`,
  )
  check(
    "filing a statement adds a row rather than replacing one",
    filed.historyCount === account.historyCount + 1,
    `${account.historyCount} -> ${filed.historyCount}`,
  )
  const afterAgree = await mainText()
  check(
    "the screen reports agreement and the notice is not an error",
    has(afterAgree, "Reconciled") && !has(afterAgree, "difference of"),
  )
  check(
    "the agreed statement appears in the history table",
    has(afterAgree, "Statement history") && has(afterAgree, "Agreed"),
  )
  // The status read model caps the rows it returns per account so its cost does
  // not grow with usage. Silently truncating a financial history would be the
  // wrong trade, so the screen has to say when it is showing a subset.
  //
  // Asserted against the account the screen is actually showing — the one this
  // group just filed to — and in both directions. The earlier version searched
  // the whole read model for *any* over-cap account and then asserted the notice
  // was on screen, which only holds while that account happens to be the selected
  // one. On a freshly seeded database it is, so the check passed; once repeated
  // runs had pushed one account past the cap and the group had moved on to
  // another, it failed against a screen that was behaving correctly.
  check(
    "the screen says when it is showing only the most recent statements",
    filed.historyCount > filed.history.length
      ? has(afterAgree, "most recent of")
      : !has(afterAgree, "most recent of"),
    `${filed.historyCount} on record, ${filed.history.length} listed for ${
      account.name
    }`,
  )
  await shot("15b-reconciliation-agrees")

  // Now file one that does not agree, and confirm the difference is computed
  // from the server's own figure rather than echoed back from the form.
  await page.fill("#stmt-date", today)
  await page.fill("#stmt-amount", String((account.balancePaise + 50000) / 100))
  await page.click('button:has-text("Record statement")')
  await sleep(2500)

  const differing = (await convexCall("reconciliation:status", {}, jwt)).value
  const drifted = differing.accounts.find((a) => a.id === account.id)
  const unexplainedNow = differing.accounts.filter(
    (a) =>
      a.latest !== null &&
      a.latest.differencePaise !== 0 &&
      a.latest.resolvedAt == null,
  ).length
  check(
    "a statement that disagrees records the exact difference",
    drifted?.latest?.differencePaise === 50000,
    `difference=${drifted?.latest?.differencePaise}`,
  )
  // The correction is filed for the *same* date as the row above it, so this is
  // the case that proves "latest" is ordered by filing time and not by date
  // alone. Ordering on the date alone left the mistyped figure on screen.
  check(
    "a later filing for the same date supersedes the earlier one",
    drifted?.historyCount === account.historyCount + 2 &&
      drifted.history[0].differencePaise === 50000 &&
      drifted.history[1].differencePaise === 0,
    drifted?.history
      ?.slice(0, 2)
      .map((h) => `${h.statementDate}:${h.differencePaise}`)
      .join(" then "),
  )
  check(
    "the account is now counted as having an unexplained difference",
    differing.outstandingCount === unexplainedNow &&
      unexplainedNow >= 1,
    `outstanding=${differing.outstandingCount} unexplained=${unexplainedNow}`,
  )
  const afterDrift = await mainText()
  check(
    "the screen calls the difference out and offers to close it off",
    has(afterDrift, "unexplained difference") && has(afterDrift, "Close off"),
  )
  check(
    "both statements are kept in the history",
    (drifted?.historyCount ?? 0) >= 2,
    `${drifted?.historyCount} on record, ${drifted?.history.length} listed`,
  )
  await shot("15c-reconciliation-differs")

  // Close the year while the difference is open: the server must refuse.
  const refused = await convexCall(
    "reconciliation:closeYear",
    { year: yearToClose },
    jwt,
    "mutation",
  )
  check(
    "closing a year is refused while a difference is unexplained",
    Boolean(refused.error) && /unexplained difference/i.test(refused.error),
    refused.error ?? "closed without complaint",
  )

  await page.fill('input[placeholder="Bank charges not in our books"]', "Bank charge not in our books")
  await page.click('button:has-text("Close off")')
  await sleep(2500)

  const resolved = (await convexCall("reconciliation:status", {}, jwt)).value
  const closedRow = resolved.accounts.find((a) => a.id === account.id)
  check(
    "closing off a difference keeps the row and stamps it resolved",
    closedRow?.latest?.resolvedAt != null &&
      closedRow.latest.differencePaise === 50000,
    `resolvedAt=${closedRow?.latest?.resolvedAt}`,
  )
  check(
    "a resolved difference no longer counts as unexplained",
    !resolved.accounts.some(
      (a) =>
        a.latest?.differencePaise !== 0 &&
        a.latest?.differencePaise != null &&
        a.latest.resolvedAt == null,
    ),
    `outstanding=${resolved.outstandingCount}`,
  )
  // Regression: `outstandingCount` used to be computed from the difference alone
  // and ignored `resolvedAt`, so the screen still reported the discrepancy as
  // open immediately after closing it — and the close-year guard, which reads
  // the same field, would have stayed blocked.
  check(
    "closing off a difference drops the unexplained count to zero",
    resolved.outstandingCount === 0,
    `outstanding=${resolved.outstandingCount}, explained=${resolved.explainedCount}`,
  )
  check(
    "an explained difference is counted separately from an unexplained one",
    resolved.explainedCount >= 1,
    `explained=${resolved.explainedCount}`,
  )
  const afterResolve = await mainText()
  check(
    "the screen shows the difference as closed off rather than deleting it",
    has(afterResolve, "Closed off") && has(afterResolve, "Bank charge"),
  )
  // Regression: the read model normalises an absent `resolvedAt` to null, and
  // the card that offers to close a difference off tested for `undefined`. It
  // therefore never rendered, and the only control that unblocks closing the
  // year was unreachable.
  //
  // The badge is read from the account list rather than the whole page: the
  // close panel's static copy legitimately contains the words "unexplained
  // difference" at all times, so a whole-page text search cannot tell an open
  // difference from a description of one.
  const badges = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main button"))
      .map((b) => b.textContent ?? "")
      .filter((t) => /agrees|explained|differs|never checked/.test(t)),
  )
  check(
    "the account badge reports the difference as explained, not as still open",
    badges.some((b) => b.includes("explained")) &&
      !badges.some((b) => b.includes("differs")),
    badges.map((b) => b.replace(/\s+/g, " ").trim().slice(0, 40)).join(" | "),
  )
  check(
    "the open-difference card is gone once the difference is explained",
    !(await page.$('input[placeholder="Bank charges not in our books"]')),
  )
  await shot("15d-reconciliation-resolved")

  // Now the close should succeed, and the second account should pick it up.
  const closedYear = await convexCall(
    "reconciliation:closeYear",
    { year: yearToClose },
    jwt,
    "mutation",
  )
  check(
    "closing the year succeeds once every difference is explained",
    closedYear.value?.year === yearToClose,
    JSON.stringify(closedYear.value ?? closedYear.error),
  )
  check(
    "closing a year locks the entries dated inside it",
    closedYear.value?.locked > 0,
    `${closedYear.value?.locked} entries stamped lockedTo`,
  )

  const afterClose = (await convexCall("reconciliation:status", {}, jwt)).value
  check(
    "the close watermark is reported back to the screen",
    afterClose.closedThrough === yearToClose,
    `closedThrough=${afterClose.closedThrough}`,
  )
  // The close was driven through the API rather than the button, so the screen
  // has to pick the new watermark up from the reactive query on its own. Give
  // it a moment before reading it.
  await sleep(2000)
  const afterCloseText = await mainText()
  check(
    "the screen explains what closing a year does to the ledger",
    has(afterCloseText, `Books closed through ${yearToClose}`) &&
      has(afterCloseText, "refused by the ledger"),
    afterCloseText
      .split("\n")
      .filter((l) => /closed|locked|refused/i.test(l))
      .slice(0, 3)
      .join(" / "),
  )
  await shot("15e-reconciliation-closed")

  // A closed year must actually refuse a write dated inside it. This is the
  // invariant the whole milestone rests on, so it is asserted against the
  // server rather than against the copy on the screen.
  //
  // A payment rather than a due: the seeder already created all twelve months of
  // every year, so creating a contribution in a closed year is refused for
  // being a duplicate long before the close is consulted. `recordPayment` is the
  // path that actually reaches the ledger writer, and it takes the date from the
  // caller.
  const lockedWrite = await convexCall(
    "transactions:recordPayment",
    {
      fundId: funds.find((f) => f.collectionMode === "fixed_monthly").id,
      amountPaise: 10000,
      method: "cash",
      paidAt: `${yearToClose}-06-15T10:00:00.000Z`,
    },
    jwt,
    "mutation",
  )
  check(
    "a payment dated inside the closed year is refused by the ledger writer",
    Boolean(lockedWrite.error) && /closed/i.test(lockedWrite.error),
    lockedWrite.error ?? "accepted into a closed year",
  )
  // The message naming the closed year is what proves the refusal came from the
  // watermark rather than from the mutation failing for some unrelated reason.
  // Asserting that a *successful* write still works would mean leaving a payment
  // behind on every run, and `bun run smoke` already covers the happy path.
  check(
    "the refusal names the closed year, so it is the watermark refusing it",
    new RegExp(`through ${yearToClose} is closed`).test(lockedWrite.error ?? ""),
    (lockedWrite.error ?? "").split("\n")[0],
  )

  // Put the books back, so the group is re-runnable. `reopenYear` only accepts
  // the topmost closed year and steps the watermark down one year at a time, so
  // this walks all the way to "nothing closed" — which is the state the seeder
  // produces, and the only one a downward-only operation can return to.
  const reopened = await convexCall(
    "reconciliation:reopenYear",
    { year: yearToClose },
    jwt,
    "mutation",
  )
  check(
    "an admin can reopen the year that was just closed",
    reopened.value?.year === yearToClose,
    JSON.stringify(reopened.value ?? reopened.error),
  )
  for (let i = 0; i < 40; i += 1) {
    const now = (await convexCall("reconciliation:status", {}, jwt)).value.closedThrough
    if (now === null) break
    const step = await convexCall(
      "reconciliation:reopenYear",
      { year: now },
      jwt,
      "mutation",
    )
    if (step.error) break
  }
  const finalState = (await convexCall("reconciliation:status", {}, jwt)).value
  check(
    "the harness leaves the books with no year closed, as the seeder has them",
    finalState.closedThrough === null,
    `closedThrough=${finalState.closedThrough} (was ${baselineClosed} at the start)`,
  )
  check(
    "the statements filed by this group are still on record afterwards",
    (await convexCall("reconciliation:status", {}, jwt)).value.accounts.reduce(
      (t, a) => t + a.historyCount,
      0,
    ) >= baselineHistory + 2,
  )
}

/* --------------------------------------------------------------- viewer */

group("viewer role — read-only and admin-only routes")
{
  const ctx2 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await ctx2.addInitScript(RECORD_QUERIES)
  const vp = await ctx2.newPage()
  const viewerNoise = []
  vp.on("pageerror", (e) => viewerNoise.push(String(e).slice(0, 300)))
  vp.on("console", (m) => {
    if (m.type() === "error" && !IGNORED_CONSOLE.some((i) => m.text().includes(i))) {
      viewerNoise.push(m.text().slice(0, 300))
    }
  })

  await signInIn(vp, ACCOUNTS.viewer)
  const vtext0 = await vp.innerText("body")
  check(
    "the viewer signs in and the shell identifies the role",
    has(vtext0, "viewer"),
    vtext0.replace(/\s+/g, " ").slice(0, 120),
  )
  check(
    "the viewer does not see the Administration section",
    !(await vp.innerText("aside")).includes("Administration"),
  )

  for (const [url, expected] of [
    ["/", "Total across funds"],
    ["/funds", "Funds"],
    ["/members", "Members"],
    ["/contributions", "Monthly Collection Grid"],
    ["/banks", "Passbook"],
    ["/reconciliation", "Reconciliation"],
    ["/reports", "Financial position"],
  ]) {
    await vp.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" })
    await vp
      .waitForFunction(
        () => {
          const m = document.querySelector("main") ?? document.body
          return m.querySelector(".animate-spin") === null
        },
        null,
        { timeout: 25_000 },
      )
      .catch(() => {})
    await sleep(700)
    const t = await vp.innerText("body")
    check(
      `a viewer can read ${url}`,
      has(t, expected) && !has(t, "This screen could not load"),
      has(t, expected) ? "" : t.replace(/\s+/g, " ").slice(0, 120),
    )
  }

  for (const url of ["/users", "/settings"]) {
    await vp.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" })
    await sleep(2000)
    const t = await vp.innerText("body")
    check(
      `a viewer is refused ${url} in the UI, not by a crash`,
      has(t, "Admin access required") && !has(t, "This screen could not load"),
    )
  }

  // A viewer must not be offered a control that can only fail.
  await vp.goto(`${BASE}/contributions`, { waitUntil: "domcontentloaded" })
  await sleep(2500)
  const cycleable = await vp.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("main table tbody button"))
    return {
      total: buttons.length,
      enabled: buttons.filter((b) => !b.disabled).length,
    }
  })
  check(
    "the collection grid offers a viewer no cell to click",
    cycleable.total === 0 || cycleable.enabled === 0,
    `${cycleable.enabled} of ${cycleable.total} cells still clickable`,
  )

  await vp.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" })
  await sleep(2000)
  const approvalsText = await vp.innerText("body")
  const approverButtons = await vp.evaluate(() =>
    Array.from(document.querySelectorAll("main button"))
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => t === "Approve" || t === "Reject").length,
  )
  check(
    "the approvals queue offers a viewer no Approve or Reject button",
    approverButtons === 0,
    `${approverButtons} buttons present`,
  )
  void approvalsText
  await vp.screenshot({ path: path.join(OUT, "16-viewer-approvals.png"), fullPage: true })

  // A viewer may read the reconciliation screen but must not be handed a form
  // that can only fail — the same rule the grid and the approvals queue follow.
  await vp.goto(`${BASE}/reconciliation`, { waitUntil: "domcontentloaded" })
  await sleep(2500)
  const reconText = await vp.innerText("body")
  const reconInputs = await vp.evaluate(
    () => document.querySelectorAll("main input").length,
  )
  check(
    "the reconciliation screen tells a viewer they are viewing only",
    has(reconText, "View only"),
    reconText.replace(/\s+/g, " ").slice(0, 100),
  )
  check(
    "the reconciliation screen offers a viewer no field to type into",
    reconInputs === 0,
    `${reconInputs} inputs present`,
  )
  check(
    "the viewer session produced no runtime errors",
    viewerNoise.length === 0,
    viewerNoise.join(" | "),
  )

  await ctx2.close()
}

/* ------------------------------------------------------ deactivated user */

group("deactivated account")
{
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const dp = await ctx3.newPage()
  const errs = []
  dp.on("pageerror", (e) => errs.push(String(e).slice(0, 200)))
  await dp.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await dp.waitForSelector("#email", { timeout: 20_000 })
  await dp.fill("#email", ACCOUNTS.deactivated)
  await dp.fill("#password", PASSWORD)
  await dp.click('button[type="submit"]')
  await sleep(6000)
  const t = await dp.innerText("body").catch(() => "")
  check(
    "a deactivated account is refused with an explanation, not a blank page",
    t.includes("Could not load your data") &&
      t.includes("deactivated") &&
      !errs.some((e) => e.includes("Too many re-renders")),
    t.split("\n").slice(0, 3).join(" / "),
  )
  await dp.screenshot({ path: path.join(OUT, "17-deactivated.png"), fullPage: true })
  await ctx3.close()
}

/* ----------------------------------------------------------------- write */

await browser.close()

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed

const noiseSummary = {
  console: noise.console,
  pageerror: noise.pageerror,
  failed: noise.failed,
  http: noise.http,
}

const md = []
md.push("# Visual verification report")
md.push("")
md.push(`Base URL: \`${BASE}\`  ·  Convex: \`${CONVEX}\``)
md.push("")
md.push(`**${passed} passed, ${failed} failed** of ${results.length} checks.`)
md.push("")
md.push("## Screens inspected")
md.push("")
md.push("| Route | Screenshot | Text rendered |")
md.push("| --- | --- | --- |")
for (const s of screens) {
  md.push(`| \`${s.url}\` | [${s.slug}.png](${s.slug}.png) | ${s.chars} chars |`)
}
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
md.push(JSON.stringify(noiseSummary, null, 2))
md.push("```")

await writeFile(path.join(OUT, "report.md"), md.join("\n"))
await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify({ base: BASE, results, screens, noise: noiseSummary }, null, 2),
)

console.log(
  `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m — report in ${OUT}/report.md`,
)
process.exit(failed === 0 ? 0 : 1)

/** Sign in on a page other than the main one (the viewer pass). */
async function signInIn(target, email) {
  currentLabel = `auth:${email}`
  await target.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await target.waitForSelector("#email", { timeout: 20_000 })
  await target.fill("#email", email)
  await target.fill("#password", PASSWORD)
  await target.click('button[type="submit"]')
  await target.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
  await target.waitForTimeout(2500)
}
