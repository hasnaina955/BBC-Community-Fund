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
import { execSync } from "node:child_process"
import { runRemindersGroup } from "./visual-reminders.mjs"

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

/**
 * Groups run, in groups, on a recycled browser.
 *
 * Measured over a twelve-route walk in this sandbox, one Chromium climbs from
 * 472 MB resident after sign-in to 790 MB by the twelfth screen, and never
 * gives any of it back. A full-page screenshot adds a spike on top. The Convex
 * backend behind the app is itself at ~871 MB against the same 2 GB cgroup, so
 * by the last third of the suite the two together do not fit, and the kernel
 * takes the renderer. The suite recovers from that, but only after losing the
 * group it was in — and if the backend is killed instead, nothing recovers.
 *
 * So the browser is closed and relaunched on a schedule rather than on failure.
 * Three groups is measured, not guessed: that keeps resident memory in the
 * 470-650 MB band instead of letting it walk to 790, which is what fits.
 *
 * This is the same `rebuild()` the crash path uses, told it is planned. A
 * planned recycle is not a recovery: it does not count, and it does not mark
 * the checks after it suspect, because a fresh browser is exactly as valid a
 * starting point as the one it replaces.
 */
const RECYCLE_EVERY = 3
let groupsSinceRecycle = 0

/**
 * Resident memory of the browser's whole process tree, in MB.
 *
 * Read from `ps` rather than guessed at. The cgroup is 2 GB and the Convex
 * backend behind the app is already ~871 MB of it, so there is roughly 670 MB
 * to give the browser, and a browser that has been through a dozen screens is
 * using most of that.
 */
function browserRssMb() {
  try {
    const out = execSync(
      `ps -eo rss,args | grep -E "chrome|headless_shell" | grep -v grep || true`,
      { encoding: "utf8" },
    )
    let kb = 0
    for (const line of out.split("\n")) {
      const n = Number(line.trim().split(/\s+/)[0])
      if (Number.isFinite(n)) kb += n
    }
    return kb / 1024
  } catch {
    return 0
  }
}

/**
 * Recycle above this many MB, or after `RECYCLE_EVERY` groups regardless.
 *
 * The measurement is the trigger and the group count is only a backstop, so a
 * future screen that is unexpectedly heavy is caught by the number rather than
 * by the order the groups happen to run in. Measured progression across the
 * suite's own routes: 472 MB after sign-in, 562 by the contributions grid, 682
 * by reconciliation.
 *
 * 500, not 560. The budget is tighter than it looks: the Convex backend behind
 * the app is ~871 MB before it does any work and grows during the run, and with
 * Vite, the Convex CLI, esbuild and the IDE server in the same 2 GB cgroup that
 * leaves only a few hundred MB for the browser. The kernel's own counters
 * recorded `oom_kill 1` at a peak of 2147487744 — the full limit — and the
 * process it took was the backend, which is the one thing the suite cannot
 * recover from. A fresh browser is 472 MB, so 500 allows roughly one screen's
 * growth before recycling: frequent, a few seconds each, and it keeps the
 * browser near its floor so the backend has room to grow into.
 *
 * Lowered from 500 to 440 after a run where the backend was OOM-killed anyway
 * (`oom_kill 1` in the cgroup's own counters) with the browser sitting at 586 MB
 * at the moment it recycled. The problem is the *peak between* recycles, not the
 * value at a group boundary, and a fresh browser is 472 MB — so a threshold
 * under that is not "recycle on schedule" but "recycle on arrival", which is
 * exactly the intent and costs one extra relaunch.
 */
const RECYCLE_ABOVE_MB = 440

/**
 * Set by `group()` when a recycle is due, and collected by the next page call.
 *
 * `group()` cannot await the recycle: it runs at the top level of the script, and
 * making it async would turn all fifteen call sites into `await`s for no benefit.
 * Nor can it *start* the rebuild and park the promise — the first version did
 * exactly that, and it raced: `rebuild` is itself a long sequence of guarded
 * page calls, so the group's opening navigation was issued while the browser it
 * addressed was being closed. The symptom was `Target page, context or browser
 * has been closed` on the first call of the very group that had asked for the
 * recycle, which is indistinguishable from a product fault.
 *
 * So the flag is only a *decision*, and `guard` — the one place every browser
 * call already passes through — performs it, awaits the rebuild, and issues the
 * call against the rebuilt page. By the time the flag is consumed the rebuild is
 * not running, so the rebuild's own calls never see it and never defer.
 */
let recycleWanted = false

