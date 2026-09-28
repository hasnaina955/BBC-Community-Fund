/**
 * CSV, written by hand.
 *
 * This is here because "join the strings with commas" is wrong in three ways
 * that all fail on a treasurer's laptop rather than in a test, and all three of
 * them fail *quietly* — the file opens, it just says the wrong thing.
 *
 * ## 1. A name containing a comma, a quote, or a newline
 *
 * `Ali, Mohammad` is two columns; `Sheikh "Bhai" Saheb` is unparseable; a name
 * with a line break in it ends the record. RFC 4180 says quote the field and
 * double any quote inside it. This module does that unconditionally for any
 * field that needs it, rather than guessing.
 *
 * ## 2. A name that Excel *executes*
 *
 * This is the one that matters, and it is not a formatting detail. A member
 * called `=HYPERLINK("http://phish.example","Verify your account")` is a legal
 * name. Written to a CSV as-is and opened in Excel, that cell is not text — it
 * is a formula, and the treasurer gets a clickable link on a page that has
 * nothing to do with this application. `+`, `-`, `@` and a leading tab do the
 * same thing.
 *
 * So a text field beginning with one of those is prefixed with an apostrophe,
 * which is the marker both Excel and Google Sheets use for "this is text, not
 * a formula". The cell still *displays* the original string; the apostrophe is
 * consumed on load. There is no way to escape this at the storage layer — the
 * name is legitimate data and belongs in the name column — so the guard belongs
 * here, at the one boundary where the bytes become a spreadsheet.
 *
 * Numbers are exempt, and by type rather than by a flag: a `number` can never
 * be a formula, so there is nothing to guard and nothing to get wrong by
 * forgetting a marker on a new column.
 *
 * ## 3. Excel guessing that UTF-8 is something else
 *
 * A UTF-8 file with no byte-order mark is read as the local codepage, and a
 * treasurer on a Windows machine sees `Zahid QureshÃ¯` where the name should be
 * readable. The BOM is three invisible bytes that say "this is UTF-8" and cost
 * nothing. Records are separated with CRLF, which is what RFC 4180 specifies
 * and what every spreadsheet parser expects.
 *
 * ## What is deliberately not here
 *
 * **Contact details.** A defaulter export carries the same columns the screen
 * does — which is to say it says *by SMS* and not *98765 43210*. The reminders
 * screen shows the channel rather than the number on purpose, and quietly
 * widening that into a file on disk is a different privacy posture from the one
 * the screen sets. If a call list is wanted later it should be its own export
 * with its own decision about it.
 *
 * **The formatted money string.** `₹1,23,456` is not a number to a spreadsheet;
 * it is text, and the column cannot be summed — which is the only reason anybody
 * opens this file. Amounts go out as plain decimal rupees and the column header
 * carries the unit.
 */

/** A cell's value. `null` and `undefined` are written as an empty cell. */
export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn<T> {
  /** Written as the first record, verbatim. */
  header: string
  value: (row: T) => CsvValue
}

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than
 * text. A leading tab or carriage return is on the list because Excel trims
 * them and then evaluates what follows.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/** Guard one text value against being evaluated as a formula. */
export function neutraliseFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text
}

/** Quote a field per RFC 4180, if it needs it. */
function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") {
    // A non-finite number has no honest CSV spelling, and writing "NaN" into a
    // money column would be read by a spreadsheet as text.
    return Number.isFinite(value) ? String(value) : ""
  }
  if (typeof value === "boolean") return value ? "yes" : "no"
  return quote(neutraliseFormula(String(value)))
}

/** `\uFEFF` — see the note on Excel and codepages above. */
export const UTF8_BOM = "﻿"

/**
 * Build a CSV file's complete contents from columns and rows.
 *
 * **The BOM is included here and not in `downloadCsv`.** It belongs to the
 * document, not to the download mechanism, and the whole failure this guards
 * against is a second call site that builds a file by some other route and
 * forgets it. Putting it in the writer would make every caller correct by
 * default and every future one incorrect by omission.
 *
 * The header is always written, even with no rows: a file that opens to show
 * which columns exist is more use than a zero-byte download, and it is what
 * makes "nobody owes anything" a legible result rather than a broken one.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => quote(c.header)).join(",")]
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","))
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n"
}

/**
 * Hand a CSV to the browser as a download.
 *
 * Revoking the object URL is what stops the blob leaking for the life of the
 * document, but revoking it in the same turn as the click aborts the download
 * in some browsers, so it waits for the next task.
 */
export function downloadCsv(filename: string, csv: string): void {
  // `csv` is expected to be `toCsv` output, BOM included. It is not added again
  // here: a second BOM is a visible character in the first header cell.
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Parse a CSV document back into records. Used by the verification suite, and
 * by anyone who has to read a file this module wrote to check it survived.
 *
 * Deliberately small: it handles the quoting and the BOM, and it assumes no
 * field is allowed to span lines unquoted, which `toCsv` never emits.
 */
export function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(UTF8_BOM) ? csv.slice(UTF8_BOM.length) : csv
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') {
        field += ch
        continue
      }
      if (text[i + 1] === '"') {
        field += '"'
        i += 1
        continue
      }
      quoted = false
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      record.push(field)
      field = ""
    } else if (ch === "\r" && text[i + 1] === "\n") {
      record.push(field)
      records.push(record)
      record = []
      field = ""
      i += 1
    } else if (ch === "\r" || ch === "\n") {
      record.push(field)
      records.push(record)
      record = []
      field = ""
    } else {
      field += ch
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}
