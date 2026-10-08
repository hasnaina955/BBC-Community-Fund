/**
 * Generate `db/schema.sql` from `convex/schema.ts`.
 *
 *   bun run sql:schema
 *
 * ## Why this is generated rather than written
 *
 * Twenty-eight tables and 67 indexes, and the port's whole claim is that the
 * schema carries across unchanged. A hand-written DDL would be a second copy of
 * the schema, and the two would drift the first time somebody added a field —
 * silently, because nothing compares them. Generating it means the Convex schema
 * is the single source, and `scripts/check-sql-schema.mjs` proves the generated
 * SQL matches it by reading it back out of a real Postgres.
 *
 * ## The decisions this file makes, all of them deliberate
 *
 * **Every `v.number()` becomes `bigint`.** Convex's number is a float64. In this
 * schema every one of the 62 of them is an integer in practice — paise, epoch
 * milliseconds, years, months, counters — and the integer discipline currently
 * lives in `assertPaise` and in the reviewer's head. A `bigint` column cannot
 * hold a fraction of a paisa, which is the one thing this codebase says twice in
 * its own schema comment. The check suite asserts that no floating-point or
 * decimal column exists anywhere in the generated schema.
 *
 * **`_id` becomes `id text primary key`, not a uuid.** Convex ids are opaque
 * strings. Text keeps a migration lossless; a fresh database could use `uuid`
 * with `gen_random_uuid()`, but that would mean rewriting every id on the way
 * across, which is a decision for stage 3 and not one to smuggle into stage 1.
 *
 * **`_creationTime` becomes `creation_time bigint not null`.** It is not
 * decoration: `lib/balances.ts` pages the whole ledger by it, because Convex's
 * own `paginate()` was the wrong tool there. Dropping it would break
 * `balances:recomputeAll`.
 *
 * **Unions become `text` plus a `CHECK` constraint**, rather than a Postgres
 * enum type. Enums are tidier until the first value is added, at which point
 * `ALTER TYPE` has its own transaction rules and the migration is a project.
 * A `CHECK` is greppable, migratable, and reads the same in a psql session.
 *
 * **`id` fields become real foreign keys.** Convex has no referential integrity
 * at all; this is a genuine gain from the port rather than a translation. An
 * `org_id` reference cascades, because every org-scoped row dying with its
 * organisation is exactly what `orgs.deleteOrganization` implements by hand
 * across twenty tables. Every other reference is restrictive.
 *
 * **snake_case columns.** Postgres folds unquoted identifiers to lowercase, so
 * `orgId` unquoted silently becomes `orgid`. The generator converts
 * deterministically and refuses to emit if two fields would collide, which is
 * the failure that would otherwise show up as a missing column much later.
 */

import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const schema = (await import("../convex/schema.ts")).default

/** `orgId` -> `org_id`, `ifscCode` -> `ifsc_code`, `auditLog` -> `audit_log`. */
export function snake(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
}

const TYPE_ALIASES = {
  string: "text",
  boolean: "boolean",
  // See the note above: every number in this schema is an integer in practice.
  float64: "bigint",
}

/** Fail loudly rather than guess at a validator this file has never seen. */
function unsupported(context, validator) {
  throw new Error(
    `gen-sql-schema: ${context} has validator kind "${validator.kind}", which this generator does not map. ` +
      `Add it deliberately — a guessed mapping is how a schema silently loses a field.`,
  )
}

/**
 * One field's SQL type, nullability, check and reference.
 *
 * Returns the pieces rather than a finished string so the caller can assemble
 * them in a fixed order and the checker can be handed the same facts.
 */
