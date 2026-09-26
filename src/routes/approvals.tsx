import { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import {
  CollectionModeBadge,
  FundTypeBadge,
} from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useActions, useCurrentUser } from "@/data/store"
import { useApprovals } from "@/data/queries"
import { formatPaise, formatDate } from "@/lib/format"
import { CATEGORY_LABELS, type TransactionCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The queue, with fund names, fund types and collection modes already resolved
 * by `aggregate:approvals` — approving a request writes to the ledger and
 * updates a materialised balance, so this list is the one screen that changes
 * the books.
 */
export default function Approvals() {
  const me = useCurrentUser()
  const { setTransactionStatus } = useActions()
  const model = useApprovals()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const pending = model ?? []
  const totalPaise = pending.reduce((acc, t) => acc + t.amountPaise, 0)
  const withdrawals = pending.filter((t) => !t.isCredit).length
  const deposits = pending.length - withdrawals

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id)
    try {
      await setTransactionStatus(id, decision, notes[id])
    } finally {
      setBusy(null)
    }
  }

  return (
    <WithReadModel data={model} label="Loading the queue">
      {() => (
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
              value={String(withdrawals)}
              tone={withdrawals > 0 ? "negative" : "default"}
            />
            <StatCard
              label="Deposits"
              value={String(deposits)}
              tone="positive"
            />
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
                const isSelf =
                  txn.requestedBy === me.id && me.role !== "admin"

                return (
                  <Card key={txn.id}>
                    <CardContent className="space-y-4 p-5">
                      <div className="flex flex-wrap items-start gap-4">
                        <div
                          className={cn(
                            "rounded-lg p-2.5",
                            txn.isCredit
                              ? "bg-chart-3/15 text-chart-3"
                              : "bg-destructive/10 text-destructive",
                          )}
                        >
                          {txn.isCredit ? (
                            <ArrowDownLeft className="size-5" />
                          ) : (
                            <ArrowUpRight className="size-5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{txn.description}</p>
                            {txn.fundType ? (
                              <FundTypeBadge type={txn.fundType} />
                            ) : null}
                            {txn.collectionMode ? (
                              <CollectionModeBadge
                                mode={txn.collectionMode}
                              />
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {txn.fundName}
                            {txn.toFundName ? ` → ${txn.toFundName}` : ""} ·{" "}
                            {CATEGORY_LABELS[
                              txn.category as TransactionCategory
                            ]}{" "}
                            · {formatDate(txn.date)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Requested by {txn.requestedByName || "unknown"}
                          </p>
                        </div>

                        <p
                          className={cn(
                            "tabular shrink-0 text-2xl font-semibold",
                            txn.isCredit
                              ? "text-chart-3"
                              : "text-destructive",
                          )}
                        >
                          {txn.isCredit ? "+" : "−"}
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
                              setNotes((prev) => ({
                                ...prev,
                                [txn.id]: e.target.value,
                              }))
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
                              You requested this — a second person must approve
                              it. The server refuses it too.
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
      )}
    </WithReadModel>
  )
}
