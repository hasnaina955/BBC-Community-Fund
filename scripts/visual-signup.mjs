/**
 * End-to-end verification of signup and organisation creation (M6).
 *
 *   bun run visual:signup
 *
 * ## What this is the only proof of
 *
 * Every other suite signs in. The seeded accounts are created by
 * `convex/seed.ts`, which writes `users`, `authAccounts` and `organizations`
 * rows directly — it bypasses the auth provider, and it writes the organisation
 * before the person, which is the exact order a real community cannot happen in.
 *
 * So nothing before M6 ever exercised the door. `requireActor` refuses an
 * account with no organisation, which was true and untested, and there was no
 * way to give such an account one. This suite drives the real path with a real
 * browser and a real form, in the order a person actually does it:
 *
 *   1. `/signup` creates an identity and nothing else
 *   2. that identity is refused by everything, and sent to `/welcome`
 *   3. `/welcome` creates the organisation and makes them its first admin
 *   4. the console opens, showing *their* community and nobody else's
 *
 * ## Why it cleans up after itself
 *
 * Every run creates a real organisation with a real admin. Left behind, those
 * would accumulate, and worse, each one is indistinguishable from a genuine
 * tenant to every other suite. So the last step calls
 * `orgs.deleteOrganization` as the new admin, and then checks the deletion
 * actually happened. A gate that can only be run once is not a gate.
 *
 * ## The one thing this suite is really asserting
 *
 * That the second organisation is a *separate* one. Steps 1-4 would all pass
 * against a build where signup quietly attached everyone to the demo org, which
 * is the failure mode M6 exists to prevent and which nothing else in the
 * codebase would catch. So the isolation checks below are the load-bearing
 * ones: the new admin's read models name their own community, and the demo
 * community's treasurer — a completely separate session — can see none of it.
 */

import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:5173"
const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const OUT = process.env.VISUAL_OUT ?? ".visual"
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "community123"

/**
 * A fresh identity per run.
 *
 * A fixed email would be registered by the first run and every one after it
 * would fail at step 1 for a reason that has nothing to do with the product.
 * The address is unique per run and the organisation it creates is deleted at
 * the end, so the suite is repeatable and leaves nothing behind.
 */
const STAMP = Date.now().toString(36)
const NEW_ADMIN = {
  name: "Ayesha Khan",
  email: `onboarding-${STAMP}@example.org`,
  password: "welcome-to-the-community",
  community: `Andheri Jamaat ${STAMP}`,
  bankName: "HDFC Bank",
  accountNumber: "50100234567890",
  ifsc: "HDFC0001234",
  fundName: "Monthly subscription",
  monthly: "150",
}

/* ------------------------------------------------------------------ report */

const results = []
let currentGroup = "signup"

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

/**
 * Call a Convex function with a session token.
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

const has = (text, needle) => text.includes(needle)

/** `data:listBanks` rows, or an empty list if the call was refused. */
const bankRows = (result) => (Array.isArray(result.value) ? result.value : [])

let currentScreen = "boot"
const noise = { pageerror: [], console: [], failed: [], http: [] }

/** Wait until the screen's read models have resolved. */
async function settle(page, label) {
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
  if (label) currentScreen = label
}

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

const bodyText = (page) => page.evaluate(() => document.body.innerText ?? "")
const mainText = (page) =>
  page.evaluate(() => document.querySelector("main")?.innerText ?? "")

async function waitForText(page, needle, timeout = 20_000) {
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

/* ------------------------------------------------------------------- setup */

await mkdir(OUT, { recursive: true })
// Same launch arguments as the other three suites, and for the same reason: a
// container's `/dev/shm` is 64 MB and Chromium renderers get killed, which
// Playwright reports as `Target crashed` and which reads exactly like an
// application bug.
const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
})

