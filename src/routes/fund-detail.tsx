import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ListChecks,
  Target,
  TrendingDown,
  UserCog,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import {
  FundTypeBadge,
  TransactionStatusBadge,
} from "@/components/shared/status-badge"
import { useData } from "@/data/store"
import {
  bankSummaries,
  fundBalance,
  spendByCategory,
  transactionsForFund,
} from "@/lib/selectors"
import { formatPaise, formatPaiseCompact, formatDate, percent } from "@/lib/format"
import { CATEGORY_LABELS, type TransactionCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

export default function FundDetail() {
  const { id } = useParams<{ id: string }>()
  const data = useData()
  const fund = data.funds.find((f) => f.id === id)

  const txns = useMemo(
    () => (fund ? transactionsForFund(data.transactions, fund.id) : []),
    [data.transactions, fund],
  )
  const spend = useMemo(
    () => (fund ? spendByCategory(data.ledgerEntries, fund.id) : []),
    [data.ledgerEntries, fund],
  )

  if (!fund) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fund not found" />
        <EmptyState
          title="That fund does not exist"
          description="It may have been removed."
          action={
            <Button asChild size="sm">
              <Link to="/funds">Back to Funds</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const balancePaise = fundBalance(data.ledgerEntries, fund.id)
  const bank = data.banks.find((b) => b.id === fund.bankId)
  const bankState = bank
    ? bankSummaries(data.ledgerEntries, [bank])[0]
    : null
  const manager = data.users.find((u) => u.id === fund.managerId)
  const totalSpend = spend.reduce((acc, s) => acc + s.totalPaise, 0)
  const pending = txns.filter((t) => t.status === "pending")

  // Funds draw on a bank account that may hold more than one fund, so this is
  // an honest comparison rather than an implied equality.
  const drift =
    bankState && fund.bankId
      ? bankState.balancePaise - balancePaise
      : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={fund.name}
        description={fund.description ?? "No description"}
      >
        <Button asChild variant="outline" size="sm">
          <Link to="/funds">
            <ArrowLeft className="size-4" /> Back to Funds
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <FundTypeBadge type={fund.type} />
        {fund.isMemberContribution ? (
          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            Member contributions · {formatPaise(fund.monthlyPaise ?? 0)}/month
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ledger balance"
          value={formatPaise(balancePaise)}
          hint="Sum of every entry for this fund"
        />
        <StatCard
          label="Bank account"
          value={bankState ? formatPaise(bankState.balancePaise) : "—"}
          hint={bank ? bank.name : "No bank linked"}
        />
        <StatCard
          label="Spent YTD"
          value={formatPaise(totalSpend)}
          hint="All withdrawals, approved only"
          icon={TrendingDown}
        />
        <StatCard
          label={fund.targetPaise ? "Progress to target" : "Target"}
          value={
            fund.targetPaise
              ? `${percent(balancePaise, fund.targetPaise).toFixed(0)}%`
              : "Not set"
          }
          hint={fund.targetPaise ? formatPaise(fund.targetPaise) : undefined}
          icon={Target}
          tone={
            fund.targetPaise && balancePaise >= fund.targetPaise
              ? "positive"
              : "default"
          }
        />
      </div>

      {drift !== null && drift !== 0 ? (
        <Card className="border-chart-4/40 bg-chart-4/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <ArrowUpRight className="size-4 shrink-0 text-chart-4" />
            <p>
              This account holds{" "}
              <span className="tabular font-semibold">
                {formatPaise(Math.abs(drift))}
              </span>{" "}
              {drift > 0 ? "more than" : "less than"} this fund&apos;s ledger
              balance. That is expected when the account serves more than one
              fund — reconciliation settles it in milestone M2.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>All fund movements and requests</CardTitle>
            <CardDescription>
              {pending.length > 0
                ? `${pending.length} awaiting review`
                : "Nothing awaiting review"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {txns.length === 0 ? (
              <EmptyState
                title="No movements yet"
                description="Deposits and withdrawals recorded against this fund will appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txns.map((txn) => {
                    const credit =
                      txn.type === "deposit" || txn.type === "transfer_in"
                    return (
                      <TableRow key={txn.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(txn.transactionDate)}
                        </TableCell>
                        <TableCell className="max-w-64 truncate font-medium">
                          {txn.description}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
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

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Where the money went</CardTitle>
              <CardDescription>Approved withdrawals by category</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {spend.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No withdrawals recorded.
                </p>
              ) : (
                spend.map((s) => (
                  <div key={s.category} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>
                        {CATEGORY_LABELS[s.category as TransactionCategory]}
                      </span>
                      <span className="tabular font-medium">
                        {formatPaise(s.totalPaise)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-chart-5"
                        style={{
                          width: `${percent(s.totalPaise, totalSpend)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {percent(s.totalPaise, totalSpend).toFixed(0)}% of spend
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fund setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-2.5">
                <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="font-medium">{bank?.name ?? "No bank linked"}</p>
                  {bank?.branch ? (
                    <p className="text-xs text-muted-foreground">
                      {bank.branch} · {bank.ifscCode}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <UserCog className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{manager?.name ?? "Unassigned"}</p>
                  <p className="text-xs text-muted-foreground">Fund manager</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    {txns.filter((t) => t.status !== "pending").length} of{" "}
                    {txns.length} approved
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pending items never affect a balance
                  </p>
                </div>
              </div>
              {totalSpend > 0 ? (
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  Average outflow{" "}
                  {formatPaiseCompact(totalSpend / Math.max(1, txns.length))} per
                  movement
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