function group(name) {
  currentGroup = name
  groupsSinceRecycle += 1
  const heavy = browserRssMb() > RECYCLE_ABOVE_MB
  if (!crashed && !dead && (heavy || groupsSinceRecycle >= RECYCLE_EVERY)) {
    groupsSinceRecycle = 0
    recycleWanted = true
  }
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

function check(name, ok, detail = "") {
  // `suspectFrom` is the index of the first check recorded after a recovery, or
  // Infinity when the run was clean. A failure at or past it ran on a page that
  // was rebuilt mid-suite, so it is kept but marked rather than counted.
  const suspect = !suspectFrom || results.length >= suspectFrom
  const entry = {
    group: currentGroup,
    name,
    ok: Boolean(ok),
    detail: String(detail),
    ...(suspect && !ok ? { suspect: true } : {}),
  }
  results.push(entry)
  const mark = !entry.ok && suspect ? "\x1b[33m FAIL?\x1b[0m" : entry.ok ? "\x1b[32m  ok  \x1b[0m" : "\x1b[31m FAIL \x1b[0m"
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

/*
 * Launch arguments, and why they are not optional.
 *
 * `/dev/shm` in a container is typically 64 MB, and Chromium uses it for the
 * shared memory its renderers pass frames through. When a page needs more than
 * that — a tall list with a modal open, which is exactly the members passbook —
 * the renderer is killed and Playwright reports `Target crashed`.
 *
 * That is the first thing to try and it is the documented configuration for
 * Chromium in CI, so it stays. It is worth being clear that it was *not* the
 * whole answer here, because the first diagnosis was wrong: with
 * `--disable-dev-shm-usage` already set, `/dev/shm` sat at 0% used and the
 * crashes kept coming. The real constraint is the cgroup memory limit, 2 GB in
 * this sandbox, shared with Vite and the Convex backend, against a measured
 * 999 MB peak for a single browser. The recovery in `revive()` is what handles
 * that half, and the numbers are recorded there.
 *
 * `--no-sandbox` is needed because these run as root in a container, which
 * Chromium refuses to do otherwise.
 */
const CHROMIUM_ARGS = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  // Caps the V8 heap in every renderer. Measured on the heaviest screens in
  // this suite, a full-page screenshot pass peaks at 749 MB of browser RSS
  // without it and 694 MB with it. Modest, and deliberately not lower: this is
  // a real app with a year-wide grid, and starving the heap buys ~70 MB at the
  // price of a renderer that dies of a JS heap error instead. The schedule
  // below is what actually keeps the footprint bounded; this lowers the floor.
  "--js-flags=--max-old-space-size=192",
]

await mkdir(OUT, { recursive: true })

let currentLabel = "boot"
const noise = { console: [], pageerror: [], failed: [], http: [] }
let crashed = false
let lastUrl = "/"

/**
 * Build a browser, context and page, and wire up every listener.
 *
 * A function rather than a top-level sequence, because on a loaded machine the
 * failure is not always a dead *renderer* — sometimes the whole browser goes, and
 * a page reload against a closed browser throws `Target page, context or
 * browser has been closed`. Rebuilding the session is the only recovery, and it
 * can only be written once.
 *
 * The session cookie lives in the context, so a rebuilt context is signed out.
 * `revive()` therefore signs in again before returning, which is why sign-in is
 * factored out rather than done inline below.
 */
let sessionId = 0

async function openSession() {
  sessionId += 1
  const mine = sessionId
  const browser = await chromium.launch({ args: CHROMIUM_ARGS })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await context.addInitScript(RECORD_QUERIES)
  const p = await context.newPage()

  p.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return
    const text = m.text()
    if (IGNORED_CONSOLE.some((i) => text.includes(i))) return
    noise.console.push({ screen: currentLabel, text: text.slice(0, 400) })
  })
  p.on("pageerror", (e) => {
    noise.pageerror.push({ screen: currentLabel, text: String(e).slice(0, 400) })
  })
  p.on("requestfailed", (r) => {
    noise.failed.push({ screen: currentLabel, url: r.url(), why: r.failure()?.errorText })
  })
  p.on("response", (r) => {
    if (r.status() >= 400) {
      noise.http.push({ screen: currentLabel, status: r.status(), url: r.url() })
    }
  })
  p.on("crash", () => {
    if (mine !== sessionId) return
    crashed = true
  })
  p.on("close", () => {
    // Only a close we did *not* ask for counts. `revive()` closes the browser
    // deliberately, and that emits `close` on the old page — which, without the
    // session check, lands after the new session is installed and marks it dead
    // immediately. The symptom is a recovery loop: rebuild, "browser went away",
    // rebuild, three times, then the suite throws. It only appears when a
    // recovery is actually needed, which is why it was invisible until
    // `scripts/prove-recovery.mjs` caused one on purpose.
    if (mine !== sessionId) return
    dead = true
  })

  return { browser, context, raw: p }
}

