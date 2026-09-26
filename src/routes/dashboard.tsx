import { Link } from "react-router-dom"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CircleAlert,
  Scale,
  Wallet,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/shared/stat-card"
import { PageHeader } from "@/components/shared/page-header"
import {
  CollectionModeBadge,
  FundTypeBadge,
} from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useDashboard } from "@/data/queries"
import { CURRENT_MONTH } from "@/data/period"
import {
  formatPaise,
  formatPaiseCompact,
  formatDate,
  MONTHS_SHORT,
  monthLabel,
  percent,
} from "@/lib/format"

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

/**
 * Every number on this screen arrives already computed from
 * `aggregate:dashboard`. Nothing here reads a ledger entry — see
 * `convex/aggregate.ts` for why that moved server-side.
 *
 * `arrearsCount` and `arrearsTotal` count dues on `fixed_monthly` funds only, so
 * a Friday-fund member who gave nothing last month does not appear as a
 * defaulter.
 */
export default function Dashboard() {
  const model = useDashboard()
  return (
    <WithReadModel data={model} label="Loading the dashboard">
      {(data) => {
        const flowData = data.flow.map((p) => ({
          month: MONTHS_SHORT[p.month - 1],
          inflow: p.inflowPaise / 100,
          outflow: p.outflowPaise / 100,
        }))
        // A fund that has never been used has nothing to draw in a bar chart;
        // hiding it here is presentation, not aggregation.
        const breakdown = data.fundBreakdown
          .filter((f) => f.balancePaise !== 0)
          .map((f) => ({ name: f.name, value: f.balancePaise / 100 }))

        return (
          <div className="space-y-6">
            <PageHeader
              title="Dashboard"
              description={`Position as of ${formatDate(new Date())}`}
            >
              <Button asChild variant="outline" size="sm">
                <Link to="/contributions">Monthly collection grid</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/approvals">
                  Review approvals
                  {data.pending.length > 0 ? ` (${data.pending.length})` : ""}
                </Link>
              </Button>
            </PageHeader>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total across funds"
                value={formatPaise(data.totalBalance)}
                hint={`${data.fundBreakdown.length} funds with a balance · ${formatPaise(data.bankTotal)} in bank`}
                icon={Wallet}
              />
              <StatCard
                label={`Collected — ${monthLabel(CURRENT_MONTH)}`}
                value={formatPaise(data.monthStats.collectedPaise)}
                hint={`${data.monthStats.collectionRate.toFixed(0)}% of ${formatPaise(
                  data.monthStats.expectedPaise,
                )} due`}
                icon={Banknote}
                tone={data.monthStats.collectionRate >= 90 ? "positive" : "warning"}
              />
              <StatCard
                label="Inflow YTD"
                value={formatPaise(data.inflowYtd)}
                hint={`Outflow ${formatPaise(data.outflowYtd)}`}
                icon={ArrowDownLeft}
                tone="positive"
              />
              <StatCard
                label="Outstanding dues"
                value={formatPaise(data.arrearsTotal)}
                hint={`${data.arrearsCount} members · ${data.unpaidMonths} unpaid months`}
                icon={CircleAlert}
                tone={data.arrearsCount > 0 ? "negative" : "positive"}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Monthly Cash Flow</CardTitle>
                  <CardDescription>
                    Inflow: {formatPaise(data.inflowYtd)} · Outflow:{" "}
                    {formatPaise(data.outflowYtd)} · Net:{" "}
                    <span
                      className={
                        data.inflowYtd - data.outflowYtd >= 0
                          ? "text-chart-3"
                          : "text-destructive"
                      }
                    >
                      {formatPaise(data.inflowYtd - data.outflowYtd)}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={flowData}
                        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="inflowFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="hsl(var(--chart-3))"
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="95%"
                              stopColor="hsl(var(--chart-3))"
                              stopOpacity={0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="outflowFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="hsl(var(--chart-5))"
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="95%"
                              stopColor="hsl(var(--chart-5))"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
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
                          tickLine={false}
                          axisLine={false}
                          width={52}
                          tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                          tick={{
                            fontSize: 11,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `₹${value.toLocaleString("en-IN")}`,
                            name === "inflow" ? "Inflow" : "Outflow",
                          ]}
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--popover-border))",
                            borderRadius: "0.5rem",
                            fontSize: "12px",
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="inflow"
                          stroke="hsl(var(--chart-3))"
                          strokeWidth={2}
                          fill="url(#inflowFill)"
                        />
                        <Area
                          type="monotone"
                          dataKey="outflow"
                          stroke="hsl(var(--chart-5))"
                          strokeWidth={2}
                          fill="url(#outflowFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Fund Breakdown</CardTitle>
                  <CardDescription>Current balance by fund</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={breakdown}
                        layout="vertical"
                        margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={120}
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: "hsl(var(--muted-foreground))",
                          }}
                        />
                        <Tooltip
                          formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`}
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--popover-border))",
                            borderRadius: "0.5rem",
                            fontSize: "12px",
                          }}
                        />
                        <Bar
                          dataKey="value"
                          radius={[0, 4, 4, 0]}
                          barSize={14}
                          label={{
                            position: "right",
                            fontSize: 10,
                            fill: "hsl(var(--muted-foreground))",
                            formatter: (v: number) => formatPaiseCompact(v * 100),
                          }}
                        >
                          {breakdown.map((entry, i) => (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[i % CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-2.5 border-t pt-3">
                    {breakdown.map((fund) => {
                      const full = data.fundBreakdown.find(
                        (f) => f.name === fund.name,
                      )
                      return (
                        <div
                          key={fund.name}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {full ? <FundTypeBadge type={full.type} /> : null}
                            <span className="truncate">{fund.name}</span>
                          </div>
                          <span className="tabular shrink-0 font-medium">
                            {formatPaise(fund.value * 100)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Pending approvals</CardTitle>
                  <CardDescription>
                    These have not moved any balance yet
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {data.pending.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      All caught up!
                    </p>
                  ) : (
                    data.pending.map((txn) => (
                      <Link
                        key={txn.id}
                        to="/approvals"
                        className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"
                      >
                        <div
                          className={`rounded-lg p-2 ${
                            txn.isCredit
                              ? "bg-chart-3/15 text-chart-3"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {txn.isCredit ? (
                            <ArrowDownLeft className="size-4" />
                          ) : (
                            <ArrowUpRight className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {txn.description}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {txn.fundName} · {formatDate(txn.date)} ·{" "}
                            {txn.requestedByName}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tabular text-sm font-semibold">
                            {txn.isCredit ? "+" : "−"}
                            {formatPaise(txn.amountPaise)}
                          </p>
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent ledger activity</CardTitle>
                  <CardDescription>
                    Every balance on this page is the sum of these entries
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {data.recent.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 text-sm">
                      <Scale
                        className={`size-3.5 shrink-0 ${
                          entry.isCredit ? "text-chart-3" : "text-muted-foreground"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{entry.note}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.fundName} · {formatDate(entry.date)}
                        </p>
                      </div>
                      <span
                        className={`tabular shrink-0 font-medium ${
                          entry.isCredit ? "text-chart-3" : "text-destructive"
                        }`}
                      >
                        {entry.isCredit ? "+" : "−"}
                        {formatPaise(Math.abs(entry.amountPaise))}
                      </span>
                    </div>
                  ))}
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    Monthly dues collected this year:{" "}
                    {percent(
                      data.yearStats.collectedPaise,
                      data.yearStats.expectedPaise,
                    ).toFixed(1)}
                    % · {data.yearStats.paidCount} paid,{" "}
                    {data.yearStats.waivedCount} waived
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>How each fund is collected</CardTitle>
                <CardDescription>
                  Only funds collected as a fixed monthly amount can show arrears
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.fundBreakdown.map((fund) => (
                  <span
                    key={fund.id}
                    className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
                  >
                    <CollectionModeBadge mode={fund.collectionMode} />
                    <span className="truncate">{fund.name}</span>
                  </span>
                ))}
              </CardContent>
            </Card>
          </div>
        )
      }}
    </WithReadModel>
  )
}
