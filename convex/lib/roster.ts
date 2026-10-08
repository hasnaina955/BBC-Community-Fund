import type { ImportIssue, MemberRow } from "./importcsv"

/**
 * Deciding who on a spreadsheet is already on the roster.
 *
 * ## Why this is a separate, pure file
 *
 * The rules here are the subtle half of importing a membership list, and they
 * are the half that fails *quietly*: a roster import that adds a second copy of
 * everybody looks like success, and one that drops a member looks like success
 * too. Being pure means the check suite can point real spreadsheets at it and
 * assert what happens, without a deployment and without a database — the same
 * reason `src/lib/csv.ts` is imported directly by that suite.
 */

/** The roster, reduced to the three things a spreadsheet row can be matched on. */
export interface RosterKeys {
  emails: Set<string>
  phones: Set<string>
  names: Set<string>
}

/**
 * A phone number as a comparable string.
 *
 * `+91 98765 43210` from a spreadsheet and `+919876543210` from the app are the
 * same number, and matching them as strings would not be. Punctuation and spaces
 * are dropped; a leading `+` is kept, because it is the only part that says
 * anything.
 */
export function phoneKey(phone: string): string {
  return phone.replace(/[\s\-().]/g, "").toLowerCase()
}

export function rosterKeys(
  members: Array<{ name: string; email?: string; phone?: string }>,
): RosterKeys {
  const emails = new Set<string>()
  const phones = new Set<string>()
  const names = new Set<string>()
  for (const m of members) {
    if (m.email) emails.add(m.email.trim().toLowerCase())
    if (m.phone) phones.add(phoneKey(m.phone))
    names.add(m.name.trim().toLowerCase())
  }
  return { emails, phones, names }
}

export interface MemberIdentity {
  key: string
  field: "email" | "phone" | "name"
}

/**
 * What identifies a row as a person.
 *
 * An email if the row has one, else a phone, else the name. The `field` comes
 * back with the key so a duplicate can be reported against the column that
 * caused it.
 */
export function memberKey(row: MemberRow): MemberIdentity {
  if (row.email) return { key: `email:${row.email}`, field: "email" }
  if (row.phone) return { key: `phone:${phoneKey(row.phone)}`, field: "phone" }
  return { key: `name:${row.name.trim().toLowerCase()}`, field: "name" }
}

/** Whether this row describes somebody the roster already has. */
export function isOnRoster(row: MemberRow, roster: RosterKeys): boolean {
  if (row.email) return roster.emails.has(row.email)
  if (row.phone) return roster.phones.has(phoneKey(row.phone))
  // Name-only. *Any* holder of the name counts, because the row carries nothing
  // that could tell one from another; the caller reports the skip rather than
  // swallowing it.
  return roster.names.has(row.name.trim().toLowerCase())
}

/**
 * Split a membership list into the rows worth adding and the people we already
 * have.
 *
 * Duplicates *inside the file* are checked first and are refused, not skipped:
 * a file that lists one person twice is a file with a problem, and the problem
 * is worth reporting whether or not they are already a member. Two rows are the
 * same person when they share an email, or a phone, or a name *and* neither has
 * an email or a phone — two rows called "Mohammed Ali" with different addresses
 * are two people and both are kept.
 */
export function planRoster(
  rows: MemberRow[],
  roster: RosterKeys,
  issues: ImportIssue[],
): { usable: MemberRow[]; skipped: string[] } {
  const skipped: string[] = []
  const usable: MemberRow[] = []
  const firstSeen = new Map<string, number>()

  for (const row of rows) {
    const { key, field } = memberKey(row)
    const earlier = firstSeen.get(key)
    if (earlier !== undefined) {
      issues.push({
        row: row.row,
        field,
        message:
          field === "name"
            ? `row ${earlier} is also called "${row.name}", and neither row has an email or a phone to tell them apart — give one of them an email or a phone number`
            : `${field} "${field === "email" ? row.email : row.phone}" is on row ${earlier} as well — one row per member`,
      })
      continue
    }
    firstSeen.set(key, row.row)

    if (isOnRoster(row, roster)) {
      skipped.push(row.email ? `${row.name} (${row.email})` : row.name)
      continue
    }
    usable.push(row)
  }

  return { usable, skipped }
}