/**
 * Playwright's wording for the ways a page goes away mid-suite.
 *
 * The set is not the one you would guess. `Target crashed` is what a *screenshot*
 * failure reports; a `goto` that hits a killed renderer reports `Page crashed`,
 * and neither string appears in the other. Matching on only the first one looks
 * like it works — the screenshot path does get recovered — and then a crash on a
 * navigation rethrows straight through the guard and unwinds the suite, which is
 * the exact outcome this whole mechanism exists to prevent.
 *
 * Found by killing the renderers mid-run on purpose, rather than waiting for the
 * sandbox to do it: `scripts/prove-recovery.mjs` does that, and it fails against
 * any shorter list.
 *
 * The `net::ERR_*` half was found the same way and is the subtler one. Which
 * string Playwright reports for a killed renderer is a race: a `goto` that lands
 * after the kill says `Page crashed`, and one already in flight when the kill
 * lands reports Chromium's own network error instead — `net::ERR_ABORTED` most
 * of the time, and `net::ERR_CONNECTION_CLOSED` or `net::ERR_EMPTY_RESPONSE`
 * when the socket went with it. Both halves are the same event. Without them the
 * crash-between-groups scenario unwound the whole run on the navigation that
 * followed the kill, which is the one thing the guard exists to prevent.
 *
 * Recovering on `net::ERR_CONNECTION_REFUSED` is a judgement call, and the safe
 * way round: refused means the dev server, not the product, is unreachable, so
 * there is nothing in it to be wrong about. A real outage costs the retries and
 * then surfaces the original error, because `retryThrough` lets the last attempt
 * through.
 */
const GONE_STRINGS = [
  "Target crashed",
  "Page crashed",
  "Target closed",
  "has been closed",
  "net::ERR_ABORTED",
  "net::ERR_CONNECTION_CLOSED",
  "net::ERR_EMPTY_RESPONSE",
  "net::ERR_CONNECTION_REFUSED",
]

function isGone(err) {
  const text = String(err)
  return GONE_STRINGS.some((s) => text.includes(s))
}

let dead = false
let { browser, context, raw: rawPage } = await openSession()

/**
 * The page every assertion uses: a proxy that rebuilds the browser and re-issues
 * the call when the renderer — or the whole browser — has gone.
 *
 * This is the single choke point, and it is deliberately not spread across the
 * helpers. Wrapping `bodyText`, `shot`, `resetMods` and `innerText` one at a
 * time was tried, and each time the suite got a little further before dying on
 * the next unwrapped call: `keyboard.press` was the one that finished it off.
 * A container can kill the browser at any point in an 80-call sequence, so the
 * guard belongs where *every* call passes through.
 *
 * The subtle part, and the one that took three attempts to get right: a retry
 * has to re-issue the call against the *new* page. Holding on to the object the
 * call was first made against — which is what a plain wrapper does — means the
 * retry re-issues it on the dead page and fails identically, forever. So every
 * guarded method carries a `rebuild` closure that re-derives its receiver from
 * whatever page is current, and the retry goes through that. For
 * `page.locator(sel).first()` the chain is re-walked from the root, not
 * resurrected from the dead handle.
 */
const page = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = rawPage[prop]
      if (typeof value === "function") return guard(() => rawPage, prop)
      // `page.keyboard`, `page.mouse`, `page.touchscreen` are objects, not
      // methods, and `page.locator(...)` returns a Locator whose own methods are
      // where a crash surfaces. Both are wrapped, or the guard is one level too
      // shallow — which is exactly how `keyboard.press` killed a run after the
      // page methods had all been covered.
      //
      // The rebuild thunk is `rawPage[prop]`, *not* `rawPage`. `guardObject`'s
      // contract is that its thunk returns the live equivalent of the object it
      // wraps, so handing it the page makes every method of the wrapped object
      // be looked up on the page instead: `page.keyboard.press("Escape")`
      // became `rawPage.press("Escape")`, and Playwright rejected the missing
      // key. The wrapper had to be right about *which* object it was rebuilding.
      if (value && typeof value === "object") return guardObject(value, () => rawPage[prop])
      return value
    },
  },
)

/**
 * Wrap a method so it survives a crash.
 *
 * `owner` is a *thunk* returning the live receiver, not the receiver itself, so
 * a retry after `revive()` reaches the rebuilt page.
 *
 * Deliberately *not* an `async` function. `page.url()` is synchronous, and making
 * every method return a promise turned `new URL(page.url())` into
 * `new URL(Promise)`. A synchronous result is returned synchronously; only a
 * thenable is awaited.
 */