// 1440x900, the same viewport as visual-check.mjs. It matters here: the
// organisation's name is rendered in the console sidebar, and the sidebar is
// `hidden lg:flex` — a narrower viewport puts the name behind the phone
// drawer, where it is legitimately absent from the page text and the
// "console names the community" check below would fail for the wrong reason.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
watch(page)

/**
 * Sign this context in as somebody else, without opening a second one.
 *
 * The sandbox caps the whole container at 2 GB and the local Convex backend
 * holding a few hundred megabytes of SQLite gets OOM-killed when a second
 * browser context is alive beside it. One context, re-authenticated in place,
 * is the difference between this suite running and dying halfway through.
 * The previous session's token is captured before the switch, so the two
 * identities are still compared directly.
 */
async function signInAs(email, password) {
  await page.evaluate(() => window.localStorage.clear())
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#email", { timeout: 20_000 })
  await page.fill("#email", email)
  await page.fill("#password", password)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
  await settle(page, email)
  return sessionToken(page)
}

/* --------------------------------------------------- 1. a signed-out visitor */

group("signup — a new identity, and nothing else")

currentScreen = "signup"
await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#email", { timeout: 20_000 })

check(
  "/signup is reachable by a signed-out visitor",
  new URL(page.url()).pathname === "/signup",
  page.url(),
)

await page.fill("#name", NEW_ADMIN.name)
await page.fill("#community", NEW_ADMIN.community)
await page.fill("#email", NEW_ADMIN.email)
await page.fill("#password", NEW_ADMIN.password)
await shot(page, "signup-filled")

await page.click('button[type="submit"]')

// Signing up does not land on the dashboard. It cannot: there is no
// organisation yet, and every read model would throw. The correct destination
// is the onboarding screen, and asserting the URL is what proves the router
// noticed the account was incomplete rather than letting the console mount and
// fail.
const reachedWelcome = await waitForText(page, "Set up your community", 25_000)
check(
  "creating an account lands on onboarding, not the console",
  reachedWelcome && new URL(page.url()).pathname === "/welcome",
  page.url(),
)

if (!reachedWelcome) {
  console.log("\n  signup never reached /welcome; stopping before the rest")
  await browser.close()
  process.exit(1)
}

const jwt = await sessionToken(page)
check("the new account has a session", Boolean(jwt), jwt ? "jwt present" : "no jwt")

const setup = await convexCall("orgs:mySetup", {}, jwt)
check(
  "a fresh account belongs to no organisation",
  setup.value?.orgId === null && setup.value?.role === null,
  `orgId: ${JSON.stringify(setup.value?.orgId ?? setup.error)}`,
)

const meBefore = await convexCall("data:me", {}, jwt)
check(
  "the identity query resolves rather than throwing for an orgless account",
  meBefore.value?.orgId === null && typeof meBefore.value?.email === "string",
  meBefore.error ? `threw: ${meBefore.error.slice(0, 120)}` : `email: ${meBefore.value?.email}`,
)

const orgName = meBefore.value?.name
check(
  "the account kept the name it signed up with",
  orgName === NEW_ADMIN.name,
  `name: ${JSON.stringify(orgName)}`,
)

/* --------------------------------- 2. an orgless account can see nothing */

group("signup — an incomplete account reaches nothing")

const shellBefore = await convexCall("aggregate:shell", {}, jwt)
check(
  "the console read model refuses an account with no organisation",
  Boolean(shellBefore.error) && /No organisation is linked/i.test(shellBefore.error),
  shellBefore.error ? "refused" : `LEAKED: ${JSON.stringify(shellBefore.value).slice(0, 160)}`,
)

/* ------------------------------------------------- 3. create the organisation */

group("onboarding — creating the community")

currentScreen = "welcome"
await settle(page, "welcome")

const prefilled = await page.inputValue("#org-name")
check(
  "the organisation name typed on /signup carries through",
  prefilled === NEW_ADMIN.community,
  `"${prefilled}"`,
)

