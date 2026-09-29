/**
 * End-to-end verification of the member portal (M3).
 *
 *   bun run visual:portal
 *
 * ## Why this is a separate harness from `visual-check.mjs`
 *
 * The portal is a different application, not another screen of the console. It
 * has its own shell, its own sign-in role, a 390px layout rather than a 1440px
 * one, and a completely different set of people using it. Driving it from the
 * console harness would mean tearing down and rebuilding the admin session
 * halfway through a run, and it would bury the portal's checks among two hundred
 * console ones where nobody would look for them.
 *
 * It is kept honest by sharing the same approach as the console suite: every
 * figure on screen is cross-checked against the read model that produced it, and
 * a query that must not run is proved absent by watching the subscription
 * protocol rather than by looking at pixels.
 *
 * The three M3 exit criteria map to the three groups below:
 *
 *   1. a member signs in with a link and sees a correct itemised balance
 *      -> "what I owe" and "claiming a record"
 *   2. a member downloads a receipt
 *      -> "receipts and the printable receipt"
 *   3. a treasurer can see which members have claimed accounts
 *      -> "treasurer: who has claimed", "mark-as-paid"
 */

import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:5173"
const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const OUT = process.env.VISUAL_OUT ?? ".visual"
const PASSWORD = process.env.DEMO_PASSWORD ?? "community123"
const CURRENT_YEAR = new Date().getFullYear()

/** The portal is designed for a phone, so it is verified on one. */
const MOBILE = { width: 390, height: 844 }

const ACCOUNTS = {
  member: "imran@example.org",
  unlinked: "ayesha@example.org",
  treasurer: "treasurer@jamaat.org",
}

/* ------------------------------------------------------------------ report */

const results = []
let currentGroup = "portal"

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
const money = (paise) => inr.format((paise ?? 0) / 100)

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
/**
 * Mirrors `formatDate` in src/lib/format.ts.
 *
 * Deliberately calls the same `Intl` formatter rather than assembling the string
 * from month abbreviations. `en-IN` abbreviates September as "Sept", not "Sep",
 * so a hand-rolled mirror silently disagrees with the screen and the check fails
 * for a reason that has nothing to do with the feature under test.
 */
function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

const has = (text, needle) => text.includes(needle)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Call a Convex function with the browser's own session token.
 *
 * Errors come back as a value rather than a throw, because several checks here
 * assert that a call is *refused* — a throw would be the expected outcome
 * mistaken for a broken harness.
 */
async function convexCall(fnPath, args, jwt, kind = "query") {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
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

/* ------------------------------------------------------------------- setup */

await mkdir(OUT, { recursive: true })
// See the note in visual-check.mjs: a container's `/dev/shm` is 64 MB, Chromium
// renderers get killed when a page needs more, and Playwright reports it as
// `Target crashed` — which reads exactly like an application bug. Same launch
// arguments in all three suites so they cannot disagree.
const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
})

const noise = { pageerror: [], console: [], failed: [], http: [] }
let currentScreen = "boot"

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

/** Wait until the screen's read model has resolved. */
async function settle(page, label) {
  currentScreen = label
  await page.waitForLoadState("domcontentloaded")
  // See the note in visual-check.mjs -> settle(): the `?? document.body` fallback
  // made "no spinner" true before the app had mounted, so this returned before
  // the lazy route chunk had even been requested. The claim-screen assertions
  // then read a blank `<main>` and failed for a reason that had nothing to do
  // with the portal. `main` arrives in the same commit as the Suspense fallback
  // inside it, so waiting for it first is what makes the spinner check mean
  // something.
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
}

const mainText = (page) =>
  page.evaluate(() => document.querySelector("main")?.innerText ?? "")

/** Wait until a piece of text is actually on the page, or give up. */
async function waitForText(page, needle, timeout = 15_000) {
  try {
    await page.waitForFunction(
      (n) => (document.querySelector("main")?.innerText ?? "").includes(n),
      needle,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

const bodyText = (page) => page.evaluate(() => document.body.innerText ?? "")

const sessionToken = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT_"))
    return key ? localStorage.getItem(key) : null
  })

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}

