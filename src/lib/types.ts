/**
 * Domain types for the v2 model described in docs/ARCHITECTURE.md.
 *
 * Money fields are suffixed `Paise` and are always integers. The recovered
 * legacy model used floating-point `amount` and stored two competing balance
 * counters; both are gone here. See docs/RECOVERY.md.
 */

export type FundType =
  | "general"
  | "zakat"
  | "charity"
  | "emergency"
  | "project"
  | "operational"
  | "investment"

export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "transfer_in"
  | "transfer_out"

export type TransactionCategory =
  | "operations"
  | "emergency"
  | "investment"
  | "donation"
  | "salary"
  | "maintenance"
  | "other"

export type TransactionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed"

export type ContributionStatus = "due" | "paid" | "partial" | "waived"

export type PaymentMethod = "cash" | "cheque" | "upi" | "card" | "transfer"

export type Role = "admin" | "treasurer" | "fund_manager" | "viewer" | "member"

export type LedgerSource =
  | "opening"
  | "transaction"
  | "payment"
  | "correction"
  | "transfer"

export interface Bank {
  id: string
  name: string
  branch: string | null
  accountNumber: string | null
  ifscCode: string | null
  notes: string | null
}

export interface Fund {
  id: string
  name: string
  type: FundType
  description: string | null
  bankId: string | null
  managerId: string | null
  /** Target in paise. */
  targetPaise: number | null
  isActive: boolean
  isMemberContribution: boolean
  /** Default monthly dues per member, in paise. */
  monthlyPaise: number | null
}

export interface Member {
  id: string
  name: string
  phone: string | null
  email: string | null
  relation: string | null
  joinedYear: number
  joinedMonth: number
  isActive: boolean
}

export interface User {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
}

/** The obligation: a member owes this much for this month. */
export interface Contribution {
  id: string
  memberId: string
  fundId: string | null
  year: number
  /** 1-indexed. */
  month: number
  amountPaise: number
  status: ContributionStatus
  waivedReason: string | null
}

/** The payment: money actually received, and how. */
export interface Payment {
  id: string
  memberId: string | null
  fundId: string | null
  bankId: string | null
  amountPaise: number
  method: PaymentMethod
  paidAt: string
  collectedBy: string | null
  receiptNo: string
  reference: string | null
}

/**
 * The fact. The single source every balance derives from — never stored as a
 * running counter.
 */
export interface LedgerEntry {
  id: string
  fundId: string | null
  bankId: string | null
  memberId: string | null
  /** Signed: positive is a credit, negative a debit. Integer paise. */
  amountPaise: number
  direction: "credit" | "debit"
  category: TransactionCategory
  effectiveDate: string
  source: LedgerSource
  refType: string | null
  refId: string | null
  note: string | null
  actorId: string | null
  /** Set by financial-year close; writes into a locked period are rejected. */
  lockedTo: number | null
}

export interface Transaction {
  id: string
  fundId: string
  type: TransactionType
  amountPaise: number
  description: string
  category: TransactionCategory
  toFundId: string | null
  status: TransactionStatus
  requestedBy: string | null
  approvedBy: string | null
  approvalNote: string | null
  transactionDate: string
}

export interface AuditEntry {
  id: string
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  details: string | null
  createdAt: string
}

export const FUND_TYPE_LABELS: Record<FundType, string> = {
  general: "General",
  zakat: "Zakat",
  charity: "Charity",
  emergency: "Emergency",
  project: "Project",
  operational: "Operational",
  investment: "Investment",
}

export const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  operations: "Operations",
  emergency: "Emergency",
  investment: "Investment",
  donation: "Donation",
  salary: "Salary",
  maintenance: "Maintenance",
  other: "Other",
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  cheque: "Cheque",
  upi: "UPI",
  card: "Card",
  transfer: "Transfer",
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  treasurer: "Treasurer",
  fund_manager: "Manager",
  viewer: "Viewer",
  member: "Member",
}
