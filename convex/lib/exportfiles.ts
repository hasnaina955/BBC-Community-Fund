import { COLUMNS, type ImportKind } from "./importcsv"

/**
 * The files a community can take away with it.
 *
 * ## Why the definitions live here and not in `exports.ts`
 *
 * The column lists are a contract with the *import*, and a contract that can
 * only be checked by running a deployment is a contract nobody checks. Keeping
 * them pure means `bun run check` can assert, without a backend, that every file
 * this module calls re-importable still is — the same reason `lib/roster.ts` is
 * its own file.
 *
 * ## The one thing this export cannot do, and why it says so
 *
 * Three of the eight files are the inverse of the CSV import: members, payments
 * and the ledger can be exported here and imported there, which is what makes a
 * community's records *portable* rather than merely readable.
 * `contributions.csv` is deliberately **not** one of them, and the reason is a
 * real gap in the data model rather than an omission here.
 *
 * A contribution's status is set in two different ways. A payment settles the
 * oldest unpaid month when it is recorded (`lib/collection.ts`), and a treasurer
 * can also mark a month paid outright from the grid (`members.setMonthStatus`,
 * the "mark everyone paid" button). Neither writes down *which* payment settled
 * a month, and the import needs the date a paid month was paid — so a paid month
 * in this product is a claim about money with no receipt attached, and exporting
 * it in an importable shape would mean inventing a date for it.
 *
 * So the file carries the grid as the community recorded it, including months
 * marked paid by hand, and the screen says which files can go back in. Naming
 * that gap is the point — `docs/ROADMAP.md` carries it as an open item. The
 * alternative, quietly exporting paid months as due so the file round-trips,
 * would rewrite the community's own record of what it did.
 */

export type ExportKey =
  | "members"
  | "contributions"
  | "payments"
  | "ledger"
  | "funds"
  | "banks"
  | "transactions"
  | "audit"

export interface ExportFile {
  key: ExportKey
  /** The name the browser saves it under. */
  filename: string
  /** The card heading on the screen. */
  title: string
  /** One line on the screen saying what is in it. */
  description: string
  /** The import kind that reads this file back, or `null` when nothing does. */
  readsBackAs: ImportKind | null
  /** Why it cannot be re-imported. Present only when `readsBackAs` is null. */
  notImportableBecause?: string
  columns: string[]
}

/**
 * The columns an import kind reads, in the order its template lists them.
 *
 * Exported so the check suite can hold every re-importable file to it: the
 * required columns must all be present, and every column written must be one the
 * import understands — a column it ignores is data a round trip would drop.
 */
export function importColumns(kind: ImportKind): string[] {
  return [...COLUMNS[kind].required, ...COLUMNS[kind].optional]
}

/**
 * The files, in the order the screen offers them: the three the import reads
 * back first, then the records that only make sense as a record.
 */
export const EXPORT_FILES: ExportFile[] = [
  {
    key: "members",
    filename: "members.csv",
    title: "Members",
    description: "Who is on the roster, with contact details and join dates.",
    readsBackAs: "members",
    columns: ["name", "email", "phone", "relation", "joined_year", "joined_month"],
  },
  {
    key: "contributions",
    filename: "contributions.csv",
    title: "Contribution grid",
    description:
      "What each member was charged for each month, and the status the grid holds — including months marked paid by hand.",
    readsBackAs: null,
    notImportableBecause:
      "the product does not record which payment settled a month, so a paid month has no date to import against",
    columns: [
      "member",
      "fund",
      "year",
      "month",
      "amount",
      "status",
      "due_date",
      "waived_reason",
    ],
  },
  {
    key: "payments",
    filename: "payments.csv",
    title: "Payments received",
    description:
      "Every receipt, with its number, method and date. Importing this into a new organisation re-issues receipt numbers from that organisation's own sequence and keeps the original number as the reference.",
    readsBackAs: "payments",
    columns: [
      "amount",
      "paid_at",
      "member",
      "fund",
      "bank",
      "method",
      "receipt",
      "reference",
    ],
  },
  {
    key: "ledger",
    filename: "ledger.csv",
    title: "Ledger",
    description:
      "Every entry the balances are derived from. Amounts are signed: money in is positive, money out is negative.",
    readsBackAs: "ledger",
    columns: ["amount", "date", "fund", "bank", "member", "category", "note", "source"],
  },
  {
    key: "funds",
    filename: "funds.csv",
    title: "Funds",
    description: "Each fund, what kind it is, and how it is collected.",
    readsBackAs: null,
    notImportableBecause:
      "a community creates its funds as it signs up; there is no funds import",
    columns: [
      "name",
      "type",
      "collection_mode",
      "description",
      "bank",
      "target_amount",
      "monthly_amount",
      "member_contribution",
      "is_active",
    ],
  },
  {
    key: "banks",
    filename: "banks.csv",
    title: "Bank accounts",
    description: "The accounts money is held in, with the UPI address when there is one.",
    readsBackAs: null,
    notImportableBecause: "a bank account is created during setup; there is no bank import",
    columns: ["name", "branch", "account_number", "ifsc_code", "upi_id", "notes"],
  },
  {
    key: "transactions",
    filename: "transactions.csv",
    title: "Transactions",
    description: "Money movements with their approval, who asked and who approved.",
    readsBackAs: null,
    notImportableBecause:
      "a transaction is the approval that produced ledger entries; the ledger is the record of money",
    columns: [
      "fund",
      "type",
      "amount",
      "category",
      "description",
      "status",
      "requested_by",
      "approved_by",
      "transaction_date",
      "approval_note",
    ],
  },
  {
    key: "audit",
    filename: "audit-log.csv",
    title: "Audit log",
    description: "Every recorded action, with who did it and when.",
    readsBackAs: null,
    notImportableBecause: "the audit log records what happened; there is nothing to import it into",
    columns: [
      "when",
      "actor",
      "action",
      "entity_type",
      "entity_id",
      "details",
      "ip",
      "user_agent",
    ],
  },
]
