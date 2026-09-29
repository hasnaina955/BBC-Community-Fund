/**
 * Reading a community's history back in.
 *
 * ## Why this file is a parser and not a wrapper around one
 *
 * There is no CSV library here, for the same reason there is no CSV writer in
 * `src/lib/csv.ts`. The two hard cases are the same in both directions, and both
 * fail *quietly* — the file opens, it just says the wrong thing:
 *
 *   1. **A name containing a comma, a quote or a newline.** `Ali, Mohammad` is
 *      two columns. Real communities have two Mohammedals.
 *   2. **A name that a spreadsheet *executes*.** The export guards this by
 *      prefixing an apostrophe. A round trip therefore has to *remove* it, or
 *      every name imported back from a file this product exported arrives
 *      wearing a stray `'` — a bug that is invisible in the CSV and obvious on
 *      screen, and that would then be exported again with two of them.
 *
 * So `unescapeFormula` below is the exact inverse of `neutraliseFormula` in
 * `src/lib/csv.ts`, and the round trip is asserted in the check suite.
 *
 * ## The one place this is allowed to be strict
 *
 * An import writes to the ledger. Every other input path in this codebase can
 * be redone by deleting the row; a mistyped date in a historical import cannot,
 * because the ledger is append-only and the correction is a reversing entry
 * that somebody has to find. So this parser is deliberately unforgiving, and it
 * reports **every** problem in a file rather than stopping at the first. A
 * treasurer fixing row 4,000 of an 8-year spreadsheet cannot afford to fix
 * them one exception per upload.
 */

/* -------------------------------------------------------------------------- *
 * Column contracts
 * -------------------------------------------------------------------------- */

export type ImportKind = "contributions" | "payments" | "ledger"

/**
 * How each kind is recognised.
 *
 * Detection is by header, not by a file name or a radio button, because the
 * alternative is a treasurer being asked to tell the machine which of three
 * things it is holding. The signature columns are the ones that cannot be
 * shared: `year`+`month` only exist in a grid, `receipt` only in a payment
 * register, `amount`+`date`+`note` is the general ledger form.
 */
const SIGNATURES: Array<{ kind: ImportKind; any?: string[]; all?: string[] }> = [
  { kind: "contributions", all: ["year", "month"] },
  { kind: "payments", all: ["method"] },
  { kind: "payments", any: ["receipt", "paid_at"] },
  { kind: "ledger", any: ["date", "effective_date"] },
]

/** Every column each kind understands. Unknown columns are ignored, not fatal. */
export const COLUMNS: Record<ImportKind, { required: string[]; optional: string[] }> = {
  contributions: {
    required: ["member", "year", "month", "amount"],
    optional: ["fund", "status", "paid_at", "note"],
  },
  payments: {
    required: ["amount", "paid_at"],
    optional: ["member", "fund", "bank", "method", "receipt", "reference", "note"],
  },
  ledger: {
    required: ["amount", "date"],
    optional: ["fund", "bank", "member", "category", "note", "source"],
  },
}

/* -------------------------------------------------------------------------- *
 * Issues
 * -------------------------------------------------------------------------- */

export interface ImportIssue {
  /** 1-based row in the file, counting the header as row 1. */
  row: number
  field: string
  message: string
}

export interface ParseOutcome<T> {
  kind: ImportKind | null
  headers: string[]
  rows: T[]
  issues: ImportIssue[]
  /** Rows present in the file, whether or not they were usable. */
  totalRows: number
}

/* -------------------------------------------------------------------------- *
 * The parser
 * -------------------------------------------------------------------------- */

const BOM = "﻿"

/** Strip the UTF-8 BOM the exporter writes, or a name starts with one. */
function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

/**
 * The inverse of `neutraliseFormula` in `src/lib/csv.ts`.
 *
 * Only a *single* leading apostrophe is removed, and only when what follows
 * could actually have been a formula. A name that genuinely begins with `'` is
 * left alone, because stripping it would corrupt real data to fix an artefact.
 */
export function unescapeFormula(value: string): string {
  if (!value.startsWith("'")) return value
  const rest = value.slice(1)
  return /^[=+\-@\t\r]/.test(rest) ? rest : value
}

/**
 * RFC 4180 tokenising.
 *
 * Handles quoted fields, doubled quotes inside them, and newlines *inside* a
 * quoted field — the last of which is the reason a `split("\n")` is wrong, and
 * a treasurer's notes column is exactly where one turns up.
 */