function columnFor(table, field, validator) {
  const context = `${table}.${field}`
  const optional = validator.isOptional === "optional"
  const out = { name: snake(field), type: null, notNull: !optional, check: null, references: null }

  const kind = validator.kind
  if (kind === "optional") {
    // Convex wraps optionals in a validator of their own.
    const inner = columnFor(table, field, validator.value)
    return { ...inner, notNull: false }
  }
  if (TYPE_ALIASES[kind]) {
    out.type = TYPE_ALIASES[kind]
    return out
  }
  if (kind === "id") {
    out.type = "text"
    // Recorded, not emitted inline: a foreign key written into CREATE TABLE
    // needs its target to exist first, and `members.userId` points at `users`
    // which the auth section writes last. The constraints are added after every
    // table exists, which also means a cycle could never break the file.
    out.references = snake(validator.tableName)
    out.cascade = field === "orgId"
    return out
  }
  if (kind === "literal") {
    out.type = "text"
    out.check = `CHECK (${out.name} = '${validator.value}')`
    return out
  }
  if (kind === "union") {
    if (!validator.members.every((m) => m.kind === "literal")) {
      unsupported(context, { kind: "union with non-literal members" })
    }
    out.type = "text"
    const values = validator.members.map((m) => `'${m.value}'`).join(", ")
    out.check = `CHECK (${out.name} IN (${values}))`
    return out
  }
  if (kind === "array") {
    const inner = columnFor(table, field, validator.element)
    if (inner.check || inner.references) {
      // An array of ids would need a join table to be enforced, and an array of
      // literals would need a CHECK over `unnest`. Neither is worth inventing
      // here; the one array in the schema is a list of contribution ids.
      out.type = "text[]"
      return out
    }
    out.type = `${inner.type}[]`
    return out
  }
  unsupported(context, validator)
}

function columnsFor(tableName, table) {
  const fields = table.validator.fields
  const names = Object.keys(fields)
  const seen = new Map()
  for (const f of names) {
    const s = snake(f)
    if (seen.has(s)) {
      throw new Error(
        `gen-sql-schema: ${tableName}.${f} and ${tableName}.${seen.get(s)} both become "${s}". ` +
          `Rename one, or the generated column list is a lie.`,
      )
    }
    seen.set(s, f)
  }
  return names.map((f) => ({ field: f, ...columnFor(tableName, f, fields[f]) }))
}

function createTable(tableName, table) {
  const cols = columnsFor(tableName, table)
  const lines = [
    "  -- Convex `_id`. Text, so a migration from a live deployment is lossless.",
    "  id text PRIMARY KEY,",
    "  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.",
    "  creation_time bigint NOT NULL,",
  ]
  for (const c of cols) {
    const bits = [`  ${c.name} ${c.type}`]
    if (c.notNull) bits.push("NOT NULL")
    if (c.check) bits.push(c.check)
    lines.push(bits.join(" ") + ",")
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "")
  return `CREATE TABLE ${snake(tableName)} (\n${lines.join("\n")}\n);`
}

function createIndexes(tableName, table) {
  const out = []
  for (const [indexName, def] of Object.entries(table.indexes ?? {})) {
    const cols = def.fields.map((f) => snake(f)).join(", ")
    out.push(
      `CREATE INDEX ${snake(tableName)}_${snake(indexName)} ON ${snake(tableName)} (${cols});`,
    )
  }
  return out
}

/* ------------------------------------------------------------------ emit */

/** Convex Auth's own tables. Stage 4 replaces these with the chosen library's. */
const AUTH_TABLES = new Set([
  "users",
  "authSessions",
  "authAccounts",
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authRateLimits",
])

/**
 * Foreign keys, emitted after every table exists.
 *
 * Convex has no referential integrity, so this is a gain rather than a
 * translation. `org_id` cascades because an organisation's rows dying with it
 * is exactly what `orgs.deleteOrganization` does by hand across twenty tables;
 * every other reference restricts, because nothing in this application deletes a
 * fund, a member or a payment.
 */
