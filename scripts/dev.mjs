#!/usr/bin/env node
/**
 * Development runner: Convex backend + Vite, together.
 *
 * The Convex local backend only listens while a Convex process is running, and
 * `convex dev --once` exits as soon as the push completes. Without a
 * long-lived Convex process the React client has nothing to connect to, so
 * both halves are started here and torn down together.
 *
 * Vite is the child that owns the preview port. If Convex dies we shut Vite
 * down rather than leave the app running against a backend that has gone.
 *
 * Durable and in the repository on purpose: the preview runner invokes
 * `bun run dev`, so the platform manages this process — it is not something a
 * terminal starts by hand.
 */
import { spawn } from "node:child_process"

const children = []
let shuttingDown = false

function run(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  })

  child.on("exit", (code, signal) => {
    if (shuttingDown) return
    console.error(`\n[dev] ${name} exited (${signal ?? code}). Stopping the other process.\n`)
    shutdown(code ?? 1)
  })

  child.on("error", (err) => {
    console.error(`[dev] could not start ${name}: ${err.message}`)
    shutdown(1)
  })

  children.push({ name, child })
  return child
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    if (!child.killed) child.kill("SIGTERM")
  }
  setTimeout(() => process.exit(code), 200)
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0))
}

console.log("[dev] starting Convex backend…")
// Watch mode: pushes on change and keeps the local backend listening.
run("convex", "bunx", ["convex", "dev"])

console.log("[dev] starting Vite…")
// Vite is started after Convex so the preview port is claimed last.
run("vite", "bunx", ["vite", "--host", "0.0.0.0"])
