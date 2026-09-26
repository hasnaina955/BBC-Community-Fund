import { useMemo, useState } from "react"
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
import { useData } from "@/data/store"
import { CATEGORY_LABELS, type TransactionCategory, type TransactionStatus } from "@/lib/types"
import { formatPaise, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const STATUSES: TransactionStatus[] = [
  "pending",
  "approved",
  "completed",
  "rejected",
]

export default function Transactions() {
  const data = useData()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | TransactionStatus>("all")
  const [fundId, setFundId] = useState<string>("all")

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...data.transactions]
      .filter((t) => {
        if (status !== "all" && t.status !== status) return false
        if (fundId !== "all" && t.fundId !== fundId) return false
        if (!needle) return true
        return (
          t.description.toLowerCase().includes(needle) ||
          (t.approvalNote ?? "").toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
  }, [data.transactions, query, status, fundId])

  const pending = data.transactions.filter((t) => t.status === "pending")
  const approved = data.transactions.filter(
    (t) => t.status === "approved" || t.status === "completed",
  )
  const inflow = approved
    .filter((t) => t.type === "deposit" || t.type === "transfer_in")
    .reduce((acc, t) => acc + t.amountPaise, 0)
  const outflow = approved
    .filter((t) => t.type === "withdrawal" || t.type === "transfer_out")
    .reduce((acc, t) => acc + t.amountPaise, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="All fund movements and requests."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Inflow (approved)" value={formatPaise(inflow)} tone="positive" />
        <StatCard label="Outflow (approved)" value={formatPaise(outflow)} tone="negative" />
        <StatCard
          label="Net"
          value={formatPaise(inflow - outflow)}
          tone={inflow - outflow >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Awaiting review"
          value={String(pending.length)}
          hint="These have not moved a balance"
          tone={pending.length > 0 ? "warning" : "default"}
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
          <Select value={fundId} onValueChange={setFundId}>
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All funds</SelectItem>
              {data.funds.map((f) => (
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
                {rows.map((txn) => {
                  const fund = data.funds.find((f) => f.id === txn.fundId)
                  const requester = data.users.find(
                    (u) => u.id === txn.requestedBy,
                  )
                  const approver = data.users.find(
                    (u) => u.id === txn.approvedBy,
                  )
                  const credit =
                    txn.type === "deposit" || txn.type === "transfer_in"
                  return (
                    <TableRow key={txn.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(txn.transactionDate)}
                      </TableCell>
                      <TableCell className="max-w-72">
                        <span className="flex items-center gap-2">
                          {credit ? (
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
                        {fund?.name ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {CATEGORY_LABELS[txn.category as TransactionCategory]}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-medium",
                          credit ? "text-chart-3" : "text-destructive",
                        )}
                      >
                        {credit ? "+" : "−"}
                        {formatPaise(txn.amountPaise)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {requester?.name ?? "—"}
                        {approver ? (
                          <span className="block text-xs">
                            by {approver.name}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <TransactionStatusBadge status={txn.status} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