function foreignKeysFor(tableName, table) {
  const out = []
  for (const c of columnsFor(tableName, table)) {
    if (!c.references) continue
    const cascade = c.cascade ? " ON DELETE CASCADE" : ""
    out.push(
      `ALTER TABLE ${snake(tableName)} ADD CONSTRAINT ${snake(tableName)}_${c.name}_fkey ` +
        `FOREIGN KEY (${c.name}) REFERENCES ${c.references}(id)${cascade};`,
    )
  }
  return out
}

/**
 * The whole file, as a string.
 *
 * Returned rather than written, because the check suite compares the committed
 * file against this. If the generator wrote on import, the check would
 * regenerate the file and then verify its own output, and a stale schema could
 * never be caught.
 */
export function generateSql() {
  const tables = schema.tables
  const appTables = Object.keys(tables).filter((t) => !AUTH_TABLES.has(t))
  const authTables = Object.keys(tables).filter((t) => AUTH_TABLES.has(t))

  const header = [
    "-- Generated from convex/schema.ts by scripts/gen-sql-schema.mjs.",
    "-- Do not edit: run `bun run sql:schema` instead. `bun run sql:check` proves",
    "-- this file matches the Convex schema by reading it back out of Postgres.",
    "--",
    "-- Read docs/PORTABILITY.md for why the port is staged, and the notes at the top",
    "-- of the generator for the decisions taken here: bigint for every number, text",
    "-- ids for a lossless migration, CHECK constraints instead of enum types, and",
    "-- real foreign keys where Convex had none.",
    "",
  ].join("\n")

  const body = []
  body.push("/* ------------------------------------------------- the application ---- */")
  body.push("")
  for (const t of appTables) {
    body.push(createTable(t, tables[t]))
    body.push("")
  }

  body.push("/* ------------------------------------------------------------ auth ---- */")
  body.push("")
  body.push("-- Convex Auth's tables, carried across so the schema is complete. Stage 4 of")
  body.push("-- the port replaces these with the chosen auth library's own tables; the")
  body.push("-- `users` row is the one the application reads, and it keeps `org_id`/`role`.")
  body.push("")
  for (const t of authTables) {
    body.push(createTable(t, tables[t]))
    body.push("")
  }

  body.push("/* ----------------------------------------------------- constraints ---- */")
  body.push("")
  body.push("-- Added after every table exists, so the order of the sections above cannot")
  body.push("-- matter. Cascades on `org_id` only: see the note on `foreignKeysFor`.")
  body.push("")
  let fkCount = 0
  for (const t of [...appTables, ...authTables]) {
    const fks = foreignKeysFor(t, tables[t])
    if (fks.length === 0) continue
    body.push(`-- ${t}`)
    body.push(...fks)
    body.push("")
    fkCount += fks.length
  }

  body.push("/* --------------------------------------------------------- indexes ---- */")
  body.push("")
  body.push("-- One per Convex index, same columns in the same order. Convex index names")
  body.push("-- repeat across tables (`by_org` is on nine of them), so they are prefixed.")
  body.push("")
  let indexCount = 0
  for (const t of [...appTables, ...authTables]) {
    const sql = createIndexes(t, tables[t])
    if (sql.length === 0) continue
    body.push(`-- ${t}`)
    body.push(...sql)
    body.push("")
    indexCount += sql.length
  }

  const columnCount = Object.values(tables).reduce(
    (n, t) => n + Object.keys(t.validator.fields).length + 2,
    0,
  )
  return {
    sql: header + body.join("\n"),
    stats: { tables: Object.keys(tables).length, columnCount, indexCount, fkCount },
  }
}

// Written only when run directly. See the note on `generateSql`.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { sql, stats } = generateSql()
  mkdirSync("db", { recursive: true })
  const out = path.join("db", "schema.sql")
  writeFileSync(out, sql)
  console.log(
    `wrote ${out}: ${stats.tables} tables, ${stats.columnCount} columns, ${stats.indexCount} indexes, ${stats.fkCount} foreign keys`,
  )
}
