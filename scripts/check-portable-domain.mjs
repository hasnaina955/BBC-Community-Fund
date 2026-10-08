/**
 * Stage 2 — the portability boundary, asserted rather than described.
 *
 *   bun run portability
 *
 * ## What this holds
 *
 * `docs/PORTABILITY.md` claims the domain logic ports unchanged and only the
 * money paths need care. That claim is the reason the port is worth doing, and a
 * claim about a codebase decays: the next person to reach for `ctx.db` inside a
 * pure module would make the port more expensive and nobody would notice.
 *
 * So the boundary is written down as a manifest and checked three ways:
 *
 *   1. **Every module in `lib/` must be classified.** A new file fails this check
 *      until somebody decides which side of the boundary it is on. The failure is
 *      the point: the decision is small, and making it deliberately is cheap.
 *   2. **No module classified pure may *value*-import Convex.** Type-only imports
 *      are erased at runtime and are fine, but they must be declared, so a second
 *      one cannot appear unnoticed.
 *   3. **Every pure module must load in plain Node.** That is the real proof, and
 *      it is why `check-sql-invariants.mjs` can import `truthFromEntries` and hold
 *      the SQL invariant against the current implementation.
 *
 * It also prints the measured size of the boundary, which is where the port's
 * estimate should be quoted from rather than from a document.
 */

import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { register } from "node:module"

/**
 * These modules import each other without a file extension, which is what
 * TypeScript, Convex and every bundler accept, and what Node does not. That is a
 * resolver detail rather than a dependency — the target stack resolves them the
 * same way the current one does — so the load tests below run with a resolver
 * that appends `.ts` to a relative specifier. The fact that they need one is
 * counted and reported rather than hidden.
 */
register(
  new URL(
    "data:text/javascript," +
      encodeURIComponent(
        `export async function resolve(specifier, context, next) {
           if (specifier.startsWith(".") && !/[.][a-z]+$/i.test(specifier)) {
             try { return await next(specifier + ".ts", context) } catch {}
           }
           return next(specifier, context)
         }`,
      ),
  ),
)

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

/* ------------------------------------------------------------- the boundary */

/**
 * `pure`          no Convex reference at all. Lifts out with no edit.
 * `pure-logic`    the logic lifts out; the listed type-only references do not,
 *                 and become hand-written types in the new stack.
 * `database`      reads or writes through a Convex context. Stage 3.
 */
const MANIFEST = {
  // -- port unchanged -------------------------------------------------------
  money: { side: "pure", what: "paise arithmetic and the integer guards" },
  arrears: { side: "pure", what: "ageing and oldest-due allocation" },
  payments: { side: "pure", what: "the settlement rule" },
  reminders: { side: "pure", what: "consent and campaign decisions" },
  importcsv: { side: "pure", what: "the CSV parser, including the formula round trip" },
  roster: { side: "pure", what: "roster identity rules" },
  exportfiles: { side: "pure", what: "the export column contract" },
  password: { side: "pure", what: "PBKDF2 hashing and verification" },
  notify: { side: "pure", what: "the notification seam" },

  // -- the logic ports; these type references are repointed ----------------
  funds: {
    side: "pure-logic",
    what: "the collection-mode rule",
    // `FundDoc` and `FundId` come from Convex's generated data model. In the
    // port they become the new schema's generated types — a two-line change at
    // the top of the file, and nothing else in it moves.
    typeReferences: ["../_generated/dataModel: DataModel", "../_generated/dataModel: Id"],
  },

  // -- stage 3: the money paths, and everything that needs a transaction ---
  authz: { side: "database", what: "actor resolution; the one authorisation gate" },
  ledger: { side: "database", what: "postEntry — entry plus balances, one transaction" },
  collection: { side: "database", what: "recordPaymentFor — the money write path" },
  balances: { side: "database", what: "the materialised balances and the invariant" },
  sequence: { side: "database", what: "the receipt counter; needs an atomic increment" },
  audit: { side: "database", what: "the audit row every mutation writes" },
  members: { side: "database", what: "the one writer of a members row" },
  years: { side: "database", what: "the earliest year on record" },
}

const CONVEX_SPECIFIER = /^(convex|convex\/.*|@convex-dev\/.*|.*_generated.*)$/