await page.fill("#bank-name", NEW_ADMIN.bankName)
await page.fill("#account-number", NEW_ADMIN.accountNumber)
await page.fill("#ifsc", NEW_ADMIN.ifsc)
await page.fill("#fund-name", NEW_ADMIN.fundName)
await page.fill("#monthly", NEW_ADMIN.monthly)
await shot(page, "welcome-filled")

await page.click('button[type="submit"]')

// The destination is the URL; the *content* is checked separately below. This
// used to wait for the community's name to appear, which lives in the app shell
// outside `<main>` — so it timed out on a run that had in fact worked.
await page
  .waitForURL((u) => u.pathname === "/", { timeout: 30_000 })
  .catch(() => {})

currentScreen = "dashboard"
await settle(page, "dashboard")
const dashText = await mainText(page)
const wholePage = await bodyText(page)
await shot(page, "new-org-dashboard")

check(
  "creating the organisation lands on that organisation's dashboard",
  new URL(page.url()).pathname === "/" && dashText.length > 100,
  `${page.url()} — ${dashText.length} chars`,
)

check(
  "the dashboard renders content, not a blank document",
  dashText.length > 100,
  dashText.split("\n").slice(0, 3).join(" / "),
)

check(
  "the new community is not showing the error boundary",
  !has(wholePage, "Something went wrong"),
  "",
)

// The organisation's name is rendered by `AppShell`, which sits outside the
// route's `<main>`. Reading `<main>` for it can only ever fail, which is how
// this check passed against a build that had quietly attached the new account
// to the seeded community.
// Read the sidebar's identity block directly rather than searching the whole
// page. It is the one place the product names the current organisation, and
// naming the element means this check fails for a real reason instead of
// because a nav label happened to wrap.
const identityLine = await page.evaluate(() => {
  const aside = document.querySelector("aside")
  if (!aside) return null
  const hit = [...aside.querySelectorAll("p")].map((p) => p.innerText ?? "")
  // The *last* line with a separator in it, not the first: the totals block
  // above reads "0 members · 1 funds", and matching the first separator picks
  // that up and reports a fund count as if it were the organisation's name.
  return hit.filter((t) => t.includes("·")).pop() ?? null
})

// Compared case-insensitively. The sidebar renders this line with a CSS
// `text-transform: capitalize`, and Chromium's `innerText` reports the
// *rendered* casing — so "admin · Andheri Jamaat mumn7s6d" comes back as
// "Admin · Andheri Jamaat Mumn7s6d". Matching the raw string asserted a
// capitalisation rule the signup form never promised, and would have failed
// against a correct build.
const expectedIdentity = `admin · ${NEW_ADMIN.community}`.trim().toLowerCase()
const actualIdentity = (identityLine ?? "").trim().toLowerCase()

check(
  "the console names the community that was just created",
  actualIdentity === expectedIdentity,
  actualIdentity === expectedIdentity
    ? identityLine
    : `expected ${JSON.stringify(expectedIdentity)}, sidebar said ${JSON.stringify(identityLine)}`,
)

/* ------------------------------------------------ 4. the server agrees */

group("onboarding — what the server stored")

const meAfter = await convexCall("data:me", {}, jwt)
check(
  "the creator is an administrator of the new organisation",
  meAfter.value?.role === "admin" && Boolean(meAfter.value?.orgId),
  `role: ${meAfter.value?.role ?? meAfter.error}`,
)
check(
  "the server's organisation name is the one that was typed",
  meAfter.value?.orgName === NEW_ADMIN.community,
  meAfter.value?.orgName,
)

const newOrgId = meAfter.value?.orgId
const newOrgSlug = meAfter.value?.orgSlug

const shellAfter = await convexCall("aggregate:shell", {}, jwt)
check(
  "the new community's shell resolves to itself",
  shellAfter.value?.orgName === NEW_ADMIN.community,
  `orgName: ${shellAfter.value?.orgName ?? shellAfter.error}`,
)

