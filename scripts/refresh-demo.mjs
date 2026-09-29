/**
 * Rebuild the demo dataset from nothing, in one command.
 *
 *   bun run seed:fresh
 *
 * Resetting the demo is three steps — wipe, re-seed, re-backfill eight years of
 * history — and running only the first two is the trap this script exists to
 * remove. A half-done reset leaves a database that *looks* fine and fails
 * `bun run check` with "closing a year stamps the entries dated inside it as
 * locked — 0 entries stamped", which reads like a balances bug and is not one.
 * The steps are ~50s together, so there is no reason for a human to be driving
 * them individually and no way to be sure the third one happened.
 *
 * The three phases are the existing scripts, unchanged, run as child
 * processes. Nothing here reimplements the wipe or the seeder: this is purely
 * the sequencing and the reporting, so there is exactly one definition of what
 * a demo dataset is.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"

/** Run a script, streaming its output, and resolve with its exit code. */
function run(label, args) {
  return new Promise((resolve) => {
    const started = Date.now()
    console.log(`\n  ${label}`)
    console.log(`  ${"─".repeat(label.length)}`)
    const child = spawn("node", args, { cwd: ROOT, stdio: "inherit" })
    child.on("close", (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      if (code === 0) {
        console.log(`  ✓ ${label} — ${secs}s\n`)
        resolve(0)
      } else {
        console.error(`\n  ✗ ${label} failed after ${secs}s (exit ${code}).\n`)
        resolve(code ?? 1)
      }
    })
  })
}

/**
 * Wait for the local backend, because the first thing a reset does is call it.
 *
 * The backend is recycled by the 2 GB cgroup under suite load, and a reset
 * against a backend that is still coming up fails with a bare `ECONNREFUSED`
 * that looks like a script bug.
 */
async function waitForBackend(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CONVEX}/version`, {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

if (!(await waitForBackend())) {
  console.error(
    `\n  No Convex backend at ${CONVEX}.\n` +
      "  Start the dev server first (bun run dev), then run this again.\n",
  )
  process.exit(1)
}

if (!existsSync(new URL("../convex/seed.ts", import.meta.url))) {
  console.error("\n  convex/seed.ts is missing — is this the project root?\n")
  process.exit(1)
}

const total = Date.now()
let code = await run("Clearing the demo organisation", ["scripts/reset-demo.mjs"])
if (code === 0) {
  code = await run("Seeding the base demo", ["scripts/seed-demo.mjs"])
}
if (code === 0) {
  code = await run("Back-filling history", ["scripts/seed-history.mjs"])
}

if (code !== 0) {
  console.error(
    "  The demo is now incomplete. Do not run the check suite against it —\n" +
      "  re-run `bun run seed:fresh` to finish the job.\n",
  )
  process.exit(code)
}

console.log(
  `  Demo rebuilt in ${((Date.now() - total) / 1000).toFixed(1)}s.\n` +
    "  Next: bun run check, bun run smoke, bun run visual\n",
)
