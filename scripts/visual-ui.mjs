/**
 * UI regression checks — 30 assertions about the things a payload, smoke or
 * desktop-visual test cannot see.
 *
 *   bun run visual:ui
 *
 * Why this is a separate file rather than more groups inside `visual-check.mjs`:
 * these checks are about *reaching* and *holding* things rather than about a
 * screen's numbers, they need their own browser contexts and their own
 * viewports, and keeping them apart means a phone regression cannot be mistaken
 * for a broken ledger. The console suite is 217 assertions about the desk at
 * 1440px; this is 30 about a 390px phone, the theme, and the palette.
 *
 * Three groups, each written because something was actually broken:
 *
 *   1. **A phone can reach every screen.** The console had no navigation below
 *      the `lg` breakpoint at all — the sidebar is `hidden lg:flex` and the phone
 *      header carried only the logo, the theme toggle and a sign-out button, so
 *      twelve of thirteen routes were unreachable on a phone. Every other suite
 *      passed throughout, because every other suite drove a desktop viewport.
 *   2. **Both applications remember the theme.** The portal's copy of the theme
 *      hook set the class but never wrote `localStorage`; the console's did. A
 *      member is never shown the console, so the working half of the pair was
 *      exactly the half they never load.
 *   3. **The palette meets contrast.** Every colour token was replaced, and the
 *      thing a token retune breaks silently is text contrast — nothing crashes,
 *      a treasurer simply cannot read the screen. Measured from the computed
 *      style in both themes rather than asserted by hand.
 */

import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:5173"
const OUT = process.env.VISUAL_OUT ?? ".visual"
const PASSWORD = process.env.DEMO_PASSWORD ?? "community123"

const ACCOUNTS = {
  admin: "secretary@jamaat.org",
  member: "imran@example.org",
}

/** The phone this product is actually designed for. */
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

await mkdir(OUT, { recursive: true })

const results = []
const noise = []
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

const has = (haystack, needle) =>
  haystack.toLowerCase().includes(needle.toLowerCase())

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait for a screen to have actually rendered.
 *
 * The order matters and was the cause of three mystery failures elsewhere in
 * this suite: wait for `main` to exist, *then* wait for the spinner to go. The
 * obvious one-liner — "no `.animate-spin` in main" — is true of `document.body`
 * before the app has mounted at all, so it returns instantly and every assertion
 * after it reads a blank page. `main` is rendered by the shell in the same
 * commit as the Suspense fallback inside it, so once it exists either the
 * spinner is there or the screen genuinely is.
 */
async function settle(page, label) {
  currentGroup = label
  await page.waitForLoadState("domcontentloaded")
  try {
    await page.waitForSelector("main", { timeout: 25_000 })
  } catch {
    /* reported as a stuck loader by the caller's assertions */
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
    /* ditto */
  }
  await sleep(400)
}

function watch(page, label) {
  page.on("pageerror", (e) => noise.push({ screen: label, text: String(e).slice(0, 300) }))
  page.on("console", (m) => {
    if (m.type() !== "error") return
    noise.push({ screen: label, text: m.text().slice(0, 300) })
  })
}

async function signIn(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#email", { timeout: 20_000 })
  await page.fill("#email", email)
  await page.fill("#password", PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 })
}

// See the note in visual-check.mjs: a container's `/dev/shm` is 64 MB, Chromium
// renderers get killed when a page needs more, and Playwright reports it as
// `Target crashed` — which reads exactly like an application bug. This suite
// drives a phone-sized page full of screenshots, so it is the one most exposed.
const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
})

/* ------------------------------------------ the console on a phone */

