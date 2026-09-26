import { Badge } from "@/components/ui/badge"
import { CalendarClock, HandHeart, NotebookPen, Gift } from "lucide-react"
import type {
  CollectionMode,
  ContributionStatus,
  FundType,
  Role,
  TransactionStatus,
} from "@/lib/types"
import { COLLECTION_MODE_LABELS, FUND_TYPE_LABELS, ROLE_LABELS } from "@/lib/types"

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

const MODE_ICON = {
  fixed_monthly: CalendarClock,
  voluntary: HandHeart,
  pledge_based: NotebookPen,
  donation: Gift,
} as const satisfies Record<CollectionMode, typeof CalendarClock>

/**
 * How the fund is collected. The variant is the point: only `fixed_monthly` is
 * tinted, because it is the only mode that can put a member in arrears. Showing
 * an amber "Voluntary" badge next to a red arrears figure would be contradictory,
 * and for this community it would be wrong.
 */
export function CollectionModeBadge({
  mode,
  className,
}: {
  mode: CollectionMode
  className?: string
}) {
  const Icon = MODE_ICON[mode]
  return (
    <Badge
      variant={mode === "fixed_monthly" ? "default" : "outline"}
      className={className}
      title={COLLECTION_MODE_LABELS[mode]}
    >
      <Icon className="size-3" />
      {COLLECTION_MODE_LABELS[mode]}
    </Badge>
  )
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
