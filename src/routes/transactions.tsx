import { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import { TransactionStatusBadge } from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useFunds, useTransactions } from "@/data/queries"
import {
  CATEGORY_LABELS,
  type TransactionCategory,
  type TransactionStatus,
} from "@/lib/types"
import { formatPaise, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const STATUSES: TransactionStatus[] = [
  "pending",
  "approved",
  "completed",
  "rejected",
]

/**
 * The rows and the four stat tiles come from one `aggregate:transactions` read
 * model. The tiles deliberately describe the whole organisation rather than the
 * current filter — switching to "Rejected" should not make the treasury think
 * the year's income changed.
 */
export default function Transactions() {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | TransactionStatus>("all")
  const [fundId, setFundId] = useState<string | null>(null)

  const fundsModel = useFunds()
  const model = useTransactions(status, fundId)

  const needle = query.trim().toLowerCase()
  const rows = (model?.rows ?? []).filter(
    (t) =>
      !needle ||
      t.description.toLowerCase().includes(needle) ||
      (t.approvalNote ?? "").toLowerCase().includes(needle),
  )
  const stats = model?.stats

  return (
    <WithReadModel data={model} label="Loading transactions">
      {() => (
        <div className="space-y-6">
          <PageHeader
            title="Transactions"
            description="All fund movements and requests."
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Inflow (approved)"
              value={formatPaise(stats?.inflowPaise ?? 0)}
              tone="positive"
            />
            <StatCard
              label="Outflow (approved)"
              value={formatPaise(stats?.outflowPaise ?? 0)}
              tone="negative"
            />
            <StatCard
              label="Net"
              value={formatPaise(
                (stats?.inflowPaise ?? 0) - (stats?.outflowPaise ?? 0),
              )}
              tone={
                (stats?.inflowPaise ?? 0) - (stats?.outflowPaise ?? 0) >= 0
                  ? "positive"
                  : "negative"
              }
            />
            <StatCard
              label="Awaiting review"
              value={String(stats?.pendingCount ?? 0)}
              hint="These have not moved a balance"
              tone={(stats?.pendingCount ?? 0) > 0 ? "warning" : "default"}
            />
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search descriptions"
                className="flex-1"
              />
              <Select
                value={fundId ?? "all"}
                onValueChange={(v) => setFundId(v === "all" ? null : v)}
              >
                <SelectTrigger className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All funds</SelectItem>
                  {(fundsModel ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant={status === "all" ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setStatus("all")}
                >
                  All
                </Badge>
                {STATUSES.map((s) => (
                  <Badge
                    key={s}
                    variant={status === s ? "default" : "outline"}
                    className="cursor-pointer capitalize"
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Wallet}
                    title="No transactions match"
                    description="Adjust the filters or search to see more."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Fund</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Requested by</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((txn) => (
                      <TableRow key={txn.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(txn.date)}
                        </TableCell>
                        <TableCell className="max-w-72">
                          <span className="flex items-center gap-2">
                            {txn.isCredit ? (
                              <ArrowDownLeft className="size-3.5 shrink-0 text-chart-3" />
                            ) : (
                              <ArrowUpRight className="size-3.5 shrink-0 text-destructive" />
                            )}
                            <span className="truncate font-medium">
                              {txn.description}
                            </span>
                          </span>
                          {txn.approvalNote ? (
                            <span className="ml-5 block truncate text-xs italic text-muted-foreground">
                              {txn.approvalNote}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {txn.fundName}
                          {txn.toFundName ? ` → ${txn.toFundName}` : ""}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {CATEGORY_LABELS[txn.category as TransactionCategory]}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular text-right font-medium",
                            txn.isCredit ? "text-chart-3" : "text-destructive",
                          )}
                        >
                          {txn.isCredit ? "+" : "−"}
                          {formatPaise(txn.amountPaise)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {txn.requestedByName || "—"}
                          {txn.approvedByName ? (
                            <span className="block text-xs">
                              by {txn.approvedByName}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <TransactionStatusBadge status={txn.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {model?.truncated ? (
                <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                  Showing the 200 most recent of every request. The stat tiles
                  above cover all of them.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </WithReadModel>
  )
}