export function tokenise(text: string): string[][] {
  const body = stripBom(text)
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let quoted = false
  let started = false

  const endField = () => {
    record.push(field)
    field = ""
    started = false
  }
  const endRecord = () => {
    endField()
    records.push(record)
    record = []
  }

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]

    if (quoted) {
      if (ch !== '"') {
        field += ch
      } else if (body[i + 1] === '"') {
        field += '"'
        i += 1
      } else {
        quoted = false
      }
      continue
    }

    if (ch === '"' && !started) {
      quoted = true
      started = true
    } else if (ch === ",") {
      endField()
    } else if (ch === "\r" && body[i + 1] === "\n") {
      endRecord()
      i += 1
    } else if (ch === "\r" || ch === "\n") {
      endRecord()
    } else {
      field += ch
      started = true
    }
  }

  if (field !== "" || record.length > 0 || started) endRecord()

  // A trailing newline produces one empty record; it is not a data row.
  return records.filter(
    (r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""),
  )
}

/** Trim, and undo the exporter's formula guard. */
function cell(raw: string | undefined): string {
  if (raw === undefined) return ""
  return unescapeFormula(raw.trim())
}

/** A header is matched on its trimmed, lowercased form. */
function normaliseHeader(raw: string): string {
  return raw.replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_")
}

/* -------------------------------------------------------------------------- *
 * Value parsing
 * -------------------------------------------------------------------------- */

/**
 * Rupees to integer paise.
 *
 * Accepts what a treasurer actually types: `150`, `1,500.50`, `₹1500`, `-200`.
 * Rejects anything with more than two decimal places rather than rounding it,
 * because rounding a currency amount silently is how a balance stops
 * reconciling, and the person who can fix it cannot see what changed.
 */
export function parsePaise(
  raw: string,
  row: number,
  field: string,
  issues: ImportIssue[],
): number | null {
  const text = raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "")
  if (text === "") {
    issues.push({ row, field, message: "amount is empty" })
    return null
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    issues.push({
      row,
      field,
      message: `"${raw}" is not a number — write it as 150 or 1500.50, not "${raw}"`,
    })
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    issues.push({ row, field, message: `"${raw}" is not a number` })
    return null
  }
  const paise = Math.round(value * 100)
  if (Math.abs(value * 100 - paise) > 1e-6) {
    issues.push({
      row,
      field,
      message: `"${raw}" has more than two decimal places; paise cannot represent it`,
    })
    return null
  }
  return paise
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/** A month written as a number, a name, or a three-letter abbreviation. */
export function parseMonth(
  raw: string,
  row: number,
  issues: ImportIssue[],
): number | null {
  const text = raw.trim().toLowerCase().replace(/\.$/, "")
  if (/^\d+$/.test(text)) {
    const n = Number(text)
    if (n >= 1 && n <= 12) return n
    issues.push({ row, field: "month", message: `month "${raw}" is not 1–12` })
    return null
  }
  const named = MONTH_NAMES[text]
  if (named !== undefined) return named
  issues.push({
    row,
    field: "month",
    message: `month "${raw}" is not a month — use 1–12, or a name like Mar`,
  })
  return null
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  )
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * A date, returned as `YYYY-MM-DD`.
 *
 * Three spellings, because a treasurer's spreadsheet is not ours to dictate:
 * ISO (`2024-03-09`), day-first (`09/03/2024`, `9-3-24`) and a name
 * (`9 Mar 2024`, `March 9, 2024`).
 *
 * **Day-first is a decision, not an accident.** This is an Indian community
 * application and `01/02/2024` means 1 February here. It is genuinely ambiguous
 * in the abstract, and the template and the download both say which is meant, so
 * the choice is visible rather than buried. Anyone with American-format dates
 * should export to ISO before importing — and the preview names every row where
 * the two readings would differ, so they find out before committing.
 */
