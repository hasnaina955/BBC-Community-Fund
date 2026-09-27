import { useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { BarChart3, Download, HandHeart, TrendingUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import { CollectionModeBadge } from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useReports } from "@/data/queries"
import { useShell } from "@/data/store"
import { CURRENT_YEAR, yearsInRange } from "@/data/period"
import {
  formatPaise,
  formatPaiseCompact,
  MONTH_LABELS,
  MONTHS_SHORT,
  percent,
} from "@/lib/format"
import { CATEGORY_LABELS, type TransactionCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

/**
 * Ageing bars run from calm to alarming, so the colour has to as well: the
 * youngest money owed is the least urgent, and the bar for money owed for more
 * than three months is the one that should catch the eye.
 */
const AGING_BAR = [
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-destructive/80",
  "bg-destructive",
]

/** `March 2024` from a `YYYY-MM-DD` due date, for the oldest-due column. */
function monthYear(iso: string | null): string {
  if (!iso) return ""
  const month = Number(iso.slice(5, 7))
  return `${MONTH_LABELS[month - 1] ?? ""} ${iso.slice(0, 4)}`.trim()
}

/**
 * One `aggregate:reports` call per year, returning efficiency per month,
 * expenditure by category, the ageing buckets, the worst defaulters and fund
 * progress.
 *
 * The ageing section is scoped to `fixed_monthly` funds on the server. When
 * this community asks "who owes us?", the honest answer is about the ₹100
 * monthly fund and nothing else — so the Friday collection is reported in its
 * own section, by what was collected, and never as a debt.
 */
export default function Reports() {
  const shell = useShell()
  const [year, setYear] = useState(CURRENT_YEAR)
  const model = useReports(year)
  const years = yearsInRange(shell.yearRange.from, shell.yearRange.to)

  return (
    <WithReadModel data={model} label={`Loading the ${year} report`}>
      {(data) => {
        const stats = data.yearStats
        const monthly = data.efficiency.map((e) => ({
          month: MONTHS_SHORT[e.month - 1],
          rate: e.rate,
        }))
        const hasArrearsBasis = data.fundProgress.some(
          (f) => f.collectionMode === "fixed_monthly",
        )
        const unscheduledRounds = data.collectionRounds.filter(
          (r) => r.collectionMode !== "fixed_monthly",
        )

        return (
          <div className="space-y-6">
            <PageHeader
              title="Reports"
              description={`Financial position for ${year}`}
            >
              <Select
                value={String(year)}
                onValueChange={(v) => setYear(Number(v))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Available in milestone M7"
              >
                <Download className="size-4" /> Export
              </Button>
            </PageHeader>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={`Collected ${year}`}
                value={formatPaise(stats.collectedPaise)}
                hint={`${stats.collectionRate.toFixed(1)}% of ${formatPaise(
                  stats.expectedPaise,
                )} due`}
                icon={TrendingUp}
                tone="positive"
              />
              <StatCard
                label={`Spent ${year}`}
                value={formatPaise(data.totalSpend)}
                hint="Approved withdrawals only"
                icon={BarChart3}
                tone="negative"
              />
              <StatCard
                label="Outstanding"
                value={formatPaise(data.totalArrears)}
                hint={`${data.arrearsCount} members with unpaid monthly dues, all years`}
                tone={data.arrearsCount > 0 ? "negative" : "positive"}
              />
              <StatCard
                label="Waived"
                value={String(stats.waivedCount)}
                hint="Member-months forgiven by committee"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Collection efficiency by month</CardTitle>
                  <CardDescription>
                    Share of the monthly fund&apos;s dues that came in
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={monthly}
                        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="hsl(var(--border))"
                        />
                        <XAxis
                          dataKey="month"
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tickLine={false}
                          axisLine={false}
                          width={36}
                          tickFormatter={(v: number) => `${v}%`}
                          tick={{
                            fontSize: 11,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                        />
                        <Tooltip
                          formatter={(v: number) => [`${v}%`, "Collected"]}
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--popover-border))",
                            borderRadius: "0.5rem",
                            fontSize: "12px",
                          }}
                        />
                        <Bar
                          dataKey="rate"
                          radius={[4, 4, 0, 0]}
                          fill="hsl(var(--chart-1))"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Expenditure by category</CardTitle>
                  <CardDescription>
                    {formatPaise(data.totalSpend)} withdrawn across{" "}
                    {data.spendByCategory.length} categor
                    {data.spendByCategory.length === 1 ? "y" : "ies"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.spendByCategory.map((s) => ({
                          category: CATEGORY_LABELS[
                            s.category as TransactionCategory
                          ],
                          total: s.totalPaise / 100,
                        }))}
                        layout="vertical"
                        margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="category"
                          width={92}
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                        />
                        <Tooltip
                          formatter={(v: number) => [
                            `₹${v.toLocaleString("en-IN")}`,
                            "Spent",
                          ]}
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--popover-border))",
                            borderRadius: "0.5rem",
                            fontSize: "12px",
                          }}
                        />
                        <Bar
                          dataKey="total"
                          radius={[0, 4, 4, 0]}
                          barSize={16}
                        >
                          {data.spendByCategory.map((s, i) => (
                            <Cell
                              key={s.category}
                              fill={CHART_COLORS[i % CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {hasArrearsBasis ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Arrears ageing</CardTitle>
                  <CardDescription>
                    {formatPaise(data.totalArrears)} outstanding from{" "}
                    {data.arrearsCount} members across all years · monthly
                    fund only · aged by how long each month has been due
                  </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.totalArrears === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nothing outstanding. Every active member is paid up.
                      </p>
                    ) : (
                      <>
                        {data.aging.map((bucket, i) => (
                          <div key={bucket.key} className="space-y-1.5">
                            <div className="flex justify-between text-sm">
                              <span>
                                {bucket.label}
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {bucket.count} month
                                  {bucket.count === 1 ? "" : "s"} ·{" "}
                                  {bucket.members} member
                                  {bucket.members === 1 ? "" : "s"}
                                </span>
                              </span>
                              <span className="tabular font-medium">
                                {formatPaise(bucket.totalPaise)}
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  AGING_BAR[i % AGING_BAR.length],
                                )}
                                style={{
                                  width: `${percent(
                                    bucket.totalPaise,
                                    data.totalArrears,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}

                        <div className="border-t pt-4">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Largest outstanding
                          </p>
                          <div className="space-y-1.5">
                            {data.worst.map((m) => (
                              <div
                                key={m.memberId}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="truncate">{m.name}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {m.oldestDays > 0
                                    ? `since ${monthYear(m.oldestDueDate)}`
                                    : `${m.months}mo`}
                                  <span className="tabular ml-2 font-medium text-foreground">
                                    {formatPaise(m.totalPaise)}
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Arrears ageing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EmptyState
                      title="No monthly dues fund"
                      description="None of this organisation's funds is collected as a fixed monthly amount, so no member can be in arrears. Use fund progress below to see where the money went."
                    />
                  </CardContent>
                </Card>
              )}

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Voluntary and donation giving</CardTitle>
                  <CardDescription>
                    {unscheduledRounds.length} collection round
                    {unscheduledRounds.length === 1 ? "" : "s"} in {year} ·{" "}
                    {formatPaise(data.roundFundTotal)} collected into
                    voluntary and donation funds in {year}
                  </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {data.collectionRounds.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No collection rounds recorded for {year}.
                      </p>
                    ) : (
                      data.collectionRounds.slice(0, 6).map((round) => (
                        <div
                          key={round.id}
                          className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <CollectionModeBadge
                              mode={round.collectionMode}
                              className="shrink-0"
                            />
                            <span className="truncate">
                              {round.label ?? round.fundName}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDateShort(round.date)}
                          </span>
                        </div>
                      ))
                    )}
                    <p className="border-t pt-3 text-xs text-muted-foreground">
                      <HandHeart className="mr-1 inline size-3" />
                      Voluntary giving is never reported as arrears. A member
                      who gave nothing this month owes nothing.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Fund progress against target</CardTitle>
                    <CardDescription>Where each fund stands</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.fundProgress.map((fund) => (
                      <div key={fund.id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">
                              {fund.name}
                            </span>
                            <CollectionModeBadge
                              mode={fund.collectionMode}
                              className="shrink-0"
                            />
                          </span>
                          <span className="tabular shrink-0 text-muted-foreground">
                            {formatPaiseCompact(fund.balancePaise)}
                            {fund.targetAmountPaise
                              ? ` / ${formatPaiseCompact(fund.targetAmountPaise)}`
                              : ""}
                          </span>
                        </div>
                        {fund.targetAmountPaise ? (
                          <>
                            <Progress value={fund.progressPaise ?? 0} />
                            <p className="text-[11px] text-muted-foreground">
                              {percent(
                                fund.balancePaise,
                                fund.targetAmountPaise,
                              ).toFixed(1)}
                              % of target · {fund.type}
                            </p>
                          </>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            No target set · {fund.type}
                          </p>
                        )}
                      </div>
                    ))}
                    <p className="border-t pt-3 text-xs text-muted-foreground">
                      {stats.paidCount} member-months paid,{" "}
                      {stats.waivedCount} waived
                    </p>
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

/** `2026-03-14` → `14 Mar`. The report's own compact date form. */
function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}
