import { useMemo, useState } from "react"
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import { FundTypeBadge } from "@/components/shared/status-badge"
import { useActions, useData } from "@/data/store"
import { formatPaise, formatDate } from "@/lib/format"
import { CATEGORY_LABELS, type TransactionCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

export default function Approvals() {
  const data = useData()
  const { setTransactionStatus } = useActions()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const pending = useMemo(
    () =>
      [...data.transactions]
        .filter((t) => t.status === "pending")
        .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)),
    [data.transactions],
  )

  const totalPaise = pending.reduce((acc, t) => acc + t.amountPaise, 0)
  const withdrawals = pending.filter(
    (t) => t.type === "withdrawal" || t.type === "transfer_out",
  )
  const deposits = pending.filter(
    (t) => t.type === "deposit" || t.type === "transfer_in",
  )

  const decide = (id: string, decision: "approved" | "rejected") => {
    setBusy(id)
    // A brief pause so the state change reads as deliberate rather than
    // accidental. The seed data is local; nothing is persisted.
    setTimeout(() => {
      setTransactionStatus(id, decision, notes[id])
      setBusy(null)
    }, 250)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Approvals"
        description="Awaiting review. Nothing here has moved a balance yet."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting review" value={String(pending.length)} />
        <StatCard label="Total value" value={formatPaise(totalPaise)} />
        <StatCard
          label="Withdrawals"
          value={String(withdrawals.length)}
          tone={withdrawals.length > 0 ? "negative" : "default"}
        />
        <StatCard label="Deposits" value={String(deposits.length)} tone="positive" />
      </div>

      {pending.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All caught up!"
          description="There is nothing waiting for review."
        />
      ) : (
        <div className="space-y-3">
          {pending.map((txn) => {
            const fund = data.funds.find((f) => f.id === txn.fundId)
            const toFund = data.funds.find((f) => f.id === txn.toFundId)
            const requester = data.users.find((u) => u.id === txn.requestedBy)
            const credit = txn.type === "deposit" || txn.type === "transfer_in"
            const isSelf =
              txn.requestedBy === data.currentUser.id && data.currentUser.role !== "admin"

            return (
              <Card key={txn.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <div
                      className={cn(
                        "rounded-lg p-2.5",
                        credit
                          ? "bg-chart-3/15 text-chart-3"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {credit ? (
                        <ArrowDownLeft className="size-5" />
                      ) : (
                        <ArrowUpRight className="size-5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{txn.description}</p>
                        {fund ? <FundTypeBadge type={fund.type} /> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {fund?.name}
                        {toFund ? ` → ${toFund.name}` : ""} ·{" "}
                        {CATEGORY_LABELS[txn.category as TransactionCategory]} ·{" "}
                        {formatDate(txn.transactionDate)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Requested by {requester?.name ?? "unknown"}
                      </p>
                    </div>

                    <p
                      className={cn(
                        "tabular shrink-0 text-2xl font-semibold",
                        credit ? "text-chart-3" : "text-destructive",
                      )}
                    >
                      {credit ? "+" : "−"}
                      {formatPaise(txn.amountPaise)}
                    </p>
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`note-${txn.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Approval note (optional)
                      </Label>
                      <Input
                        id={`note-${txn.id}`}
                        value={notes[txn.id] ?? ""}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [txn.id]: e.target.value }))
                        }
                        placeholder="Add a note..."
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => decide(txn.id, "approved")}
                        disabled={busy === txn.id || isSelf}
                        title={
                          isSelf
                            ? "A requester cannot approve their own transaction"
                            : undefined
                        }
                      >
                        <CheckCircle2 className="size-4" />
                        {busy === txn.id ? "Approving..." : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide(txn.id, "rejected")}
                        disabled={busy === txn.id}
                      >
                        <XCircle className="size-4" /> Reject
                      </Button>
                      {isSelf ? (
                        <p className="text-xs text-muted-foreground">
                          You requested this — a second person must approve it.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