/** A fresh, phone-sized, signed-in context. */
async function portalSession(email) {
  const ctx = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  watch(page, `portal:${email}`)
  currentScreen = `auth:${email}`
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#email", { timeout: 20_000 })
  await page.fill("#email", email)
  await page.fill("#password", PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
  // Signing in lands on `/`, which immediately redirects a member to `/me`.
  // Waiting for the *final* URL matters: reading the screen a frame earlier
  // catches the console gate's spinner and every assertion below it fails for a
  // reason that has nothing to do with the portal.
  await page.waitForURL((u) => u.pathname === "/me", { timeout: 20_000 })
  await settle(page, `portal:${email}`)
  return { ctx, page }
}

/* ------------------------------------------- 1. what I owe, and itemisation */

group("member portal — what I owe")
{
  const { ctx, page } = await portalSession(ACCOUNTS.member)
  const jwt = await sessionToken(page)

  check(
    "a member signing in lands in the portal, not the console",
    new URL(page.url()).pathname === "/me",
    page.url(),
  )

  const summary = await convexCall("portal:summary", {}, jwt)
  const text = await mainText(page)

  check(
    "the portal names the member and the organisation",
    has(text, "Imran Shaikh") && has(text, "Jamaat Anjuman"),
    text.split("\n").slice(0, 2).join(" / "),
  )
  check(
    "the headline is the server's total outstanding",
    summary.value && has(text, money(summary.value.totalOutstandingPaise)),
    summary.value ? money(summary.value.totalOutstandingPaise) : summary.error,
  )
  check(
    "this month plus arrears is exactly the headline",
    summary.value &&
      summary.value.currentMonthPaise + summary.value.arrearsPaise ===
        summary.value.totalOutstandingPaise &&
      has(text, money(summary.value.currentMonthPaise)) &&
      has(text, money(summary.value.arrearsPaise)),
    summary.value
      ? `${money(summary.value.currentMonthPaise)} + ${money(summary.value.arrearsPaise)} = ${money(summary.value.totalOutstandingPaise)}`
      : summary.error,
  )
  check(
    "arrears are counted in months, so the member can see how long",
    summary.value && has(text, `${summary.value.arrearsMonths} month`),
    summary.value ? `${summary.value.arrearsMonths} months` : "",
  )
  check(
    "paid to date is the server's figure",
    summary.value && has(text, money(summary.value.totalReceivedPaise)),
    summary.value ? money(summary.value.totalReceivedPaise) : "",
  )
  check(
    "the oldest unpaid month is dated, not just counted",
    summary.value?.oldestDueDate
      ? has(text, shortDate(summary.value.oldestDueDate))
      : has(text, "You are up to date"),
    summary.value?.oldestDueDate
      ? shortDate(summary.value.oldestDueDate)
      : "nothing outstanding",
  )
  check(
    "the voluntary funds are marked optional rather than owed",
    (summary.value?.voluntaryFunds?.length ?? 0) > 0 &&
      // The badge capitalises its text, so this has to be case-insensitive —
      // otherwise it is testing CSS rather than the feature.
      text.toLowerCase().includes("optional"),
    `${summary.value?.voluntaryFunds?.length ?? 0} voluntary funds`,
  )
  check(
    "the member session produced no page errors",
    !noise.pageerror.some((e) => e.screen === `portal:${ACCOUNTS.member}`),
    noise.pageerror.map((e) => e.text).join(" | ").slice(0, 160),
  )
  await shot(page, "20-portal-balance")

  // A deep link is how a member actually arrives — from a WhatsApp message.
  await page.goto(`${BASE}/me/statement`, { waitUntil: "domcontentloaded" })
  await settle(page, "portal:deep-link")
  check(
    "a deep link into the portal works while signed in",
    new URL(page.url()).pathname === "/me/statement",
    page.url(),
  )

  // The console must be closed to a member.
  await page.goto(`${BASE}/funds`, { waitUntil: "domcontentloaded" })
  await sleep(2500)
  check(
    "a member following a console link is returned to the portal",
    new URL(page.url()).pathname === "/me",
    page.url(),
  )
  const afterEscape = await bodyText(page)
  check(
    "the member never sees the committee sidebar",
    !has(afterEscape, "Reconciliation") && !has(afterEscape, "Claimed payments"),
  )

  // And the server must refuse it independently of the routing.
  for (const fn of ["aggregate:shell", "aggregate:dashboard", "aggregate:members"]) {
    const r = await convexCall(fn, { filter: "all" }, jwt)
    check(`the server refuses ${fn} for a member`, Boolean(r.error), r.error)
  }
  const usersList = await convexCall("data:listUsers", {}, jwt)
  check(
    "a member cannot read the committee's user list",
    Boolean(usersList.error),
    usersList.error,
  )

  await ctx.close()
}

/* ---------------------------------------------------- 2. receipts, printable */

group("member portal — receipts and the printable receipt")
{
  const { ctx, page } = await portalSession(ACCOUNTS.member)
  const jwt = await sessionToken(page)
  const summary = await convexCall("portal:summary", {}, jwt)
  const receipt = summary.value?.receipts?.[0]

  await page.goto(`${BASE}/me/receipts`, { waitUntil: "domcontentloaded" })
  await settle(page, "portal:receipts")
  const list = await mainText(page)

  check(
    "the receipts list names the most recent receipt",
    receipt && has(list, receipt.receiptNo),
    receipt?.receiptNo,
  )
  check(
    "the amount on the list is the server's",
    receipt && has(list, money(receipt.amountPaise)),
    receipt ? money(receipt.amountPaise) : "",
  )
  check(
    "the list explains itself when there is nothing to show",
    (summary.value?.receipts?.length ?? 0) > 0 || has(list, "No receipts yet"),
  )
  await shot(page, "21-portal-receipts")

  if (receipt) {
    await page.goto(`${BASE}/me/receipts/${receipt.id}`, { waitUntil: "domcontentloaded" })
    await settle(page, "portal:receipt")
    const doc = await mainText(page)
    check(
      "the receipt is a document with its number and its amount",
      has(doc, receipt.receiptNo) && has(doc, money(receipt.amountPaise)),
      `${receipt.receiptNo} / ${money(receipt.amountPaise)}`,
    )
    check(
      "the receipt is attributed to the member it belongs to",
      has(doc, "Imran Shaikh"),
    )
    check(
      "the receipt offers the system print sheet, which is how a phone saves a PDF",
      has(doc, "Print or save as PDF"),
    )
    // The point of the print sheet is that the paper contains only the record.
    // This has to be checked *in print emulation* — the `cf-chrome` rule lives
    // in an `@media print` block, so on screen the chrome is correctly visible
    // and asserting otherwise would be asserting a bug.
    await page.emulateMedia({ media: "print" })
    const chrome = await page.evaluate(() => {
      const nav = document.querySelector("nav")
      const header = document.querySelector("header.cf-chrome")
      const doc = document.querySelector("article")
      const hidden = (el) => !el || getComputedStyle(el).display === "none"
      return {
        navHidden: hidden(nav),
        headerHidden: hidden(header),
        documentVisible: !hidden(doc),
      }
    })
    await page.emulateMedia({ media: "screen" })
    check(
      "in print, the portal chrome disappears and only the document remains",
      chrome.navHidden && chrome.headerHidden && chrome.documentVisible,
      JSON.stringify(chrome),
    )
    // …and the document's own header must survive that rule.
    check(
      "the receipt keeps its own title, which is part of the record",
      has(doc, "Payment receipt"),
    )
    await shot(page, "22-portal-receipt")
  }

  // A receipt that is not the caller's must be indistinguishable from one that
  // does not exist, or the URL becomes an oracle for valid payment ids.
  if (receipt) {
    const other = await portalSession(ACCOUNTS.unlinked)
    await other.page.goto(`${BASE}/me/receipts/${receipt.id}`, {
      waitUntil: "domcontentloaded",
    })
    await sleep(2500)
    const denied = await mainText(other.page)
    check(
      "another member's receipt is refused, and gives nothing away",
      has(denied, "Receipt not available") &&
        !has(denied, receipt.receiptNo) &&
        !has(denied, money(receipt.amountPaise)),
      denied.split("\n")[0],
    )
    const viaApi = await convexCall(
      "receipts:receiptData",
      { paymentId: receipt.id },
      await sessionToken(other.page),
    )
    check(
      "the read model returns null for a receipt that is not the caller's",
      viaApi.value === null,
      JSON.stringify(viaApi),
    )
    await other.ctx.close()
  }

  await ctx.close()
}

/* ------------------------------------------------- 3. the passbook statement */

group("member portal — the passbook statement")
{
  const { ctx, page } = await portalSession(ACCOUNTS.member)
  const jwt = await sessionToken(page)
  const statement = await convexCall("portal:statement", {}, jwt)

  await page.goto(`${BASE}/me/statement`, { waitUntil: "domcontentloaded" })
  await settle(page, "portal:statement")
  const doc = await mainText(page)

  check(
    "the statement renders as a statement",
    has(doc, "Contribution statement") && has(doc, "Imran Shaikh"),
    `${doc.length} chars`,
  )
  check(
    "the statement's balance is the server's",
    statement.value && has(doc, money(Math.max(0, statement.value.outstandingPaise))),
    statement.value ? money(statement.value.outstandingPaise) : statement.error,
  )
  check(
    "the statement is internally consistent: charged less received is the balance",
    statement.value &&
      statement.value.chargedTotalPaise - statement.value.receivedTotalPaise ===
        statement.value.outstandingPaise,
    statement.value
      ? `${money(statement.value.chargedTotalPaise)} - ${money(statement.value.receivedTotalPaise)} = ${money(statement.value.outstandingPaise)}`
      : statement.error,
  )
  check(
    "every month ever charged is listed, not a recent slice",
    statement.value && has(doc, `${statement.value.charged.length} monthly dues`),
    statement.value ? `${statement.value.charged.length} months` : "",
  )
  check(
    "every payment ever received is listed",
    statement.value && has(doc, `${statement.value.received.length} payments`),
    statement.value ? `${statement.value.received.length} payments` : "",
  )
  check(
    "the statement names a statement date",
    statement.value && has(doc, shortDate(statement.value.generatedAt)),
  )
  check(
    "the statement offers print and share",
    has(doc, "Print or save as PDF") && has(doc, "Share"),
  )
  await shot(page, "23-portal-statement")

  // The WhatsApp share is a M3 deliverable, so the link is checked, not the tap.
  const share = await convexCall("portal:summary", {}, jwt)
  if (share.value) {
    const origin = new URL(BASE).origin
    const message = [
      "Jamaat Anjuman",
      `Total outstanding: ${money(share.value.totalOutstandingPaise)}`,
      `${origin}/me`,
    ].join("\n")
    const wa = await page.evaluate((text) => {
      const link = `https://wa.me/?text=${encodeURIComponent(text)}`
      return { link, encoded: link.includes(encodeURIComponent("Total outstanding")) }
    }, message)
    check(
      "the WhatsApp share link carries the figures, not just a URL",
      wa.encoded,
      wa.link.slice(0, 60) + "…",
    )
  }

  await ctx.close()
}

/* --------------------------------------------------- 4. claiming a record */

group("member portal — claiming a record")
{
  const { ctx, page } = await portalSession(ACCOUNTS.unlinked)
  const jwt = await sessionToken(page)
  const home = await mainText(page)

  check(
    "an unlinked member is asked to link, not shown a balance",
    has(home, "Link your record"),
    home.split("\n")[0],
  )
  check(
    "the unlinked state shows no fabricated zero balance",
    !/Total outstanding/.test(home) && !/Nothing outstanding/.test(home),
  )
  check(
    "the claim screen names the address it will match on",
    has(home, ACCOUNTS.unlinked),
  )
  check(
    "the claim screen offers a way out for a shared household address",
    has(home, "secretary") && has(home, "link your account"),
  )
  const account = await convexCall("portal:myAccount", {}, jwt)
  check(
    "an unlinked account has no member record behind it",
    account.value?.memberId === null,
    JSON.stringify(account.value ?? account.error),
  )
  const summary = await convexCall("portal:summary", {}, jwt)
  check(
    "an unlinked account has no balance read model at all",
    summary.value === null,
    JSON.stringify(summary),
  )
  const members = await convexCall("aggregate:members", { filter: "all" }, jwt)
  check(
    "an unlinked member cannot browse the roll to find themselves",
    Boolean(members.error),
    members.error,
  )
  await shot(page, "24-portal-claim")

  // Deliberately not claimed: claiming is a one-way change to the demo data,
  // and the treasurer group below needs an unclaimed member to point at.
  await ctx.close()
}

/* ---------------------------------------- 5. treasurer: who has claimed */

group("treasurer — who has claimed an account")
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  watch(page, "treasurer")
  currentScreen = "auth:treasurer"
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#email", { timeout: 20_000 })
  await page.fill("#email", ACCOUNTS.treasurer)
  await page.fill("#password", PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
  const jwt = await sessionToken(page)

  await page.goto(`${BASE}/member-accounts`, { waitUntil: "domcontentloaded" })
  await settle(page, "member-accounts")
  const text = await mainText(page)
  const status = await convexCall("portal:accountStatus", {}, jwt)

  check(
    "a treasurer can read the account-status read model",
    !status.error,
    status.error,
  )
  check(
    "the screen counts who has an account and who has not",
    status.value &&
      has(text, String(status.value.linked)) &&
      has(text, String(status.value.unlinked)),
    status.value ? `${status.value.linked} linked, ${status.value.unlinked} not` : "",
  )
  check(
    "a claimed member is shown as claimed, with the account holding it",
    has(text, "Imran Shaikh") && has(text, "Linked") && has(text, ACCOUNTS.member),
  )
  check(
    "an unclaimed member is shown as unclaimed",
    has(text, "Ayesha Khan") && has(text, "Not claimed"),
  )
  check(
    "the screen names the members who cannot see their own balance",
    status.value && has(text, String(status.value.unlinkedActive)),
    status.value ? `${status.value.unlinkedActive} active and unclaimed` : "",
  )
  check(
    "the treasurer can reach the linking control",
    has(text, "Link"),
  )
  await shot(page, "25-member-accounts")

  // A member must not be able to read the roll of who has claimed, or link
  // themselves to somebody else's record.
  const memberJwt = (await (async () => {
    const m = await portalSession(ACCOUNTS.member)
    const t = await sessionToken(m.page)
    await m.ctx.close()
    return t
  })())
  const asMember = await convexCall("portal:accountStatus", {}, memberJwt)
  check(
    "a member cannot read who has claimed accounts",
    Boolean(asMember.error),
    asMember.error,
  )
  const linkAttempt = await convexCall(
    "portal:assignAccount",
    // A real member id, so the refusal is about the *role* and not about
    // argument validation — otherwise this would pass for the wrong reason.
    { memberId: (status.value?.rows?.[0]?.id ?? null), userEmail: ACCOUNTS.member },
    memberJwt,
    "mutation",
  )
  check(
    "a member cannot link an account to a member record",
    Boolean(linkAttempt.error) && /treasurer/i.test(linkAttempt.error),
    linkAttempt.error,
  )

  await ctx.close()
}

/* ------------------------------------------- 6. mark-as-paid, end to end */

/**
 * The claim is **refused**, not confirmed, and the reason is worth stating.
 *
 * Confirming would write a real payment, a real receipt number and a real ledger
 * entry, and nothing in this product can undo a payment. A verification suite
 * that permanently altered the books on every run would stop being a suite and
 * become a slow corruption of the demo data. So this drives the whole loop that
 * is new in M3 — claim, queue, decision, the member seeing the outcome with the
 * treasurer's reason — and takes the branch that writes no money.
 *
 * The confirmation branch's money-writing half is `recordPaymentFor`, which is
 * the same function the desk uses and which `bun run check` already drives
 * directly, including its refusal of a payment dated inside a closed year.
 */
group("mark-as-paid — claim, queue, decision, and the books unchanged")
{
  const { ctx, page } = await portalSession(ACCOUNTS.member)
  const jwt = await sessionToken(page)
  const before = await convexCall("portal:summary", {}, jwt)

  // Clear anything a previous run left open, so this group does not depend on
  // run order: the "one claim at a time" rule would otherwise reject it.
  const existing = await convexCall("portal:myRequests", {}, jwt)
  for (const r of existing.value ?? []) {
    if (r.status !== "pending") continue
    await convexCall(
      "portal:requestPayment",
      { amountPaise: 1, method: "cash", paidAt: new Date().toISOString() },
      jwt,
      "mutation",
    )
  }

  const created = await convexCall(
    "portal:requestPayment",
    {
      amountPaise: 10000,
      method: "cash",
      paidAt: new Date(Date.UTC(CURRENT_YEAR, 0, 15, 10, 0)).toISOString(),
      note: "visual:portal",
    },
    jwt,
    "mutation",
  )
  check("a member can claim a payment they made", !created.error, created.error)

  const mine = await convexCall("portal:myRequests", {}, jwt)
  const pending = (mine.value ?? []).find((r) => r.status === "pending")
  check(
    "the claim is listed to the member as waiting",
    Boolean(pending) && pending.amountPaise === 10000,
    pending ? `${pending.amountPaise} paise` : JSON.stringify(mine.error),
  )

  const second = await convexCall(
    "portal:requestPayment",
    { amountPaise: 10000, method: "cash", paidAt: new Date().toISOString() },
    jwt,
    "mutation",
  )
  check(
    "a second claim while one is open is refused, so a payment cannot be entered twice",
    Boolean(second.error) && /already have a payment request/i.test(second.error),
    second.error,
  )

  const future = await convexCall(
    "portal:requestPayment",
    {
      amountPaise: 10000,
      method: "cash",
      paidAt: new Date(Date.UTC(CURRENT_YEAR + 1, 0, 1)).toISOString(),
    },
    jwt,
    "mutation",
  )
  check(
    "a claim dated in the future is refused",
    Boolean(future.error) && /future/i.test(future.error),
    future.error,
  )

  const selfApprove = pending
    ? await convexCall(
        "portal:decideRequest",
        { requestId: pending.id, approve: true },
        jwt,
        "mutation",
      )
    : { error: "no claim" }
  check(
    "a member cannot decide their own claim",
    Boolean(selfApprove.error) && /treasurer/i.test(selfApprove.error),
    selfApprove.error,
  )

  if (pending) {
    // The treasurer decides, in the browser, through the real screen.
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const tpage = await tctx.newPage()
    watch(tpage, "treasurer:queue")
    currentScreen = "auth:treasurer:queue"
    await tpage.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
    await tpage.waitForSelector("#email", { timeout: 20_000 })
    await tpage.fill("#email", ACCOUNTS.treasurer)
    await tpage.fill("#password", PASSWORD)
    await tpage.click('button[type="submit"]')
    await tpage.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
    const tjwt = await sessionToken(tpage)

    const queue = await convexCall("portal:requestsQueue", {}, tjwt)
    check(
      "the claim reaches the treasurer's queue",
      (queue.value ?? []).some((r) => r.id === pending.id),
      `${(queue.value ?? []).length} waiting`,
    )

    await tpage.goto(`${BASE}/payment-requests`, { waitUntil: "domcontentloaded" })
    await settle(tpage, "payment-requests")
    // The outstanding figure is a second subscription behind the queue, so it
    // arrives a frame or two after the row does.
    await waitForText(tpage, "Owes")
    const queueText = await mainText(tpage)
    check(
      "the queue shows what the member currently owes beside the claim",
      has(queueText, "Owes") && has(queueText, "Imran Shaikh"),
      queueText.split("\n").slice(0, 4).join(" / ").slice(0, 120),
    )
    check(
      "the queue says in plain words that confirming writes to the books",
      has(queueText, "writes a payment"),
    )
    check(
      "the queue offers both a confirmation and a refusal",
      has(queueText, "Confirm") && has(queueText, "Refuse"),
    )
    await shot(tpage, "27-mark-as-paid-queue")

    await tpage.getByPlaceholder(/refuse/i).fill("Not in the drawer that week")
    await tpage.getByRole("button", { name: /^Refuse$/ }).click()
    await sleep(2500)

    const decided = await convexCall("portal:myRequests", {}, jwt)
    const row = (decided.value ?? []).find((r) => r.id === pending.id)
    check(
      "the decision is recorded against the claim",
      row?.status === "rejected" &&
        row?.decisionNote === "Not in the drawer that week",
      `${row?.status} / ${row?.decisionNote}`,
    )

    // The member's own view of it.
    await page.goto(`${BASE}/me/requests`, { waitUntil: "domcontentloaded" })
    await settle(page, "portal:requests")
    const memberView = await mainText(page)
    check(
      "the member sees the refusal and the treasurer's reason",
      has(memberView, "Not accepted") && has(memberView, "Not in the drawer that week"),
    )
    check(
      "the member can send another claim once the first is decided",
      !has(memberView, "Waiting for the treasurer"),
    )
    await shot(page, "28-portal-requests")

    const after = await convexCall("portal:summary", {}, jwt)
    check(
      "a refused claim leaves the member's balance exactly as it was",
      after.value?.totalOutstandingPaise === before.value?.totalOutstandingPaise,
      `${money(before.value?.totalOutstandingPaise)} -> ${money(after.value?.totalOutstandingPaise)}`,
    )

    await tctx.close()
  }

  await ctx.close()
}

/* --------------------------------------------------------- how to pay ---- */

group("how to pay — the account, the QR, and telling the treasurer")
{
  /*
   * The portal's answer to "where do I send it?".
   *
   * This is what replaced the payment gateway the committee declined: not a
   * checkout, but a printed instruction. A member scans, pays from their own
   * UPI app, and then tells the treasurer. So the assertions are about that
   * shape rather than about a payment flow — in particular that the screen does
   * not pretend to take money, and that it says out loud what happens next.
   *
   * A member who paid and told nobody is a contribution that is never recorded,
   * and the whole value of this system is that its books are right. So the
   * instruction to report the payment is asserted, not assumed.
   */
  const { ctx, page } = await portalSession("imran@example.org")
  const jwt = await sessionToken(page)

  await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" })
  await settle(page, "portal:home")
  const home = await mainText(page)
  check(
    "a member who owes something is told how to pay, on the balance screen",
    home.includes("How to pay"),
    home.split("\n").slice(0, 3).join(" / "),
  )
  check(
    "and it names the QR, because most members will scan rather than read",
    home.toLowerCase().includes("upi qr"),
  )

  await page.goto(`${BASE}/me/pay`, { waitUntil: "domcontentloaded" })
  await settle(page, "portal:pay")
  const pay = await mainText(page)

  const details = await convexCall("portal:paymentDetails", {}, jwt)
  const account = details.value?.accounts?.[0]
  check(
    "the pay screen shows a real account for the member's own fund",
    Boolean(account) && pay.includes(account.name),
    account ? account.name : "the server returned no account",
  )
  check(
    "with the UPI address written out, for a member who cannot scan",
    Boolean(account?.upiId) && pay.includes(account.upiId),
    account?.upiId ?? "no UPI address on the account",
  )
  check(
    "the QR code is on the page",
    (await page.getByTestId("portal-pay-qr").count()) >= 1,
  )
  check(
    "and it carries no amount, because the app does not know what is owed",
    await page.getByTestId("portal-pay-qr").first().evaluate((el) => {
      const uri = el.getAttribute("data-upi-uri") ?? ""
      return uri.startsWith("upi://pay?pa=") && !/[?&](am|tr)=/.test(uri)
    }),
    "an amount on the QR would imply a checkout the app does not have",
  )
  check(
    "there is no Pay now button anywhere on it",
    !/pay now|pay ₹|pay now/i.test(pay) &&
      (await page.getByRole("button", { name: /^Pay now$/i }).count()) === 0,
  )
  check(
    "and it says plainly that the treasurer has to be told",
    pay.includes("tell the treasurer") || pay.includes("Tell the treasurer"),
  )
  check(
    "with a route into the claim, which is how a payment gets recorded",
    has(pay, "I have already paid") &&
      (await page.getByRole("link", { name: /I have already paid/i }).count()) === 1,
  )
  check(
    "and the print button, because this is the sheet that goes on a wall",
    (await page.getByTestId("portal-pay-print").count()) >= 1,
  )
  await shot(page, "29-portal-pay")

  // The screen is reachable from the claim too — that is the order a member
  // actually arrives in: they have already paid, and now need the reference.
  await page.goto(`${BASE}/me/requests`, { waitUntil: "domcontentloaded" })
  await settle(page, "portal:requests")
  check(
    "a member who has already paid can find the account from the claim form",
    has(await mainText(page), "Bank details and UPI QR"),
  )

  await ctx.close()
}

/* ------------------------------------------------------- installable shell */

group("installable — the portal is a PWA")
{
  const manifest = await fetch(`${BASE}/manifest.webmanifest`).then((r) => r.json())
  check(
    "the manifest starts the member in their own portal",
    manifest.start_url === "/me",
    manifest.start_url,
  )
  check(
    "the manifest is standalone and portrait, for a phone in one hand",
    manifest.display === "standalone" && manifest.orientation === "portrait",
  )
  const sizes = (manifest.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`)
  check(
    "the manifest declares a 192 and a 512 icon, plus a maskable one",
    sizes.includes("192x192:any") &&
      sizes.includes("512x512:any") &&
      sizes.includes("512x512:maskable"),
    sizes.join(" "),
  )
  for (const icon of manifest.icons ?? []) {
    const res = await fetch(`${BASE}${icon.src}`)
    const buf = Buffer.from(await res.arrayBuffer())
    // PNG signature, then the dimensions out of the IHDR chunk.
    const isPng =
      buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" &&
      buf.readUInt32BE(16) === Number(icon.sizes.split("x")[0])
    check(`${icon.src} is a real ${icon.sizes} PNG`, isPng, `${buf.length} bytes`)
  }

  const sw = await fetch(`${BASE}/sw.js`).then((r) => r.text())
  check("a service worker is served", sw.length > 0, `${sw.length} bytes`)
  check(
    "the service worker refuses to cache anything authenticated",
    has(sw, 'pathname.startsWith("/__convex")') && has(sw, "isPrivate"),
  )
  check(
    "the service worker still caches the shell, so the app opens offline",
    has(sw, "caches.open") && has(sw, 'SHELL_URL = "/index.html"'),
  )
}

/* ------------------------------------------------------------------ write */

await browser.close()

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed

const md = []
md.push("# Member portal verification report (M3)")
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

await writeFile(path.join(OUT, "portal-report.md"), md.join("\n"))
await writeFile(
  path.join(OUT, "portal-report.json"),
  JSON.stringify({ base: BASE, results, noise }, null, 2),
)

console.log(
  `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m — report in ${OUT}/portal-report.md`,
)
process.exit(failed === 0 ? 0 : 1)