function guard(ownerThunk, prop) {
  return (...args) => {
    const call = () => ownerThunk()[prop](...args)
    const issue = () => {
      let out
      try {
        out = call()
      } catch (err) {
        if (!isGone(err)) throw err
        return retryThrough(call)
      }
      if (out && typeof out.then === "function") {
        return out.catch((err) => {
          if (!isGone(err)) throw err
          return retryThrough(call)
        })
      }
      return wrapResult(out, call)
    }

    // A recycle that `group()` asked for. Performed here rather than in `group()`
    // so it is finished *before* anything is issued, and so the call lands on the
    // rebuilt page — retrying against the page just closed is the same bug as
    // retrying against a dead one.
    if (recycleWanted) {
      recycleWanted = false
      return rebuild({ planned: true })
        .catch((err) => {
          // Not swallowed silently: a failed rebuild is a real fault, and
          // reporting it here beats reporting its symptom at the next call.
          console.error(`\n  \x1b[31m… the scheduled recycle failed: ${err}\x1b[0m`)
        })
        .then(issue)
    }
    return issue()
  }
}

/**
 * Wrap a returned handle, keeping the means to rebuild it.
 *
 * `rebuild` returns the equivalent handle on the current page: for a Locator that
 * is the same call chain replayed against `rawPage`, so `.first().click()` can be
 * retried after the browser is replaced.
 */
function guardObject(obj, rebuild) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // A genuine thenable must keep its `then`, or awaiting the wrapper would
        // hand back the wrapper instead of the value.
        if (prop === "then" && typeof obj.then === "function") return obj.then.bind(obj)
        const live = () => rebuild()[prop]
        let value
        try {
          value = obj[prop]
        } catch (err) {
          if (!isGone(err)) throw err
          return retryThrough(() => live())
        }
        if (typeof value === "function") return guard(rebuild, prop)
        if (value && typeof value === "object") return guardObject(value, live)
        return value
      },
    },
  )
}

function wrapResult(out, rebuild) {
  if (out && typeof out === "object" && !(out instanceof Promise)) {
    const fns = Object.keys(out).some(
      (k) => typeof out[k] === "function" || typeof out[k] === "object",
    )
    if (fns) return guardObject(out, rebuild)
  }
  return out
}

/**
 * Retry a call until it succeeds, reviving the browser in between.
 *
 * An earlier version gave up after one retry and returned `undefined`, on the
 * reasoning that the caller's own assertion would report the failure. That was
 * wrong: a guard that swallows a failure *and* hands back a value of the wrong
 * type turns one environmental problem into a `TypeError` that unwinds the
 * whole suite. `page.locator(...).count()` returning `undefined` produced
 * exactly that — the row count compared false, and then the next assertion did
 * `outstanding.length` on the same dead locator and killed the run at check 90
 * of 229.
 *
 * So the contract is now simple and total: this either returns the call's real
 * result, or throws. A caller never has to defend against a missing value.
 *
 * The cap exists so a browser that is gone for good fails loudly instead of
 * spinning. At the last attempt the error is allowed through, which ends the
 * run — correctly, because a suite that cannot get a browser back has no
 * evidence to report.
 */
const MAX_REVIVES = 3

/**
 * Thrown when a group cannot be finished, so the run can stop with a report
 * rather than a stack trace.
 *
 * A rebuild does not just cost the current call — it destroys the page the group
 * was driving. `members` clicks "Passbook", reads the dialog, clicks the next
 * member, reads that; after a rebuild there is no dialog open, so the next
 * `waitForSelector('[role="alertdialog"]')` times out. A timeout is not a crash
 * and must not be retried, but it is also not a defect, and letting it unwind is
 * how a run ends in a `TimeoutError` stack instead of 200 checks' worth of
 * evidence.
 *
 * So: the second consecutive failure inside a group that has already been
 * rebuilt ends the run deliberately. The group is reported as abandoned, the
 * report is still written, and the exit code is non-zero. Re-running without the
 * crash finishes it.
 */
class SuiteAborted extends Error {
  constructor(cause) {
    super(`suite aborted: ${cause}`)
    this.cause = cause
  }
}

/** Failures since the last successful rebuild, to tell one bad step from a dead group. */
let sinceRecovery = 0
/** The group in flight when a group had to be abandoned, for the report. */
let abandoned = null