group("a phone can reach every screen")
{
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  watch(page, "mobile console")

  await signIn(page, ACCOUNTS.admin)
  await settle(page, "mobile console /")

  /*
   * This is the regression that matters. The console's sidebar is
   * `hidden lg:flex` and the phone header used to carry only the logo, the
   * theme toggle and a sign-out button — so a treasurer on a phone could see
   * the dashboard and reach none of the other twelve routes. Every other suite
   * in this repo passed while that was true, because every other suite drove a
   * desktop viewport.
   */
  const menu = await page.$('button[aria-label="Open navigation"]')
  check(
    "the phone header offers a way into the navigation",
    menu !== null,
    (await page.innerText("header").catch(() => "")).replace(/\s+/g, " "),
  )

  if (menu) {
    await menu.click()
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })
    const drawer = await page.innerText('[role="dialog"]')
    check(
      "the drawer lists the console's destinations",
      ["Funds", "Members", "Contributions", "Reconciliation", "Reports"].every((l) =>
        has(drawer, l),
      ),
      drawer.replace(/\s+/g, " ").slice(0, 140),
    )
    check(
      "an admin is offered the Administration section",
      has(drawer, "Administration"),
    )
    check(
      "the drawer carries the position summary the sidebar carries",
      has(drawer, "Total across funds") && /\d+ members · \d+ funds/.test(drawer),
      drawer.replace(/\s+/g, " ").slice(0, 180),
    )
    check(
      "the arrears count a treasurer looks for is still on the phone",
      /\d+ in arrears/.test(drawer),
      drawer.replace(/\s+/g, " ").slice(0, 220),
    )
    await page.screenshot({ path: path.join(OUT, "ui-01-mobile-drawer.png") })

    // Following a link has to close the drawer. Without that it feels like a
    // menu you have to dismiss by hand after every single tap.
    await page.click('[role="dialog"] a[href="/funds"]')
    await page.waitForURL((u) => u.pathname === "/funds", { timeout: 15_000 })
    await settle(page, "mobile console /funds")
    const stillOpen = await page.$('[role="dialog"]')
    check(
      "following a drawer link navigates and closes the drawer",
      stillOpen === null && has(await page.innerText("main"), "Funds"),
      new URL(page.url()).pathname,
    )
    await page.screenshot({
      path: path.join(OUT, "ui-02-mobile-funds.png"),
      fullPage: true,
    })
  }

  await ctx.close()
}

/* ------------------------------------------- the theme is remembered */

group("the console remembers the theme")
{
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  watch(page, "console theme")

  await signIn(page, ACCOUNTS.admin)
  await settle(page, "console theme /")

  const before = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  await page.click('button[aria-label="Toggle theme"]')
  await sleep(500)
  const after = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  check(
    "the toggle flips the theme",
    after !== before,
    `${before ? "dark" : "light"} -> ${after ? "dark" : "light"}`,
  )

  await page.reload({ waitUntil: "domcontentloaded" })
  await settle(page, "console theme reload")
  const afterReload = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  check(
    "the choice survives a reload",
    afterReload === after,
    `expected ${after ? "dark" : "light"}, got ${afterReload ? "dark" : "light"}`,
  )
  await ctx.close()
}

group("the portal remembers the theme")
{
  /*
   * This one was a real bug with a confusing symptom. The portal shell had its
   * own copy of the theme hook that set the class but never wrote it to
   * `localStorage`, so a member who tapped the sun/moon button and then reloaded
   * got the old theme back — and the console's copy *did* persist, so nothing
   * looked wrong in testing. A member is never shown the console, which means
   * the half of the pair that worked was precisely the half a member never
   * loads. One shared hook fixed it; this holds both halves to it.
   */
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  watch(page, "portal theme")

  await signIn(page, ACCOUNTS.member)
  await page.waitForURL((u) => u.pathname === "/me", { timeout: 20_000 })
  await settle(page, "portal theme /me")

  const before = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  await page.click('button[aria-label="Toggle theme"]')
  await sleep(500)
  const after = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  check(
    "the portal toggle flips the theme",
    after !== before,
    `${before ? "dark" : "light"} -> ${after ? "dark" : "light"}`,
  )

  await page.reload({ waitUntil: "domcontentloaded" })
  await settle(page, "portal theme reload")
  const afterReload = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  check(
    "the member's choice survives a reload",
    afterReload === after,
    `expected ${after ? "dark" : "light"}, got ${afterReload ? "dark" : "light"}`,
  )
  await page.screenshot({
    path: path.join(OUT, "ui-03-portal-theme.png"),
    fullPage: true,
  })
  await ctx.close()
}