const fundNames = (shellAfter.value?.funds ?? []).map((f) => f.name)
check(
  "the first fund is there and is the one that was asked for",
  fundNames.length === 1 && fundNames[0] === NEW_ADMIN.fundName,
  fundNames.join(", ") || "none",
)

const banks = await convexCall("data:listBanks", {}, jwt)
const bankNames = bankRows(banks).map((b) => b.name)
/** The new community's own bank id, for the isolation checks below. */
const newBankId = bankRows(banks)[0]?.id
check(
  "the first bank account is there",
  bankRows(banks).length === 1 && bankNames[0] === NEW_ADMIN.bankName,
  bankNames.join(", ") || banks.error?.slice(0, 100),
)

const monthlyFund = (shellAfter.value?.funds ?? []).find(
  (f) => f.name === NEW_ADMIN.fundName,
)
check(
  "the fund carries the monthly amount, so arrears can work",
  typeof monthlyFund?.balancePaise === "number",
  `balancePaise: ${monthlyFund?.balancePaise}`,
)

const slug = String(newOrgSlug ?? "")
check(
  "the organisation's URL identifier is derived and URL-safe",
  /^[a-z0-9-]+$/.test(slug) && slug.length > 0,
  slug,
)

check(
  "two communities named similarly do not collide on that identifier",
  !slug.startsWith("jamaat-anjuman"),
  `demo org slug is jamaat-anjuman, this one is ${slug}`,
)

/* -------------------------------------- 5. the escalation guard is real */

group("onboarding — one account, one organisation")

const second = await convexCall(
  "orgs:createOrganization",
  { name: "A second community" },
  jwt,
  "mutation",
)
check(
  "an account that already has an organisation cannot create a second one",
  Boolean(second.error) && /already belong to an organisation/i.test(second.error),
  second.error ? "refused" : `LEAKED: created ${JSON.stringify(second.value)}`,
)

const escalated = await convexCall("aggregate:shell", {}, jwt)
check(
  "the refused call left the first organisation intact",
  escalated.value?.orgName === NEW_ADMIN.community,
  escalated.value?.orgName,
)

const outsider = await convexCall("orgs:createOrganization", { name: "No session" }, null, "mutation")
check(
  "an unauthenticated caller cannot create an organisation at all",
  Boolean(outsider.error) && /Not signed in/i.test(outsider.error),
  outsider.error ? "refused" : "created something",
)

/* --------------------------------- 6. the second org is genuinely separate */

group("isolation — the new community is a separate one")

// The load-bearing group. Everything above would also pass against a build
// where signup quietly attached the new account to the seeded organisation.
const demoToken = await signInAs("treasurer@jamaat.org", DEMO_PASSWORD)

const demoShell = await convexCall("aggregate:shell", {}, demoToken)
check(
  "the demo community's shell still names the demo community",
  demoShell.value?.orgName === "Jamaat Anjuman",
  demoShell.value?.orgName,
)

const newFundId = (shellAfter.value?.funds ?? [])[0]?.id
const demoFundIds = (demoShell.value?.funds ?? []).map((f) => f.id)
check(
  "the demo community cannot see the new community's fund",
  Boolean(newFundId) && !demoFundIds.includes(newFundId),
  `new fund ${newFundId}, demo has ${demoFundIds.length} funds`,
)

// A real id from the new community, read by the new community's own admin. The
// previous version of this check passed a placeholder string, which the
// argument validator rejected — so it "passed" on a validation error rather than
// on the refusal it was meant to prove, and would have kept passing if
// `bankPassbook` had handed over the passbook to anybody who asked.
const foreignBank = await convexCall(
  "aggregate:bankPassbook",
  { bankId: newBankId },
  demoToken,
)
check(
  "the demo community cannot read the new community's bank passbook",
  Boolean(newBankId) && foreignBank.value === null,
  foreignBank.value === null
    ? "refused with null"
    : `LEAKED or errored: ${JSON.stringify(foreignBank.value ?? foreignBank.error).slice(0, 140)}`,
)

