/**
 * Prove `db/schema.sql` still matches `convex/schema.ts`.
 *
 *   bun run sql:check
 *
 * ## What this is for
 *
 * The port's claim is that the schema carries across unchanged. A generated file
 * makes that claim plausible; only reading it back out of a real Postgres makes
 * it true. So this loads the SQL into Postgres, asks the catalogue what actually
 * exists, and compares that against the Convex schema field by field, index by
 * index and reference by reference.
 *
 * It runs against PGlite — Postgres compiled to WebAssembly — so it needs no
 * server, no Docker and no credentials, and can therefore run on every commit
 * rather than on the day somebody remembers. That matters more here than
 * anywhere else in the repository: a schema that drifts silently produces a
 * missing column, and a missing column in this application is a wrong balance.
 *
 * ## The assertion that is not about fidelity
 *
 * **No column anywhere may be a floating-point or decimal type.** Convex's number
 * is a float64, so the schema was 62 floating-point fields deep; the integer
 * discipline lived in `assertPaise` and in review. A `bigint` cannot hold a
 * fraction of a paisa, and this check is what keeps it that way when somebody
 * later adds a column and reaches for `numeric`.
 */

import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const schema = (await import("../convex/schema.ts")).default
const { snake, generateSql } = await import("./gen-sql-schema.mjs")

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

/* ------------------------------------------------------------- expectations */

const TYPE_FOR = {
  string: "text",
  boolean: "boolean",
  // Every number in this schema is an integer in practice; see the generator.
  float64: "bigint",
  id: "text",
  union: "text",
  literal: "text",
}

function expected(table, field, validator) {
  const optional = validator.isOptional === "optional"
  const kind = validator.kind
  if (kind === "array") {
    const inner = expected(table, field, validator.element)
    return { type: `${inner.type}[]`, nullable: optional, values: null, references: null }
  }
  if (kind === "union") {
    return {
      type: "text",
      nullable: optional,
      values: validator.members.map((m) => m.value),
      references: null,
    }
  }
  if (kind === "literal") {
    return { type: "text", nullable: optional, values: [validator.value], references: null }
  }
  if (kind === "id") {
    return { type: "text", nullable: optional, values: null, references: snake(validator.tableName) }
  }
  const type = TYPE_FOR[kind]
  if (!type) throw new Error(`check-sql-schema: unmapped validator kind "${kind}" at ${table}.${field}`)
  return { type, nullable: optional, values: null, references: null }
}

const tables = schema.tables

/* --------------------------------------------------------------- the check */

console.log("\nsql:schema — the generated DDL against the Convex schema")

const committed = readFileSync("db/schema.sql", "utf8")

// First: is the committed file what the generator produces? This is the gate
// that makes the file trustworthy. Without it, `db/schema.sql` could be stale or
// hand-edited and every check below would still pass, because they read the file
// rather than the schema.
check(
  "db/schema.sql is exactly what the generator produces",
  committed === generateSql().sql,
  "regenerate with `bun run sql:schema` — the committed file has drifted from convex/schema.ts",
)

const db = await PGlite.create()
await db.exec(committed)

const columns = await db.query(`
  select table_name, column_name, data_type, udt_name, is_nullable
  from information_schema.columns
  where table_schema = 'public'
`)
const byColumn = new Map(columns.rows.map((r) => [`${r.table_name}.${r.column_name}`, r]))

const checks = await db.query(`
  select t.relname as table_name, a.attname as column_name,
         pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join unnest(c.conkey) as k(attnum) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where c.contype = 'c'
`)
const checkBy = new Map(
  checks.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.definition]),
)

const indexes = await db.query(`
  select t.relname as table_name, i.relname as index_name,
         array_agg(a.attname order by k.ord) as columns
  from pg_index ix
  join pg_class i on i.oid = ix.indexrelid
  join pg_class t on t.oid = ix.indrelid
  join lateral unnest(ix.indkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where t.relnamespace = 'public'::regnamespace
  group by 1, 2
`)
const indexBy = new Map(
  indexes.rows.map((r) => [`${r.table_name}.${r.index_name}`, r.columns]),
)

const fks = await db.query(`
  select t.relname as table_name, a.attname as column_name,
         pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join unnest(c.conkey) as k(attnum) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where c.contype = 'f'
`)
const fkBy = new Map(fks.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.definition]))