/** Import specifiers, split into value imports and type-only ones. */
function importsOf(source) {
  const value = []
  const types = []
  const re = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)"/gm
  for (const m of source.matchAll(re)) {
    const [, isType, clause, specifier] = m
    // `import { type A, B }` is partially type-only, so a clause counts as
    // type-only only when every named import carries the `type` keyword.
    const named = clause.match(/\{([^}]*)\}/)?.[1] ?? ""
    const allTyped =
      named.length > 0 &&
      named
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith("type "))
    if (isType || allTyped) types.push(specifier)
    else value.push(specifier)
  }
  return { value, types }
}

const libDir = "convex/lib"
const files = readdirSync(libDir).filter((f) => f.endsWith(".ts"))
const modules = files.map((f) => f.replace(/\.ts$/, ""))

/** Lines counted the way `wc -l` counts them, so a quoted figure can be checked. */
const lines = (source) => (source.match(/\n/g) ?? []).length

console.log("\nportability — the boundary between the domain and the database")
check(
  "every module in convex/lib/ is classified",
  modules.every((m) => MANIFEST[m]),
  `unclassified: ${modules.filter((m) => !MANIFEST[m]).join(", ")} — add it to MANIFEST in this file, choosing pure, pure-logic or database`,
)
check(
  "and the manifest has no entries for modules that no longer exist",
  Object.keys(MANIFEST).every((m) => modules.includes(m)),
  `stale: ${Object.keys(MANIFEST).filter((m) => !modules.includes(m)).join(", ")}`,
)

/* -- no value import, and it loads ---------------------------------------- */

// Both portable sides get the no-value-import and loads-in-Node checks; only the
// exact `pure` ones are lines that port with no edit at all.
const portable = modules.filter((m) => MANIFEST[m]?.side.startsWith("pure"))
const pure = modules.filter((m) => MANIFEST[m]?.side === "pure")
let verbatimLines = 0
const loadFailures = []
const undeclaredTypeRefs = []

for (const m of portable) {
  const source = readFileSync(path.join(libDir, `${m}.ts`), "utf8")
  const { value, types } = importsOf(source)

  const convexValues = value.filter((s) => CONVEX_SPECIFIER.test(s))
  check(
    `${m}.ts has no value import of Convex`,
    convexValues.length === 0,
    `imports ${convexValues.join(", ")} — a runtime dependency on Convex is what makes a module expensive to port`,
  )

  const convexTypes = types.filter((s) => CONVEX_SPECIFIER.test(s))
  const declared = (MANIFEST[m].typeReferences ?? []).map((r) => r.split(":")[0])
  const undeclared = convexTypes.filter((s) => !declared.includes(s))
  if (undeclared.length > 0) undeclaredTypeRefs.push(`${m}: ${undeclared.join(", ")}`)
  check(
    `${m}.ts declares every type-only Convex reference it has`,
    undeclared.length === 0,
    `undeclared: ${undeclared.join(", ")} — add it to typeReferences for ${m}, so the boundary stays counted`,
  )

  try {
    await import(`../${libDir}/${m}.ts`)
  } catch (err) {
    loadFailures.push(`${m}: ${err.message.slice(0, 80)}`)
  }

  if (MANIFEST[m].side === "pure") verbatimLines += lines(source)
}

check(
  "every pure module loads in plain Node, with no Convex runtime present",
  loadFailures.length === 0,
  loadFailures.join(" | "),
)
check(
  "no type-only Convex reference is undeclared anywhere",
  undeclaredTypeRefs.length === 0,
  undeclaredTypeRefs.join(" | "),
)

/* -- the measured size of the claim --------------------------------------- */

const pureLogic = modules.filter((m) => MANIFEST[m]?.side === "pure-logic")
const database = modules.filter((m) => MANIFEST[m]?.side === "database")
/** Lines counted the way `wc -l` counts them, so a quoted figure can be checked. */
const linesOf = (m) => (readFileSync(path.join(libDir, `${m}.ts`), "utf8").match(/\n/g) ?? []).length
const databaseLines = database.reduce((n, m) => n + linesOf(m), 0)

check(
  "the boundary is exactly the ten-and-eight the port's estimate is built on",
  pure.length + pureLogic.length === 10 && database.length === 8,
  `${pure.length} pure + ${pureLogic.length} pure-logic + ${database.length} database = ${modules.length}`,
)

console.log(
  `\n  ${pass} passed, ${fail} failed.` +
    `\n  ${verbatimLines} lines port verbatim (${pure.length} modules),` +
    `\n  ${pureLogic.map((m) => `${m}.ts`).join(", ")} ports its logic with the type references repointed,` +
    `\n  ${databaseLines} lines need a transaction (${database.length} modules).\n`,
)
process.exit(fail > 0 ? 1 : 0)
