import { Badge } from "@/components/ui/badge"
import type {
  ContributionStatus,
  FundType,
  Role,
  TransactionStatus,
} from "@/lib/types"
import { FUND_TYPE_LABELS, ROLE_LABELS } from "@/lib/types"

const CONTRIBUTION_VARIANT: Record<
  ContributionStatus,
  "success" | "destructive" | "warning" | "info"
> = {
  paid: "success",
  due: "destructive",
  partial: "warning",
  waived: "info",
}

const CONTRIBUTION_LABEL: Record<ContributionStatus, string> = {
  paid: "Paid",
  due: "Unpaid",
  partial: "Partial",
  waived: "Waived",
}

export function ContributionStatusBadge({
  status,
}: {
  status: ContributionStatus
}) {
  return (
    <Badge variant={CONTRIBUTION_VARIANT[status]}>
      {CONTRIBUTION_LABEL[status]}
    </Badge>
  )
}

const TRANSACTION_VARIANT: Record<
  TransactionStatus,
  "success" | "destructive" | "warning" | "secondary"
> = {
  approved: "success",
  completed: "success",
  rejected: "destructive",
  pending: "warning",
}

export function TransactionStatusBadge({
  status,
}: {
  status: TransactionStatus
}) {
  return (
    <Badge variant={TRANSACTION_VARIANT[status]}>
      <span className="capitalize">{status}</span>
    </Badge>
  )
}

export function FundTypeBadge({ type }: { type: FundType }) {
  return <Badge variant="outline">{FUND_TYPE_LABELS[type]}</Badge>
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge
      variant={role === "admin" ? "default" : "secondary"}
      className="capitalize"
    >
      {ROLE_LABELS[role]}
    </Badge>
  )
}