/* -- every table, column, type and nullability --------------------------- */

let fieldCount = 0
const missingColumns = []
for (const [tableName, table] of Object.entries(tables)) {
  const t = snake(tableName)
  check(
    `table ${t} exists`,
    columns.rows.some((r) => r.table_name === t),
    `no table named ${t}`,
  )
  for (const implicit of ["id", "creation_time"]) {
    check(
      `${t}.${implicit} exists`,
      byColumn.has(`${t}.${implicit}`),
      `Convex gives every document ${implicit === "id" ? "_id" : "_creationTime"}; dropping it is a silent data loss`,
    )
  }
  for (const [field, validator] of Object.entries(table.validator.fields)) {
    fieldCount += 1
    const want = expected(tableName, field, validator)
    const col = `${t}.${snake(field)}`
    const got = byColumn.get(col)
    if (!got) {
      missingColumns.push(col)
      continue
    }
    // Postgres reports an array column as data_type `ARRAY` with the element
    // type in `udt_name` (`_text` for `text[]`), so arrays compare on the
    // element and everything else on the plain type.
    const isArray = want.type.endsWith("[]")
    const typeMatches = isArray
      ? got.data_type === "ARRAY" && got.udt_name === `_${want.type.slice(0, -2)}`
      : got.data_type === want.type
    check(
      `${col} is ${want.type}${want.nullable ? " null" : " not null"}`,
      typeMatches && got.is_nullable === (want.nullable ? "YES" : "NO"),
      `is ${got.data_type}${isArray ? ` (${got.udt_name})` : ""} ${got.is_nullable === "YES" ? "null" : "not null"}`,
    )
    if (want.values) {
      const definition = checkBy.get(col) ?? ""
      check(
        `${col} is constrained to ${want.values.length} value${want.values.length === 1 ? "" : "s"}`,
        want.values.every((v) => definition.includes(`'${v}'`)),
        `check is ${definition || "absent"}`,
      )
    }
    if (want.references) {
      const definition = fkBy.get(col) ?? ""
      check(
        `${col} references ${want.references}`,
        definition.includes(`REFERENCES ${want.references}(id)`),
        `fk is ${definition || "absent"}`,
      )
      if (field === "orgId") {
        check(
          `${col} cascades, so an organisation takes its rows with it`,
          definition.includes("ON DELETE CASCADE"),
          definition,
        )
      }
    }
  }
}

check(
  "no field in the Convex schema is missing a column",
  missingColumns.length === 0,
  missingColumns.join(", "),
)
check(
  "every column in the database came from a field",
  columns.rows.length === fieldCount + Object.keys(tables).length * 2,
  `${columns.rows.length} columns for ${fieldCount} fields across ${Object.keys(tables).length} tables (+2 implicit each = ${fieldCount + Object.keys(tables).length * 2})`,
)

/* -- every index, same columns in the same order ------------------------- */

let indexCount = 0
const missingIndexes = []
for (const [tableName, table] of Object.entries(tables)) {
  for (const [indexName, def] of Object.entries(table.indexes ?? {})) {
    indexCount += 1
    const name = `${snake(tableName)}.${snake(tableName)}_${snake(indexName)}`
    const want = def.fields.map((f) => snake(f))
    const got = indexBy.get(name)
    if (!got) {
      missingIndexes.push(name)
      continue
    }
    check(
      `index ${name} covers (${want.join(", ")})`,
      got.length === want.length && got.every((c, i) => c === want[i]),
      `covers (${got.join(", ")})`,
    )
  }
}
check("no index in the Convex schema is missing", missingIndexes.length === 0, missingIndexes.join(", "))

/* -- the assertion that is not about fidelity ---------------------------- */

const floaty = columns.rows.filter((r) =>
  /real|double precision|numeric|decimal|money/i.test(r.data_type),
)
check(
  "no column anywhere can hold a fraction of a paisa",
  floaty.length === 0,
  floaty.map((r) => `${r.table_name}.${r.column_name} is ${r.data_type}`).join(", "),
)

console.log(
  `\n  ${pass} passed, ${fail} failed — ${Object.keys(tables).length} tables, ${fieldCount} fields, ${indexCount} indexes.\n`,
)
process.exit(fail > 0 ? 1 : 0)