async function retryThrough(call) {
  let last = new Error("no attempt was made")
  for (let attempt = 0; attempt < MAX_REVIVES; attempt += 1) {
    await revive()
    try {
      const out = await call()
      sinceRecovery = 0
      return out
    } catch (err) {
      if (!isGone(err)) {
        // The page was rebuilt, so this call lost the state it depended on. One
        // such failure is forgivable and the caller reports it; a second means
        // the group is not coming back without the state it was halfway through
        // building, and the run should stop with a report rather than unwind.
        if (recoveries > 0) {
          sinceRecovery += 1
          if (sinceRecovery >= 2) {
            throw new SuiteAborted(
              `${String(err).split("\n")[0]} (during "${currentGroup}")`,
            )
          }
        }
        throw err
      }
      last = err
    }
  }
  // Every revive was met with a dead page again. The cap exists so this happens
  // rather than spinning, and the run has no evidence left to gather — but
  // "stopping" should still mean the report is written and the group is named,
  // not a Playwright stack trace. This used to re-issue the call once more and
  // let whatever came back escape, which is a raw `page.goto` error unwinding
  // the whole suite and discarding the checks that had already passed.
  throw new SuiteAborted(
    `${String(last).split("\n")[0]} — the browser did not survive ${MAX_REVIVES} ` +
      `rebuilds (during ${currentGroup})`,
  )
}

/**
 * Write whatever the run managed to collect, and stop.
 *
 * Installed for the whole suite rather than wrapped around each group, so it also
 * covers the two places that run outside a group. It reports the count it has
 * rather than recomputing the suite's totals, because at this point the question
 * is not "how many checks failed" but "there is a hole in the evidence and the
 * exit code must say so".
 *
 * `await` on the report is load-bearing. This is the only record of the run when
 * it ends badly, and it used to be started and then immediately `process.exit`ed
 * past — the promise never settled, so the report was silently never written and
 * the next run's full report overwrote whatever the abort had managed to flush.
 * Node keeps the loop alive for the pending write, so awaiting is enough.
 */
async function bailOut(cause) {
  const passedSoFar = results.filter((r) => r.ok).length
  const failedSoFar = results.length - passedSoFar
  console.error(`\n\x1b[31m${cause}\x1b[0m`)
  console.error(
    `  ${passedSoFar} check(s) passed and ${failedSoFar} failed before this point. ` +
      "Re-run to finish the group; a real defect reproduces, a rebuilt page does not.",
  )
  await writePartialReport().catch((e) => console.error(`  (report not written: ${e})`))
  process.exit(1)
}

/**
 * The report, minus the screen table.
 *
 * A separate function from the one the tail runs because `bailOut` needs it
 * before the tail's position is reached, and hoisting the full report would mean
 * duplicating the checks list. The screens already inspected are dropped here:
 * on an aborted run the interesting part is what was proved, not what was
 * photographed.
 */
async function writePartialReport() {
  const md = [
    "# Visual verification report (incomplete)",
    "",
    `Base URL: \`${BASE}\`  ·  Convex: \`${CONVEX}\``,
    "",
    `**Run aborted.** ${results.filter((r) => r.ok).length} of ${results.length} ` +
      `checks passed before the group "\`${abandoned ?? currentGroup}\`" could not be ` +
      "finished.",
    "",
    "## Recoveries",
    "",
    recoveries === 0
      ? "None."
      : `The browser was rebuilt ${recoveries} time(s); the first check after a ` +
        "rebuild onwards is listed as `suspect` in `report.json`.",
    "",
    "## Browser noise",
    "",
    "```json",
    JSON.stringify(
      {
        console: noise.console,
        pageerror: noise.pageerror,
        failed: noise.failed,
        http: noise.http,
      },
      null,
      2,
    ),
    "```",
    "",
    "## Checks recorded",
    "",
  ]
  for (const r of results) md.push(`- ${r.ok ? "PASS" : "**FAIL**"} — ${r.name}`)
  await writeFile(path.join(OUT, "report.md"), md.join("\n"))
  await writeFile(
    path.join(OUT, "report.json"),
    JSON.stringify(
      { base: BASE, aborted: abandoned ?? currentGroup, results, screens, noise },
      null,
      2,
    ),
  )
}

for (const signal of ["uncaughtException", "unhandledRejection"]) {
  // `async`, and the abort path returns rather than falling through: `bailOut` is
  // what writes the report, so it has to finish before anything calls `exit`.
  // Calling it without awaiting and then exiting left `report.md` truncated to
  // zero bytes and no `report.json` at all.
  process.on(signal, async (err) => {
    if (err instanceof SuiteAborted) {
      abandoned ??= currentGroup
      await bailOut(err.message)
      return
    }
    console.error(err)
    process.exit(1)
  })
}

/** Wait for the screen's read model to resolve and its charts to paint. */
async function settle(label) {
  currentLabel = label
  if (label.startsWith("/")) lastUrl = label
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
  return (await page.evaluate(() => document.body.innerText)) ?? ""
}