/* ------------------------------------------- the palette is actually legible */

group("the palette meets contrast")
{
  /*
   * Every colour token in the app was replaced during the UI work, and the one
   * thing a token retune breaks silently is text contrast: nothing crashes,
   * nothing fails, and a treasurer simply cannot read the screen. The old
   * chart-3 green at 58% lightness was already borderline at 11px.
   *
   * Measured rather than asserted by hand, in both themes, at the sizes these
   * are actually rendered. WCAG AA is 4.5:1 for body text and 3:1 for large
   * text and for the non-text parts of a control.
   *
   * Colours are read from the computed style, so this tests the CSS cascade as
   * shipped — a token that is overridden, or a class that loses to a later one,
   * shows up here rather than in a design review.
   */
  const PROBE = `(() => {
    const parse = (c) => {
      const m = c.match(/[\\d.]+/g)
      if (!m) return null
      return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 }
    }
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    })
    const lum = (c) => {
      const f = (v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    const bgOf = (el) => {
      let node = el
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor)
        if (c && c.a > 0) return node === el ? c : over(c, bgOf(node.parentElement))
        node = node.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    // Two kinds of thing need checking and they are not the same measurement:
    //
    //   "self"  — the element's text colour against its own background. This is
    //              a button label, a badge, a nav item.
    //   "edge"  — the element's own background against its parent's. This is a
    //              meter fill against its track, or a card border against the
    //              page behind it. There is no text involved at all, and the bar
    //              is 3:1, not 4.5:1.
    //
    // Getting this wrong is not subtle once you look at the reported colours: an
    // earlier version of this probe measured the meter's *inherited* text colour
    // against its fill and produced a confident, meaningless 1.51:1.
    // \`.text-success\` only appears on the dashboard when nobody owes anything,
    // and the seed data always owes something, so probing for it in the live DOM
    // reports "missing" for a reason that has nothing to do with contrast. The
    // same goes for any other token that is only used on one branch of the UI.
    // Instead each such class is mounted on a real element inside \`main\` for
    // the duration of the probe, so the cascade resolves it exactly as it would
    // in the product and the check holds whichever way the data falls.
    const injected = []
    for (const cls of ["text-success", "text-chart-3", "text-chart-4", "text-destructive"]) {
      const el = document.createElement("span")
      el.className = cls
      el.textContent = "Ag"
      const host = document.querySelector("main")
      if (host) host.appendChild(el)
      injected.push(el)
    }

    const TARGETS = [
      // Not \`button.bg-primary\`: the dashboard's primary action is
      // \`<Button asChild>\`, so it renders an \`<a>\` and a button selector
      // matches nothing.
      { name: "primary button label", sel: ".bg-primary", min: 4.5, pair: "self" },
      { name: "body text", sel: "main p, main h1", min: 4.5, pair: "self" },
      { name: "muted text", sel: "main .text-muted-foreground", min: 4.5, pair: "self" },
      { name: "success text", sel: "__probe__ text-success", min: 4.5, pair: "self" },
      { name: "sidebar nav label", sel: "aside a span", min: 4.5, pair: "self" },
      // The count badge inside the nav, which is dark text on a saffron pill and
      // so is the tightest pairing in the sidebar.
      { name: "sidebar count badge", sel: "aside .tabular", min: 4.5, pair: "self" },
      { name: "sidebar position total", sel: "aside .text-lg", min: 4.5, pair: "self" },
      { name: "stat card icon chip", sel: "main .text-accent-foreground", min: 4.5, pair: "self" },
      { name: "collection meter fill", sel: "main [role=progressbar] > div", min: 3, pair: "edge" },
      // Measured from \`borderTopColor\`, not from a background. A border is not
      // a fill, and comparing the card's own background to the page behind it
      // reports something about the card's fill that nobody asked about.
      { name: "card edge", sel: "main article, main [class*=rounded-xl]", min: 1.25, pair: "border" },
    ]
    const out = TARGETS.map((t) => {
      const selector = t.sel.replace("__probe__ ", "")
      const el = t.sel.startsWith("__probe__")
        ? injected.find((n) => n.className === selector)
        : document.querySelector(selector)
      if (!el) return { ...t, missing: true }
      const cs = getComputedStyle(el)
      const size = parseFloat(cs.fontSize)
      const weight = Number(cs.fontWeight) || 400
      // WCAG "large" is 24px, or 18.66px bold.
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      const min = large ? Math.max(3, Math.min(t.min, 3)) : t.min

      if (t.pair === "border") {
        const edge = parse(cs.borderTopColor)
        const face = bgOf(el)
        return {
          name: t.name,
          missing: false,
          size,
          color: cs.borderTopColor,
          background: getComputedStyle(el).backgroundColor,
          ratio: Number(ratio(over(edge, face), face).toFixed(2)),
          min: t.min,
        }
      }

      if (t.pair === "edge") {
        // A graphic, not text: the element's fill against what sits behind it.
        const fill = parse(cs.backgroundColor)
        const behind = bgOf(el.parentElement)
        const solid = fill && fill.a > 0 ? over(fill, behind) : behind
        return {
          name: t.name,
          missing: false,
          size,
          color: cs.backgroundColor,
          background: getComputedStyle(el.parentElement ?? document.body).backgroundColor,
          ratio: Number(ratio(solid, behind).toFixed(2)),
          min,
        }
      }

      const fg = parse(cs.color)
      // The element's *own* background is what its text sits on.
      const bg = bgOf(el)
      return {
        name: t.name,
        missing: false,
        size,
        color: cs.color,
        background: getComputedStyle(el).backgroundColor,
        ratio: Number(ratio(over(fg, bg), bg).toFixed(2)),
        min,
      }
    })
    injected.forEach((n) => n.remove())
    return out
  })()`

  for (const dark of [false, true]) {
    const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    watch(page, `contrast dark=${dark}`)
    await signIn(page, ACCOUNTS.admin)
    if (dark) {
      await page.click('button[aria-label="Toggle theme"]')
      await sleep(500)
    }
    await settle(page, `contrast dark=${dark} /`)
    const theme = await page.evaluate(
      () => document.documentElement.classList.contains("dark") ? "dark" : "light",
    )
    const probes = await page.evaluate(PROBE)

    for (const p of probes) {
      if (p.missing) {
        check(`${theme}: ${p.name} is present`, false, "selector matched nothing")
        continue
      }
      check(
        `${theme}: ${p.name} is legible (${p.ratio}:1 at ${p.size}px, needs ${p.min}:1)`,
        p.ratio >= p.min,
        `${p.ratio}:1 — ${p.color} on ${p.background}`,
      )
    }
    await ctx.close()
  }
}

await browser.close()

/* ----------------------------------------------------------------- report */

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed

const md = []
md.push("# UI regression report")
md.push("")
md.push(`${passed} passed, ${failed} failed`)
md.push("")
for (const groupName of [...new Set(results.map((r) => r.group))]) {
  md.push(`## ${groupName}`)
  md.push("")
  for (const r of results.filter((x) => x.group === groupName)) {
    md.push(`- **${r.ok ? "PASS" : "FAIL"}** — ${r.name}${r.detail ? ` _(${r.detail})_` : ""}`)
  }
  md.push("")
}
md.push("## Browser noise")
md.push("")
md.push("```json")
md.push(JSON.stringify(noise, null, 2))
md.push("```")

await writeFile(path.join(OUT, "ui-report.md"), md.join("\n"))
await writeFile(
  path.join(OUT, "ui-report.json"),
  JSON.stringify({ base: BASE, results, noise }, null, 2),
)

console.log(
  `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m — report in ${OUT}/ui-report.md`,
)
if (noise.length > 0) {
  console.log(`\x1b[33m${noise.length} browser error(s) recorded\x1b[0m`)
}
process.exit(failed === 0 ? 0 : 1)
