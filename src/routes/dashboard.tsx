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
  CheckCheck,
  CircleAlert,
  Scale,
  Wallet,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/shared/stat-card"
import { Meter, rateTone } from "@/components/shared/meter"
import { PageHeader } from "@/components/shared/page-header"
import { FundTypeBadge, CollectionModeBadge } from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useDashboard } from "@/data/queries"
import { CURRENT_MONTH, CURRENT_YEAR } from "@/data/period"
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
 * The chart tooltip's own styling, written once.
 *
 * It was inline in four places and had already drifted — two of them were
 * missing the `border` key entirely, so those tooltips rendered with no border
 * at all against a card background. A tooltip is a floating surface over
 * content, so it has to use the popover tokens rather than the card's.
 */
const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--popover-border))",
  borderRadius: "0.5rem",
  boxShadow: "var(--shadow-md)",
  fontSize: "12px",
} as const

const AXIS_TICK = {
  fontSize: 11,
  fill: "hsl(var(--muted-foreground))",
} as const

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

        const rate = data.monthStats.collectionRate
        const tone = rateTone(rate)

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

            {/*
              The headline.

              Four equal stat tiles gave the collection rate the same visual
              weight as three figures nobody opens the app to read, and the rate
              is the one number the treasurer came for — it is what the monthly
              meeting is about. So it gets the first, widest card on the page,
              with the money behind it spelled out, because "82%" on its own is
              not a fact anybody can act on.
            */}
            <Card className="overflow-hidden">
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="cf-eyebrow">
                      Collection · {monthLabel(CURRENT_MONTH)} {CURRENT_YEAR}
                    </p>
                    <p className="tabular mt-1.5 text-4xl font-semibold tracking-tight">
                      {rate.toFixed(0)}
                      <span className="text-2xl text-muted-foreground">%</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-sm font-medium">
                      {formatPaise(data.monthStats.collectedPaise)}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      of {formatPaise(data.monthStats.expectedPaise)} due
                    </p>
                  </div>
                </div>

                <Meter
                  value={data.monthStats.collectedPaise}
                  max={data.monthStats.expectedPaise}
                  tone={tone}
                  className="mt-4 h-2.5"
                />

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {data.monthStats.paidCount} paid ·{" "}
                    {data.monthStats.waivedCount} waived
                  </span>
                  {data.monthStats.dueCount > 0 ? (
                    <span className="font-medium text-destructive">
                      {data.monthStats.dueCount} still to collect this month
                    </span>
                  ) : (
                    <span className="font-medium text-success">
                      Everyone has paid for {monthLabel(CURRENT_MONTH)}
                    </span>
                  )}
                  {data.arrearsCount > 0 ? (
                    <span>
                      {data.arrearsCount} members in arrears ·{" "}
                      {data.unpaidMonths} unpaid months
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>

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
                hint={`${rate.toFixed(0)}% of ${formatPaise(
                  data.monthStats.expectedPaise,
                )} due`}
                icon={Banknote}
                tone={rate >= 90 ? "positive" : "warning"}
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
                              stopOpacity={0.3}
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
                              stopOpacity={0.3}
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
                          tick={AXIS_TICK}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={52}
                          tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                          tick={AXIS_TICK}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `₹${value.toLocaleString("en-IN")}`,
                            name === "inflow" ? "Inflow" : "Outflow",
                          ]}
                          contentStyle={TOOLTIP_STYLE}
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

              {/*
                The fund list carries each fund's collection mode inline now.
                It used to also have a card at the bottom of the page listing
                every fund's mode again — the same names twice, in two
                different visual treatments, with a paragraph explaining that
                only monthly funds can show arrears. That explanation belongs
                with the number it qualifies, and it is on the grid screen.
              */}
              <Card>
                <CardHeader>
                  <CardTitle>Fund Breakdown</CardTitle>
                  <CardDescription>
                    Current balance by fund, and how each is collected
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {breakdown.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No fund has a balance yet.
                    </p>
                  ) : (
                    <>
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
                              tick={AXIS_TICK}
                            />
                            <Tooltip
                              formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`}
                              contentStyle={TOOLTIP_STYLE}
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

                      <ul className="space-y-1 border-t pt-3">
                        {data.fundBreakdown.map((fund) => (
                          <li
                            key={fund.id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <FundTypeBadge type={fund.type} />
                              <CollectionModeBadge mode={fund.collectionMode} />
                              <span className="truncate">{fund.name}</span>
                            </div>
                            <span className="tabular shrink-0 font-medium">
                              {formatPaise(fund.balancePaise)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
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
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <CheckCheck className="size-6 text-success" />
                      <p className="text-sm text-muted-foreground">
                        Nothing waiting. Every transaction has been decided.
                      </p>
                    </div>
                  ) : (
                    data.pending.map((txn) => (
                      <Link
                        key={txn.id}
                        to="/approvals"
                        className="cf-lift flex items-center gap-3 rounded-lg border p-3"
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
                  {data.recent.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No entries have been written yet.
                    </p>
                  ) : (
                    data.recent.map((entry) => (
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
                    ))
                  )}
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
          </div>
        )
      }}
    </WithReadModel>
  )
}
