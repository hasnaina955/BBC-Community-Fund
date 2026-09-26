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
import { FundTypeBadge, TransactionStatusBadge } from "@/components/shared/status-badge"
import { useData } from "@/data/store"
import {
  bankSummaries,
  collectionStats,
  defaulters,
  fundSummaries,
  monthlyFlow,
} from "@/lib/selectors"
import { CURRENT_MONTH, CURRENT_YEAR, MONTHS_ELAPSED } from "@/data/period"
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

export default function Dashboard() {
  const data = useData()

  const funds = fundSummaries(data.ledgerEntries, data.funds)
  const banks = bankSummaries(data.ledgerEntries, data.banks)
  const monthStats = collectionStats(data.contributions, CURRENT_YEAR, CURRENT_MONTH)
  const yearStats = collectionStats(data.contributions, CURRENT_YEAR, MONTHS_ELAPSED)
  const arrears = defaulters(
    data.contributions,
    data.members,
    CURRENT_YEAR,
    MONTHS_ELAPSED,
  )
  const flow = monthlyFlow(data.ledgerEntries, CURRENT_YEAR)

  const totalBalance = funds.reduce((acc, f) => acc + f.balancePaise, 0)
  const totalInflow = flow.reduce((acc, p) => acc + p.inflowPaise, 0)
  const totalOutflow = flow.reduce((acc, p) => acc + p.outflowPaise, 0)
  const arrearsTotal = arrears.reduce((acc, d) => acc + d.outstandingPaise, 0)

  const pending = data.transactions
    .filter((t) => t.status === "pending")
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))

  const recent = [...data.ledgerEntries]
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .slice(0, 7)

  const flowData = flow.slice(0, MONTHS_ELAPSED).map((p) => ({
    month: MONTHS_SHORT[p.month - 1],
    inflow: p.inflowPaise / 100,
    outflow: p.outflowPaise / 100,
  }))

  const breakdown = funds
    .filter((f) => f.balancePaise !== 0)
    .map((f) => ({ name: f.name, value: f.balancePaise / 100, type: f.type }))

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
            {pending.length > 0 ? ` (${pending.length})` : ""}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total across funds"
          value={formatPaise(totalBalance)}
          hint={`${funds.length} active funds · ${banks.length} accounts`}
          icon={Wallet}
        />
        <StatCard
          label={`Collected — ${monthLabel(CURRENT_MONTH)}`}
          value={formatPaise(monthStats.collectedPaise)}
          hint={`${monthStats.collectionRate.toFixed(0)}% of ${formatPaise(
            monthStats.expectedPaise,
          )} due`}
          icon={Banknote}
          tone={monthStats.collectionRate >= 90 ? "positive" : "warning"}
        />
        <StatCard
          label="Inflow YTD"
          value={formatPaise(totalInflow)}
          hint={`Outflow ${formatPaise(totalOutflow)}`}
          icon={ArrowDownLeft}
          tone="positive"
        />
        <StatCard
          label="Outstanding arrears"
          value={formatPaise(arrearsTotal)}
          hint={`${arrears.length} members · ${yearStats.dueCount} unpaid months`}
          icon={CircleAlert}
          tone={arrears.length > 0 ? "negative" : "positive"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Cash Flow</CardTitle>
            <CardDescription>
              Inflow: {formatPaise(totalInflow)} · Outflow:{" "}
              {formatPaise(totalOutflow)} · Net:{" "}
              <span
                className={
                  totalInflow - totalOutflow >= 0
                    ? "text-chart-3"
                    : "text-destructive"
                }
              >
                {formatPaise(totalInflow - totalOutflow)}
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
                    <linearGradient id="inflowFill" x1="0" y1="0" x2="0" y2="1">
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
                    <linearGradient id="outflowFill" x1="0" y1="0" x2="0" y2="1">
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
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
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
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
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
              {funds.slice(0, 4).map((fund) => (
                <div
                  key={fund.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FundTypeBadge type={fund.type} />
                    <span className="truncate">{fund.name}</span>
                  </div>
                  <span className="tabular shrink-0 font-medium">
                    {formatPaise(fund.balancePaise)}
                  </span>
                </div>
              ))}
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
            {pending.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                All caught up!
              </p>
            ) : (
              pending.slice(0, 4).map((txn) => {
                const fund = funds.find((f) => f.id === txn.fundId)
                const isCredit = txn.type === "deposit" || txn.type === "transfer_in"
                return (
                  <Link
                    key={txn.id}
                    to="/approvals"
                    className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"
                  >
                    <div
                      className={`rounded-lg p-2 ${
                        isCredit
                          ? "bg-chart-3/15 text-chart-3"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {isCredit ? (
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
                        {fund?.name} · {formatDate(txn.transactionDate)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold">
                        {isCredit ? "+" : "−"}
                        {formatPaise(txn.amountPaise)}
                      </p>
                      <TransactionStatusBadge status={txn.status} />
                    </div>
                  </Link>
                )
              })
            )}
            {pending.length > 4 ? (
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link to="/approvals">View all {pending.length}</Link>
              </Button>
            ) : null}
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
            {recent.map((entry) => {
              const fund = funds.find((f) => f.id === entry.fundId)
              const credit = entry.amountPaise >= 0
              return (
                <div key={entry.id} className="flex items-center gap-3 text-sm">
                  <Scale
                    className={`size-3.5 shrink-0 ${
                      credit ? "text-chart-3" : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{entry.note ?? entry.source}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fund?.name ?? "Unassigned"} · {formatDate(entry.effectiveDate)}
                    </p>
                  </div>
                  <span
                    className={`tabular shrink-0 font-medium ${
                      credit ? "text-chart-3" : "text-destructive"
                    }`}
                  >
                    {credit ? "+" : "−"}
                    {formatPaise(Math.abs(entry.amountPaise))}
                  </span>
                </div>
              )
            })}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Collection rate this year:{" "}
              {percent(
                yearStats.collectedPaise,
                yearStats.expectedPaise,
              ).toFixed(1)}
              % · {yearStats.paidCount} paid, {yearStats.waivedCount} waived
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
