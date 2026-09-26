import { Link, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ListChecks,
  NotebookPen,
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
  CollectionModeBadge,
  FundTypeBadge,
  TransactionStatusBadge,
} from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useFundDetail } from "@/data/queries"
import { formatPaise, formatPaiseCompact, formatDate, percent } from "@/lib/format"
import { CATEGORY_LABELS, type TransactionCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Everything on this screen is one `aggregate:fundDetail` read model: the
 * balance, the bank comparison, this year's spend by category, and — for a
 * pledge-based fund — what was promised against what arrived.
 *
 * The stat row changes shape with the collection mode. A `pledge_based` fund
 * shows pledged-versus-received instead of a target, and a `voluntary` fund gets
 * no target at all, because nobody is working towards a fixed figure.
 */
export default function FundDetail() {
  const { id } = useParams<{ id: string }>()
  const model = useFundDetail(id)

  return (
    <WithReadModel data={model} label="Loading the fund">
      {(fund) => {
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

        const totalSpend = fund.spendByCategory.reduce(
          (acc, s) => acc + s.totalPaise,
          0,
        )
        const pending = fund.transactions.filter(
          (t) => t.status === "pending",
        ).length
        const drift =
          fund.bankId && fund.bankBalancePaise !== null
            ? fund.bankBalancePaise - fund.balancePaise
            : null
        const isPledged = fund.pledgedPaise !== null

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
              <CollectionModeBadge mode={fund.collectionMode} />
              {fund.collectionMode === "fixed_monthly" &&
              fund.monthlyAmountPaise ? (
                <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  {formatPaise(fund.monthlyAmountPaise)}/member/month
                </span>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Ledger balance"
                value={formatPaise(fund.balancePaise)}
                hint="Sum of every entry for this fund"
              />
              <StatCard
                label="Bank account"
                value={
                  fund.bankBalancePaise !== null
                    ? formatPaise(fund.bankBalancePaise)
                    : "—"
                }
                hint={fund.bank ? fund.bank.name : "No bank linked"}
              />
              {isPledged ? (
                <StatCard
                  label="Pledged"
                  value={formatPaise(fund.pledgedPaise ?? 0)}
                  hint="Promised by members, not yet a due"
                  icon={NotebookPen}
                />
              ) : (
                <StatCard
                  label="Spent YTD"
                  value={formatPaise(totalSpend)}
                  hint="All withdrawals, approved only"
                  icon={TrendingDown}
                />
              )}
              <StatCard
                label={fund.targetAmountPaise ? "Progress to target" : "Target"}
                value={
                  fund.targetAmountPaise
                    ? `${percent(
                        fund.balancePaise,
                        fund.targetAmountPaise,
                      ).toFixed(0)}%`
                    : "Not set"
                }
                hint={
                  fund.targetAmountPaise
                    ? formatPaise(fund.targetAmountPaise)
                    : fund.collectionMode === "voluntary"
                      ? "Voluntary giving has no target"
                      : undefined
                }
                icon={Target}
                tone={
                  fund.targetAmountPaise &&
                  fund.balancePaise >= fund.targetAmountPaise
                    ? "positive"
                    : "default"
                }
              />
            </div>

            {isPledged ? (
              <Card className="border-chart-2/40 bg-chart-2/5">
                <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <NotebookPen className="size-4 shrink-0 text-chart-2" />
                  <p>
                    Members have promised{" "}
                    <span className="tabular font-semibold">
                      {formatPaise(fund.pledgedPaise ?? 0)}
                    </span>{" "}
                    to this fund and{" "}
                    <span className="tabular font-semibold">
                      {formatPaise(fund.balancePaise)}
                    </span>{" "}
                    has arrived. The shortfall is a promise still outstanding,
                    not arrears — nobody is in debt to the jamaat.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {drift !== null && drift !== 0 ? (
              <Card className="border-chart-4/40 bg-chart-4/5">
                <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <ArrowUpRight className="size-4 shrink-0 text-chart-4" />
                  <p>
                    This account holds{" "}
                    <span className="tabular font-semibold">
                      {formatPaise(Math.abs(drift))}
                    </span>{" "}
                    {drift > 0 ? "more than" : "less than"} this fund&apos;s
                    ledger balance. That is expected when the account serves
                    more than one fund — reconciliation settles it in milestone
                    M2.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>All fund movements and requests</CardTitle>
                  <CardDescription>
                    {pending > 0
                      ? `${pending} awaiting review`
                      : "Nothing awaiting review"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {fund.transactions.length === 0 ? (
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
                        {fund.transactions.map((txn) => (
                          <TableRow key={txn.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDate(txn.date)}
                            </TableCell>
                            <TableCell className="max-w-64 truncate font-medium">
                              {txn.description}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {CATEGORY_LABELS[
                                txn.category as TransactionCategory
                              ]}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "tabular text-right font-medium",
                                txn.isCredit
                                  ? "text-chart-3"
                                  : "text-destructive",
                              )}
                            >
                              {txn.isCredit ? "+" : "−"}
                              {formatPaise(txn.amountPaise)}
                            </TableCell>
                            <TableCell>
                              <TransactionStatusBadge status={txn.status} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Where the money went</CardTitle>
                    <CardDescription>
                      Approved withdrawals by category, this year
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {totalSpend === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No withdrawals recorded.
                      </p>
                    ) : (
                      fund.spendByCategory.map((s) => (
                        <div key={s.category} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span>
                              {CATEGORY_LABELS[
                                s.category as TransactionCategory
                              ]}
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
                            {percent(s.totalPaise, totalSpend).toFixed(0)}% of
                            spend
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
                        <p className="font-medium">
                          {fund.bank?.name ?? "No bank linked"}
                        </p>
                        {fund.bank?.branch ? (
                          <p className="text-xs text-muted-foreground">
                            {fund.bank.branch} · {fund.bank.ifscCode}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <UserCog className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {fund.managerName ?? "Unassigned"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Fund manager
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {fund.transactions.filter(
                            (t) => t.status !== "pending",
                          ).length}{" "}
                          of {fund.transactions.length} approved
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Pending items never affect a balance
                        </p>
                      </div>
                    </div>
                    {totalSpend > 0 && fund.transactions.length > 0 ? (
                      <p className="border-t pt-3 text-xs text-muted-foreground">
                        Average outflow{" "}
                        {formatPaiseCompact(
                          totalSpend / fund.transactions.length,
                        )}{" "}
                        per movement
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )
      }}
    </WithReadModel>
  )
}