export function parseDate(
  raw: string,
  row: number,
  field: string,
  issues: ImportIssue[],
): string | null {
  const text = raw.trim()
  if (text === "") {
    issues.push({ row, field, message: "date is empty" })
    return null
  }

  // ISO, optionally with a time component, which is what this app writes.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (iso) {
    const [, y, m, d] = iso.map(Number)
    if (!isRealDate(y, m, d)) {
      issues.push({ row, field, message: `"${raw}" is not a real date` })
      return null
    }
    return `${y}-${pad(m)}-${pad(d)}`
  }

  // Day-first, the Indian format. Two-digit years are read as 20xx.
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (dmy) {
    const d = Number(dmy[1])
    const m = Number(dmy[2])
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    if (!isRealDate(y, m, d)) {
      issues.push({
        row,
        field,
        message: `"${raw}" is not a real date (read as day/${m}/${y})`,
      })
      return null
    }
    return `${y}-${pad(m)}-${pad(d)}`
  }

  // "9 Mar 2024" / "9 March, 2024" / "Mar 9, 2024"
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s*,?\s*(\d{4})$/)
  if (named) {
    const m = MONTH_NAMES[named[2].toLowerCase()]
    const d = Number(named[1])
    const y = Number(named[3])
    if (m === undefined) {
      issues.push({ row, field, message: `"${named[2]}" is not a month` })
      return null
    }
    if (!isRealDate(y, m, d)) {
      issues.push({ row, field, message: `"${raw}" is not a real date` })
      return null
    }
    return `${y}-${pad(m)}-${pad(d)}`
  }

  issues.push({
    row,
    field,
    message: `"${raw}" is not a date — use 2024-03-09, 09/03/2024 (day first) or "9 Mar 2024"`,
  })
  return null
}

function parseYear(
  raw: string,
  row: number,
  issues: ImportIssue[],
): number | null {
  const y = Number(raw.trim())
  if (!/^\d{4}$/.test(raw.trim()) || y < 1900 || y > 2200) {
    issues.push({
      row,
      field: "year",
      message: `year "${raw}" is not a four-digit year`,
    })
    return null
  }
  return y
}

/** Lowercase a cell and check it is one of a fixed set, listing what is allowed. */
function parseEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
  row: number,
  field: string,
  issues: ImportIssue[],
  fallback?: T,
): T | null {
  const text = raw.trim().toLowerCase()
  if (text === "") {
    if (fallback !== undefined) return fallback
    issues.push({ row, field, message: `${field} is empty` })
    return null
  }
  if ((allowed as readonly string[]).includes(text)) return text as T
  issues.push({
    row,
    field,
    message: `"${raw}" is not a valid ${field} — use one of ${allowed.join(", ")}`,
  })
  return null
}

/* -------------------------------------------------------------------------- *
 * Row shapes
 * -------------------------------------------------------------------------- */

export interface ContributionRow {
  row: number
  member: string
  fund: string | null
  year: number
  month: number
  amountPaise: number
  status: "due" | "paid" | "partial" | "waived"
  paidAt: string | null
  note: string | null
}

export interface PaymentRow {
  row: number
  member: string | null
  fund: string | null
  bank: string | null
  amountPaise: number
  method: "cash" | "cheque" | "upi" | "card" | "transfer"
  paidAt: string
  receipt: string | null
  reference: string | null
  note: string | null
}

export interface LedgerRow {
  row: number
  fund: string | null
  bank: string | null
  member: string | null
  amountPaise: number
  date: string
  category: string | null
  note: string | null
}

const CONTRIBUTION_STATUS = ["due", "paid", "partial", "waived"] as const
const PAYMENT_METHOD = ["cash", "cheque", "upi", "card", "transfer"] as const
const LEDGER_CATEGORIES = [
  "operations",
  "emergency",
  "investment",
  "donation",
  "salary",
  "maintenance",
  "other",
] as const

/** Read the header row and index the columns by their normalised names. */
function readHeader(
  records: string[][],
): { headers: string[]; index: Map<string, number>; dataRows: string[][] } | null {
  if (records.length === 0) return null
  const headers = records[0].map(normaliseHeader)
  const index = new Map<string, number>()
  headers.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i)
  })
  return { headers, index, dataRows: records.slice(1) }
}

/** Work out what kind of file this is, from its columns alone. */
export function detectKind(headers: string[]): ImportKind | null {
  const set = new Set(headers.map(normaliseHeader))
  const has = (c: string) => set.has(c)

  for (const sig of SIGNATURES) {
    if (sig.all && !sig.all.every(has)) continue
    if (sig.any && !sig.any.some(has)) continue
    if (!sig.all && !sig.any) continue
    return sig.kind
  }
  return null
}

/** Which required columns are missing, for a file we could not classify. */
export function missingColumns(headers: string[]): string[] {
  const set = new Set(headers.map(normaliseHeader))
  const out: string[] = []
  for (const [name, spec] of Object.entries(COLUMNS)) {
    const absent = spec.required.filter((c) => !set.has(c))
    if (absent.length > 0) out.push(`${name}: ${absent.join(", ")}`)
  }
  return out
}