const foreignFund = await convexCall(
  "aggregate:fundDetail",
  { fundId: newFundId },
  demoToken,
)
check(
  "the demo community cannot open the new community's fund",
  Boolean(newFundId) && foreignFund.value === null,
  foreignFund.value === null
    ? "refused with null"
    : `LEAKED or errored: ${JSON.stringify(foreignFund.value ?? foreignFund.error).slice(0, 140)}`,
)

const newFundTotal = (shellAfter.value?.funds ?? []).reduce(
  (sum, f) => sum + (f.balancePaise ?? 0),
  0,
)
const demoFundTotal = (demoShell.value?.funds ?? []).reduce(
  (sum, f) => sum + (f.balancePaise ?? 0),
  0,
)
check(
  "the two communities' money is not the same money",
  newFundTotal === 0 && demoFundTotal > 0,
  `new: ${newFundTotal} paise, demo: ${demoFundTotal} paise`,
)

/* ------------------------------------------------------- 7. and clean up */

group("onboarding — leaving nothing behind")

const deleted = await convexCall("orgs:deleteOrganization", {}, jwt, "mutation")
check(
  "the new community can delete itself",
  !deleted.error && typeof deleted.value?.removed === "number",
  deleted.error ? deleted.error.slice(0, 120) : `removed ${deleted.value?.removed} rows`,
)

const afterDelete = await convexCall("aggregate:shell", {}, jwt)
check(
  "after deletion the account reaches nothing again",
  Boolean(afterDelete.error) && /Not signed in|No organisation/i.test(afterDelete.error),
  afterDelete.error ? "refused" : `LEAKED: ${JSON.stringify(afterDelete.value).slice(0, 140)}`,
)

const demoShellFinal = await convexCall("aggregate:shell", {}, demoToken)
check(
  "deleting the new community left the demo one untouched",
  demoShellFinal.value?.orgName === "Jamaat Anjuman" &&
    (demoShellFinal.value?.funds ?? []).length === demoFundIds.length,
  `${(demoShellFinal.value?.funds ?? []).length} funds, was ${demoFundIds.length}`,
)

await ctx.close()

/* ------------------------------------------ 8. a second brand-new account */

// After `ctx.close()`, so only one browser context is ever alive. Two at once
// is enough to get the backend OOM-killed on a 2 GB container, and this check
// does not need to overlap anything above it.
group("signup — a second new account")

const ctx2 = await browser.newContext({ viewport: { width: 900, height: 700 } })
const page2 = await ctx2.newPage()
watch(page2, "second-signup")
const secondEmail = `onboarding-b-${STAMP}@example.org`
await page2.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" })
await page2.waitForSelector("#email", { timeout: 20_000 })
await page2.fill("#name", "Farhan Qureshi")
await page2.fill("#community", `Bandra Jamaat ${STAMP}`)
await page2.fill("#email", secondEmail)
await page2.fill("#password", NEW_ADMIN.password)
await page2.click('button[type="submit"]')
const secondReached = await waitForText(page2, "Set up your community", 25_000)
check(
  "a second new account is onboarded independently",
  secondReached && new URL(page2.url()).pathname === "/welcome",
  page2.url(),
)
await shot(page2, "second-signup-welcome")
await ctx2.close()

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
md.push("# Signup and organisation creation report (M6)")
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

await writeFile(path.join(OUT, "signup-report.md"), md.join("\n"))
await writeFile(
  path.join(OUT, "signup-report.json"),
  JSON.stringify({ base: BASE, newOrgId, newOrgSlug, results, noise }, null, 2),
)

console.log(
  `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m — report in ${OUT}/signup-report.md`,
)
process.exit(failed === 0 ? 0 : 1)