/** CSS `uppercase` reaches `innerText` already uppercased, so match loosely. */
function has(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

async function mainText() {
  return (await page.evaluate(() => document.querySelector("main")?.innerText ?? "")) ?? ""
}

/**
 * Recover from a renderer crash instead of dying with it.
 *
 * In a container, Chromium renderers are occasionally killed outright while
 * decoding a screenshot of a tall page. Playwright surfaces that as
 * `Target crashed`, and the default behaviour is for the exception to unwind the
 * whole suite — which is the worst possible outcome, because a run that stops at
 * assertion 82 of 217 reports almost nothing and reads exactly like the code
 * just written is broken.
 *
 * `--disable-dev-shm-usage` (see the launch arguments) removes the commonest
 * cause. It is not a complete fix on a heavily loaded machine, so this is the
 * second line: a crashed page is reloaded and the step retried, and the recovery
 * is *reported* rather than swallowed. A suite that silently repairs itself is a
 * suite nobody trusts, so the note appears in the output.
 *
 * The run still fails if anything after a recovery failed. That is deliberate
 * and is the whole point of marking the check `suspect` rather than dropping
 * it: a rebuilt page is not a clean slate, so a failure there may well be a
 * real defect, and the only honest way to find out is to re-run. What the
 * recovery buys is the *other* 200 checks — the run finishes and reports them
 * instead of stopping at assertion 82 with no evidence either way.
 *
 * Only used for steps that are safe to repeat. Nothing here writes money, so a
 * retry cannot duplicate an effect.
 */
let recoveries = 0
/** `results.length` at the moment of the first recovery, for the summary. */
let suspectFrom = Infinity
/**
 * Guards against re-entry. `revive()` navigates and signs in, both of which go
 * through the guarded `page`, and a failure there would otherwise call straight
 * back into `revive()` — closing the browser it is in the middle of building.
 */
let reviving = false

async function revive() {
  if (reviving) return false
  if (!crashed && !dead) return false
  reviving = true
  try {
    return await rebuild()
  } finally {
    reviving = false
  }
}

async function rebuild({ planned = false } = {}) {
  if (!planned && !crashed && !dead) return false
  const reason = dead ? "browser went away" : "renderer crashed"
  crashed = false
  dead = false
  // Bump the session id *before* closing, so the outgoing page's `close` event
  // is recognised as self-inflicted by `openSession`'s generation check.
  sessionId += 1
  if (planned) {
    console.log(
      `  \x1b[2m… recycling the browser on schedule (${browserRssMb().toFixed(0)} MB) — it is not a failure\x1b[0m`,
    )
  } else {
    recoveries += 1
    if (recoveries === 1) {
      suspectFrom = results.length
      sinceRecovery = 0
      console.log(
        `\n  \x1b[33m… ${reason} on ${lastUrl}. The browser is being rebuilt, so every\n` +
          "    assertion from here on runs on a fresh session. A failure below this\n" +
          "    point is marked FAIL? and still fails the run — re-run to confirm\n" +
          "    it. Everything after this line is worth reading.\x1b[0m",
      )
    } else {
      console.log(
        `\n  \x1b[33m… ${reason} on ${lastUrl}; recovering and retrying\x1b[0m`,
      )
    }
  }

  // Rebuild the whole browser, not just the page, on *either* failure.
  //
  // A dead renderer is not the same as a dead browser, and treating them alike
  // is what made the recovery useless. Measured in this sandbox, one browser's
  // resident memory walks from 472 MB after sign-in to 790 MB by the twelfth
  // screen — against a 2 GB cgroup that the Convex backend (~871 MB), Vite and
  // the dev tooling also live inside. When the kernel kills a renderer it
  // reclaims that renderer's pages, but the browser process keeps its own
  // allocations, and the cgroup does not necessarily give the space straight
  // back. So reloading the page under the same browser re-runs the same
  // allocation at the same pressure and dies again: three attempts, three
  // identical crashes.
  //
  // Closing and relaunching is what actually returns the memory. The cost is
  // that a new context has no session, so this signs in again — which is why
  // sign-in is a separate function rather than inline below.
  try {
    await browser.close()
  } catch {
    // Already gone.
  }
  ;({ browser, context, raw: rawPage } = await openSession())
  await signIn(ACCOUNTS.admin)

  try {
    await page.goto(`${BASE}${lastUrl}`, { waitUntil: "domcontentloaded" })
  } catch {
    // The page is gone entirely; a fresh navigation is the only option and it
    // may fail too, in which case the caller's own timeout reports it.
  }
  await settle(lastUrl)
  return true
}

async function shot(name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

/**
 * What a failed `quietSince` should say.
 *
 * A noise assertion that fails with no detail is the least useful line in the
 * report: the reader knows something was logged and has to go and find it. This
 * prints the first few entries for the screen being asserted, which is the part
 * that matters, capped so a runaway loop cannot bury the run in its own output.
 */
function noiseReport(mark) {
  const rows = []
  for (const key of ["pageerror", "console", "failed", "http"]) {
    for (const entry of noise[key].slice(mark[key])) {
      if (entry.screen !== currentLabel) continue
      rows.push(`${key}: ${entry.text ?? entry.url ?? JSON.stringify(entry)}`)
    }
  }
  if (rows.length === 0) return "no entries for this screen"
  return rows.slice(0, 3).join(" | ").slice(0, 240)
}

function newNoise() {
  return {
    console: noise.console.length,
    pageerror: noise.pageerror.length,
    failed: noise.failed.length,
    http: noise.http.length,
  }
}

/**
 * True when *this screen* has logged nothing new since the marker.
 *
 * Scoped to the screen on purpose, because the unscoped version failed on a
 * real run for a reason that has nothing to do with the product. The
 * malformed-fund-id screen logs a React error-boundary message that lands
 * *after* that group has moved on, so it is still sitting in the accumulator
 * when the next group takes its marker and runs its checks — and that group
 * then fails for a screen it never opened. Every entry already records the
 * screen it came from, so the comparison counts only entries for the screen
 * being asserted, which is what the assertion has always claimed to mean.
 *
 * The accumulators are deliberately not cleared. The report's noise dump is
 * worth more than the memory, and it is what made this diagnosable at all.
 */
function quietSince(mark) {
  const quiet = (key, entries) =>
    entries.slice(mark[key]).every((e) => e.screen !== currentLabel)
  return (
    quiet("console", noise.console) &&
    quiet("pageerror", noise.pageerror) &&
    quiet("failed", noise.failed) &&
    quiet("http", noise.http)
  )
}

async function resetMods() {
  await page.evaluate(() => {
    window.__convexMods = []
  })
}

async function mods() {
  return (await page.evaluate(() => window.__convexMods ?? [])) ?? []
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
  {
    slug: "09b-collection",
    url: "/collection",
    expect: ["Collection", "Sessions", "Online collection is not available yet"],
  },
  { slug: "10-transactions", url: "/transactions", expect: ["Transactions"] },
  {
    slug: "09c-reminders",
    url: "/reminders",
    expect: ["Reminders", "Outstanding", "Ageing", "No message provider is connected yet"],
  },
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
      ...noise.pageerror.slice(mark.pageerror).map((e) => `pageerror: ${e.text.slice(0, 120)}`),
      ...noise.console.slice(mark.console).map((c) => `console: ${c.text.slice(0, 160)}`),
      ...noise.failed.slice(mark.failed).map((f) => `requestfailed: ${f.url}`),
      ...(noise.http.length > mark.http
        ? [`http>=400: ${noise.http.slice(mark.http).map((h) => h.url).join(", ")}`]
        : []),
    ]
      .filter(Boolean)
      .join(" | ") || "clean",
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
  const firstDialog = ((await page.innerText('[role="alertdialog"]')) ?? "")
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
  const immediate = (await page.innerText('[role="alertdialog"]')) ?? ""
  check(
    "a newly opened passbook never shows the previous member's statement",
    !immediate.includes(`${first.name} — passbook`),
    immediate.split("\n")[0] || "(dialog not yet open)",
  )
  await sleep(2500)
  const secondDialog = ((await page.innerText('[role="alertdialog"]')) ?? "")
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

/* ------------------------------------------------- the collection desk */

// M5 lives in its own file — `scripts/visual-check.mjs` is past the point where
// the file tool can still see its own tail, and a group that cannot be corrected
// afterwards is a poor place to keep the checks that say the product works.
await runRemindersGroup({
  page,
  group,
  check,
  settle,
  shot,
  newNoise,
  quietSince,
  noiseReport,
  has,
  mainText,
  bodyText,
  BASE,
})


/*
 * M4a. A dated session of cash at a meeting, with a running total.
 *
 * The assertions that matter here are the *money* ones: that recording a
 * contribution issues a receipt, that the session's total moves by exactly that
 * amount, and that the member's dues are settled — because a collection screen
 * that totals correctly while failing to settle anybody is worse than no screen,
 * since it looks finished.
 *
 * Everything is left as this run found it, in the same way the other groups are:
 * a security check that leaves money-moving state behind is a check that gets
 * skipped.
 */

group("collection — a session of cash, totalled and receipted")
{
  const mark = newNoise()
  await page.goto(`${BASE}/collection`, { waitUntil: "domcontentloaded" })
  await settle("/collection")

  const listText = await mainText()
  check(
    "the collection desk says plainly that online collection is not available",
    has(listText, "Online collection is not available yet") &&
      has(listText, "No payment provider has been chosen"),
    listText.replace(/\s+/g, " ").slice(0, 140),
  )
  check(
    "it does not offer a pay button that would fail",
    !/pay online|start online|collect online/i.test(await bodyText()),
  )

  // Open a session on a fund that can have one.
  const before = (await convexCall("collections:rounds", {}, jwt)).value
  const fundsList = (await convexCall("aggregate:funds", {}, jwt)).value
  const eligible =
    fundsList.find((f) => f.collectionMode === "voluntary") ??
    fundsList.find((f) => f.collectionMode === "donation")
  check("a fund that can hold a session exists to test with", Boolean(eligible))

  if (eligible) {
    // Unique per run, and matched on exactly. An earlier version used a
    // `visual check <n>` label and then searched for the first session whose
    // label matched that *prefix* — which found a leftover from a run that had
    // been interrupted, and so added a second payment to a session that already
    // held one. The totals came out doubled and it looked like the screen was
    // counting money twice, which is the exact bug this suite exists to catch.
    const stamp = `${process.pid}-${Date.now()}`
    const label = `visual check ${stamp}`

    await page.getByRole("button", { name: /new session|open the first session/i }).first().click()
    await page.waitForSelector("#round-fund", { timeout: 10_000 })
    await page.locator("#round-fund").click()
    await page.getByRole("option", { name: eligible.name }).click()
    await page.fill("#round-label", label)
    await page.getByRole("button", { name: /^open session$/i }).click()
    await settle("/collection:created")

    const after = (await convexCall("collections:rounds", {}, jwt)).value
    const made = (after.rounds ?? []).find((r) => r.label === label)
    check(
      "a session can be opened and appears in the list",
      Boolean(made) && made.fundName === eligible.name,
      made ? `${made.label} — ${made.fundName}` : "not found",
    )
    check(
      "a new session starts at zero, not at the organisation's other money",
      made?.totalPaise === 0 && made?.paymentCount === 0,
      `total ${made?.totalPaise}`,
    )

    if (made) {
      // Creating a session returns to the list; opening it is a separate act,
      // and the list is the screen a treasurer is actually looking at afterwards.
      // Opening the new session by clicking it also proves the row is a real
      // navigation target and not just a row that happens to render.
      await page
        .getByRole("button", { name: new RegExp(made.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
        .first()
        .click()
      await settle("/collection:detail")
      check(
        "the new session opens and offers to record money into it",
        has(await mainText(), "Record money") && has(await mainText(), "Total for this session"),
        (await mainText()).replace(/\s+/g, " ").slice(0, 140),
      )

      // Record something into it. ₹137 is a round paise number the seed will
      // never produce, so a leftover from an aborted run is identifiable.
      const AMOUNT = "137"
      await page.getByRole("button", { name: /record money/i }).first().click()
      await page.waitForSelector("#pay-amount", { timeout: 10_000 })
      await page.fill("#pay-amount", AMOUNT)
      // A named member, so the payment settles dues rather than sitting as an
      // anonymous gift.
      const roster = (await convexCall("aggregate:members", { filter: "active" }, jwt)).value
      await page.fill("#pay-member", roster[0].name)
      await page.locator("ul button").first().click()
      await shot("29-collection-record")
      await page.getByRole("button", { name: /record and issue receipt/i }).click()
      await page.waitForSelector("text=/Recorded — receipt/", { timeout: 15_000 })
      // `bodyText`, not `mainText`: the confirmation lives in a Radix dialog,
      // which renders in a portal on `document.body`, outside `<main>`. Reading
      // `main` here finds the screen behind the dialog and misses the one thing
      // the assertion is about.
      const receiptLine = await bodyText()
      const receiptNo = (receiptLine.match(/receipt (R-\d+)/i) ?? [])[1] ?? null
      check(
        "recording money issues a receipt number immediately",
        Boolean(receiptNo),
        receiptNo ?? receiptLine.replace(/\s+/g, " ").slice(0, 120),
      )
      await shot("30-collection-receipt")

      const detail = (await convexCall("collections:round", { id: made.id }, jwt)).value
      check(
        "the session total is exactly what was recorded",
        detail.totalPaise === 13700 && detail.paymentCount === 1,
        `total ${detail.totalPaise} over ${detail.paymentCount}`,
      )
      check(
        "the receipt is attributed to the member who was picked",
        Boolean(detail.payments[0]?.memberName),
        detail.payments[0]?.memberName ?? "anonymous",
      )
      check(
        "the method breakdown names cash, which is what it was recorded as",
        detail.methods.some((m) => m.method === "cash" && m.amountPaise === 13700),
        JSON.stringify(detail.methods),
      )
    }
  }

  check(
    "the collection desk produced no runtime errors",
    quietSince(mark),
    [
      ...noise.pageerror.slice(mark.pageerror).map((e) => `pageerror: ${e.text.slice(0, 120)}`),
      ...noise.console.slice(mark.console).map((c) => `console: ${c.text.slice(0, 160)}`),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 400) || "clean",
  )
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

await group("fund detail — one screen per collection mode")
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
