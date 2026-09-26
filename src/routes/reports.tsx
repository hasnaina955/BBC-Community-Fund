import { useMemo } from "react"
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
import { BarChart3, Download, TrendingUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { useData } from "@/data/store"
import {
  collectionStats,
  defaulters,
  fundSummaries,
  spendByCategory,
} from "@/lib/selectors"
import { CURRENT_YEAR, MONTHS_ELAPSED } from "@/data/period"
import {
  formatPaise,
  formatPaiseCompact,
  MONTHS_SHORT,
  monthLabel,
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

export default function Reports() {
  const data = useData()

  const yearStats = collectionStats(data.contributions, CURRENT_YEAR)
  const funds = fundSummaries(data.ledgerEntries, data.funds)
  const spend = useMemo(
    () => spendByCategory(data.ledgerEntries),
    [data.ledgerEntries],
  )
  const arrears = useMemo(
    () => defaulters(data.contributions, data.members, CURRENT_YEAR, MONTHS_ELAPSED),
    [data.contributions, data.members],
  )

  const totalSpend = spend.reduce((acc, s) => acc + s.totalPaise, 0)
  const arrearsTotal = arrears.reduce((acc, d) => acc + d.outstandingPaise, 0)

  const monthly = Array.from({ length: MONTHS_ELAPSED }, (_, i) => {
    const month = i + 1
    const s = collectionStats(data.contributions, CURRENT_YEAR, month)
    return {
      month: MONTHS_SHORT[month - 1],
      rate: Number(s.collectionRate.toFixed(1)),
      collected: s.collectedPaise / 100,
      due: (s.expectedPaise - s.collectedPaise) / 100,
    }
  })

  // Bucket arrears by how many months are outstanding.
  const buckets = [
    { label: "1 month", min: 1, max: 1 },
    { label: "2 months", min: 2, max: 2 },
    { label: "3+ months", min: 3, max: 12 },
  ].map((b) => {
    const matching = arrears.filter(
      (a) => a.months.length >= b.min && a.months.length <= b.max,
    )
    return {
      ...b,
      count: matching.length,
      totalPaise: matching.reduce((acc, a) => acc + a.outstandingPaise, 0),
    }
  })

  const worst = arrears.slice(0, 5)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Financial position for ${CURRENT_YEAR}`}
      >
        <Button variant="outline" size="sm" disabled title="Available in milestone M7">
          <Download className="size-4" /> Export
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected this year"
          value={formatPaise(yearStats.collectedPaise)}
          hint={`${yearStats.collectionRate.toFixed(1)}% of ${formatPaise(yearStats.expectedPaise)}`}
          icon={TrendingUp}
          tone="positive"
        />
        <StatCard
          label="Spent this year"
          value={formatPaise(totalSpend)}
          hint="Approved withdrawals only"
          icon={BarChart3}
          tone="negative"
        />
        <StatCard
          label="Outstanding"
          value={formatPaise(arrearsTotal)}
          hint={`${arrears.length} members in arrears`}
          tone="negative"
        />
        <StatCard
          label="Waived"
          value={String(yearStats.waivedCount)}
          hint={`${formatPaise(
            yearStats.waivedCount * 50000,
          )} forgiven by committee`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Collection efficiency by month</CardTitle>
            <CardDescription>
              Share of the month&apos;s dues that came in
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
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
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-1))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenditure by category</CardTitle>
            <CardDescription>
              {formatPaise(totalSpend)} withdrawn across{" "}
              {spend.length} categor{spend.length === 1 ? "y" : "ies"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={spend.map((s) => ({
                    category: CATEGORY_LABELS[s.category as TransactionCategory],
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
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
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
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={16}>
                    {spend.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Arrears aging</CardTitle>
            <CardDescription>
              {formatPaise(arrearsTotal)} outstanding from {arrears.length} members
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {arrears.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing outstanding. Every active member is paid up.
              </p>
            ) : (
              <>
                {buckets.map((bucket) => (
                  <div key={bucket.label} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span>
                        {bucket.label} behind
                        <span className="ml-2 text-xs text-muted-foreground">
                          {bucket.count} member{bucket.count === 1 ? "" : "s"}
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
                          bucket.min === 1
                            ? "bg-chart-4"
                            : bucket.min === 2
                              ? "bg-chart-5"
                              : "bg-destructive",
                        )}
                        style={{
                          width: `${percent(bucket.totalPaise, arrearsTotal)}%`,
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
                    {worst.map((d) => (
                      <div
                        key={d.member.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{d.member.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {d.months.length}mo
                          <span className="tabular ml-2 font-medium text-foreground">
                            {formatPaise(d.outstandingPaise)}
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

        <Card>
          <CardHeader>
            <CardTitle>Fund progress against target</CardTitle>
            <CardDescription>Where each fund stands</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {funds.map((fund) => (
              <div key={fund.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{fund.name}</span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    {formatPaiseCompact(fund.balancePaise)}
                    {fund.targetPaise
                      ? ` / ${formatPaiseCompact(fund.targetPaise)}`
                      : ""}
                  </span>
                </div>
                {fund.targetPaise ? (
                  <>
                    <Progress value={fund.progressPaise ?? 0} />
                    <p className="text-[11px] text-muted-foreground">
                      {percent(fund.balancePaise, fund.targetPaise).toFixed(1)}%
                      of target · {fund.type}
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
              Month of record: {monthLabel(MONTHS_ELAPSED)} {CURRENT_YEAR} ·{" "}
              {yearStats.paidCount} paid, {yearStats.waivedCount} waived
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