/**
 * Parse a file, whichever kind it is.
 *
 * Returns every issue it found rather than the first, because a treasurer
 * fixing a spreadsheet should see the whole list.
 */
export function parseImport(
  text: string,
): ParseOutcome<ContributionRow | PaymentRow | LedgerRow> {
  const issues: ImportIssue[] = []
  const records = tokenise(text)
  const read = readHeader(records)

  if (!read) {
    return {
      kind: null,
      headers: [],
      rows: [],
      issues: [{ row: 0, field: "file", message: "The file is empty." }],
      totalRows: 0,
    }
  }

  const { headers, index, dataRows } = read
  const kind = detectKind(headers)

  if (!kind) {
    return {
      kind: null,
      headers,
      rows: [],
      totalRows: dataRows.length,
      issues: [
        {
          row: 1,
          field: "header",
          message:
            "Could not tell what this file contains. Expected one of: " +
            missingColumns(headers).join(" · "),
        },
      ],
    }
  }

  const get = (record: string[], column: string): string =>
    cell(record[index.get(column) ?? -1])

  const rows: Array<ContributionRow | PaymentRow | LedgerRow> = []

  dataRows.forEach((record, i) => {
    // +2: one for the header, one because rows are 1-based for humans.
    const row = i + 2

    if (kind === "contributions") {
      const member = get(record, "member")
      if (!member) {
        issues.push({ row, field: "member", message: "member is empty" })
        return
      }
      const year = parseYear(get(record, "year"), row, issues)
      const month = parseMonth(get(record, "month"), row, issues)
      const amountPaise = parsePaise(get(record, "amount"), row, "amount", issues)
      const status = parseEnum(
        get(record, "status"),
        CONTRIBUTION_STATUS,
        row,
        "status",
        issues,
        "due",
      )
      const paidAtRaw = get(record, "paid_at")
      const paidAt = paidAtRaw
        ? parseDate(paidAtRaw, row, "paid_at", issues)
        : null
      if (status === "paid" && !paidAt) {
        issues.push({
          row,
          field: "paid_at",
          message:
            "a paid month needs the date it was paid, or the receipt is dated today",
        })
        return
      }
      if (year === null || month === null || amountPaise === null || !status) return
      rows.push({
        row,
        member,
        fund: get(record, "fund") || null,
        year,
        month,
        amountPaise,
        status,
        paidAt,
        note: get(record, "note") || null,
      })
      return
    }

    if (kind === "payments") {
      const amountPaise = parsePaise(get(record, "amount"), row, "amount", issues)
      const paidAt = parseDate(get(record, "paid_at"), row, "paid_at", issues)
      const method = parseEnum(
        get(record, "method"),
        PAYMENT_METHOD,
        row,
        "method",
        issues,
        "cash",
      )
      if (amountPaise === null || !paidAt || !method) return
      if (amountPaise <= 0) {
        issues.push({
          row,
          field: "amount",
          message: "a payment must be greater than zero; a refund is a negative ledger entry",
        })
        return
      }
      rows.push({
        row,
        member: get(record, "member") || null,
        fund: get(record, "fund") || null,
        bank: get(record, "bank") || null,
        amountPaise,
        method,
        paidAt,
        receipt: get(record, "receipt") || null,
        reference: get(record, "reference") || null,
        note: get(record, "note") || null,
      })
      return
    }

    // ledger
    const amountPaise = parsePaise(get(record, "amount"), row, "amount", issues)
    const date = parseDate(get(record, "date"), row, "date", issues)
    const category = parseEnum(
      get(record, "category"),
      LEDGER_CATEGORIES,
      row,
      "category",
      issues,
      "other",
    )
    const fund = get(record, "fund") || null
    const bank = get(record, "bank") || null
    const member = get(record, "member") || null
    if (!fund && !bank && !member) {
      issues.push({
        row,
        field: "fund",
        message: "name a fund, a bank account or a member — an entry with no target moves no balance",
      })
    }
    if (amountPaise === null || !date || !category) return
    if (amountPaise === 0) {
      issues.push({ row, field: "amount", message: "a ledger entry cannot be zero" })
      return
    }
    rows.push({
      row,
      fund,
      bank,
      member,
      amountPaise,
      date,
      category,
      note: get(record, "note") || null,
    })
  })

  return { kind, headers, rows, issues, totalRows: dataRows.length }
}
