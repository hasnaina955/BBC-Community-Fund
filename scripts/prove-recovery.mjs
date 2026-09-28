/**
 * Prove the crash recovery in `visual-check.mjs` actually works.
 *
 *   bun run visual:recovery
 *
 * Why this exists. The recovery was written because Chromium renderers get
 * killed in this environment, and it looked fine in the code for a long time
 * because the crashes were rare enough that a passing run proved nothing. It was
 * not fine, in three separate ways, each of which this script now catches:
 *
 *   - `isGone` matched `Target crashed` — the wording Playwright uses when a
 *     *screenshot* hits a dead renderer — but not `Page crashed`, which is what a
 *     `goto` reports, so a crash on a navigation unwound the suite;
 *   - the retry re-issued the call against the page it had first been made on,
 *     so it failed identically three times in a row; *   - the `close` handler fired on the browser the recovery had closed on
 *      purpose, marking the *rebuilt* session dead and producing an infinite
 *      recovery loop;
 *   - the wording is a race. A `goto` issued *after* the kill reports `Page
 *      crashed`, but one already in flight reports Chromium's own `net::ERR_ABORTED`
 *      instead, which no amount of matching on Playwright's phrasing catches.
 *
 * Waiting for the sandbox to crash on its own is how all three survived this
 * long. So this script causes one: it runs the real suite in a child process and
 * SIGKILLs every Chromium renderer at a point of its choosing.
 *
 * Two scenarios, because a rebuild does not have one consequence:
 *
 *   1. **between groups** — the next group starts by navigating, so it recovers
 *      fully and the run should finish with every check intact;
 *   2. **mid-group** — the group had a dialog open and the state is gone, and
 *      this time the renderers keep dying, so the browser never comes back. The
 *      run must stop *deliberately*: a written report saying which group was
 *      abandoned, and a non-zero exit. Not a stack trace.
 *
 * The second scenario keeps killing rather than killing once. A single kill is
 * survivable anywhere in the suite now that `isGone` recognises the navigation
 * wording — every group re-establishes the state its next check needs, so a
 * lone crash mid-group completes the group and the run. That is the desired
 * behaviour, but it means "a crash the suite cannot absorb" can no longer be
 * provoked by one kill. A browser that dies three times in a row can.
 *
 * It writes to `.visual-recovery/` so it cannot be confused with a real run's
 * screenshots, and exits non-zero if either scenario misbehaves.
 */

import { spawn, execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OUT = ".visual-recovery"

const SCENARIOS = [
  {
    name: "a crash between groups recovers fully",
    killAfter: "clearing the search re-selects an account",
    expect: {
      // The next group re-navigates, so nothing is lost and the run completes.
      aborted: false,
      minPassed: 200,
    },
  },
  {
    name: "a crash mid-group stops with a report, not a stack trace",
    // Deep inside `members`, after the first passbook dialog is open, and then
    // the renderers keep dying so no rebuild can succeed.
    killAfter: "the lifetime received total is the server's",
    repeatKill: true,
    expect: { aborted: true },
  },
]

function runScenario(scenario) {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", "visual"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VISUAL_OUT: OUT },
    })

    let out = ""
    let errOut = ""
    let killed = false
    let keepKilling = null

    const kill = () => execFile("sh", ["-c", "pkill -9 -f 'type=renderer' || true"], () => {})

    child.stdout.on("data", (d) => {
      const s = String(d)
      out += s
      process.stdout.write(s)
      if (!killed && out.includes(scenario.killAfter)) {
        killed = true
        console.log(`\n\x1b[33m… probe: killing every Chromium renderer now\x1b[0m`)
        kill()
        if (scenario.repeatKill) {
          console.log(`\x1b[33m… probe: and again, until a rebuild cannot survive\x1b[0m`)
          keepKilling = setInterval(kill, 1500)
        }
      }
    })
    child.stderr.on("data", (d) => {
      errOut += String(d)
      process.stderr.write(d)
    })

    child.on("exit", (code) => {
      if (keepKilling) clearInterval(keepKilling)
      const recoveries = (out.match(/… (browser went away|renderer crashed)/g) ?? []).length
      const summary = out.match(/(\d+) passed, (\d+) failed/g)?.pop() ?? null
      const passed = summary ? Number(summary.match(/^(\d+)/)[1]) : 0
      const stackTrace = /triggerUncaughtException/.test(errOut)
      const aborted = /suite aborted/.test(out) || /suite aborted/.test(errOut)
      // The report is a file, not console output, so it is read rather than
      // matched: "which group was abandoned" is the whole point of stopping
      // deliberately, and only the report names it.
      const read = (f) => {
        try {
          return readFileSync(join(OUT, f), "utf8")
        } catch {
          return ""
        }
      }
      const abortLine =
        read("report.md").split("\n").find((l) => l.includes("**Run aborted.**")) ?? ""
      // Which group was abandoned is the point of stopping deliberately, and only
      // the report says it. `report.json` carries the same fact, so both are read:
      // a report that names a group in prose but not in the data is half a claim.
      let namedGroup = null
      try {
        namedGroup = JSON.parse(read("report.json") || "{}").aborted ?? null
      } catch {
        namedGroup = null
      }
      // The report quotes the group inside double quotes, so the closing quote
      // sits between the backticks and "could not be".
      const reported =
        /`[^`]+`"? could not be finished/.test(abortLine) &&
        typeof namedGroup === "string" &&
        namedGroup !== ""

      const results = [
        ["the renderers were killed mid-run", killed, ""],
        ["the guard recovered at least once", recoveries > 0, `${recoveries} recovery note(s)`],
        [
          scenario.expect.aborted
            ? "the run stopped deliberately and said which group"
            : "the run finished instead of unwinding",
          scenario.expect.aborted ? aborted && reported : !aborted && !stackTrace,
          aborted
            ? reported
              ? `report names "${namedGroup}"`
              : "no report naming the group"
            : summary ?? `exit ${code}`,
        ],
        [
          scenario.expect.aborted ? "no unhandled stack trace" : "every check still ran",
          scenario.expect.aborted ? !stackTrace : passed >= scenario.expect.minPassed,
          scenario.expect.aborted
            ? stackTrace
              ? "a stack trace escaped"
              : "clean"
            : `${passed} passed`,
        ],
      ]

      let ok = true
      console.log("\n" + "-".repeat(66))
      console.log(`  scenario: ${scenario.name}`)
      for (const [label, pass, detail] of results) {
        if (!pass) ok = false
        console.log(
          `  ${pass ? "\x1b[32m ok \x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}${detail ? ` — ${detail}` : ""}`,
        )
      }
      console.log("-".repeat(66))
      if (!ok && stackTrace) console.log(errOut.split("\n").slice(-20).join("\n"))
      resolve(ok)
    })
  })
}

let allOk = true
for (const scenario of SCENARIOS) {
  if (!(await runScenario(scenario))) allOk = false
}
process.exit(allOk ? 0 : 1)
