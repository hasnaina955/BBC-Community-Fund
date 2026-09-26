import { useMemo, useState } from "react"
import { Banknote, Check, HandCoins, Search, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { useActions, useData } from "@/data/store"
import { collectionStats, contributionGrid } from "@/lib/selectors"
import { CURRENT_YEAR, GRID_YEARS, MONTHS_ELAPSED, TODAY } from "@/data/period"
import { formatPaise, MONTHS_SHORT, percent } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The year x month collection grid — the screen the treasurer actually lives
 * in on the night of the monthly meeting. Clicking a cell cycles its status.
 */

const MONTH_YEARS = GRID_YEARS

export default function Contributions() {
  const data = useData()
  const { setContributionStatus } = useActions()
  const [year, setYear] = useState(CURRENT_YEAR)
  const [query, setQuery] = useState("")
  const [fundOnly, setFundOnly] = useState(false)

  const contributionFund = data.funds.find((f) => f.isMemberContribution)

  const members = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const base = data.members.filter((m) => m.isActive)
    if (!needle) return base
    return base.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.phone ?? "").includes(needle),
    )
  }, [data.members, query])

  const grid = useMemo(
    () => contributionGrid(data.contributions, members, year),
    [data.contributions, members, year],
  )

  const stats = collectionStats(data.contributions, year, undefined)
  const elapsedStats = collectionStats(
    data.contributions,
    year,
    MONTHS_ELAPSED,
  )

  const fundFiltered = fundOnly && contributionFund
    ? data.contributions.filter(
        (c) => c.fundId === contributionFund.id,
      )
    : data.contributions

  const visibleFundStats = collectionStats(fundFiltered, year, undefined)

  // Only months up to the current one are collectable in this year.
  const collectableMonths =
    year === CURRENT_YEAR ? MONTHS_ELAPSED : 12

  const cycle = (id: string, current: string) => {
    const order = ["due", "paid", "waived"] as const
    const index = order.indexOf(current as (typeof order)[number])
    const next = order[(index + 1) % order.length]
    setContributionStatus(
      id,
      next,
      next === "waived" ? "Approved by committee — hardship" : undefined,
    )
  }

  const markMonthPaid = (month: number) => {
    for (const row of grid) {
      const cell = row.cells[month - 1]
      if (cell && cell.status === "due") {
        setContributionStatus(cell.id, "paid")
      }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly Collection Grid"
        description={`${contributionFund?.name ?? "Member contributions"} · click a cell to change its status`}
      >
        <div className="flex rounded-lg border p-0.5">
          {MONTH_YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                year === y
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {y}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFundOnly((f) => !f)}
          disabled={!contributionFund}
        >
          {fundOnly ? "Showing all" : "Contribution fund only"}
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Collected ${year}`}
          value={formatPaise(stats.collectedPaise)}
          hint={`of ${formatPaise(stats.expectedPaise)} expected`}
          icon={Banknote}
          tone={stats.collectionRate >= 90 ? "positive" : "warning"}
        />
        <StatCard
          label="Collection rate"
          value={`${stats.collectionRate.toFixed(1)}%`}
          hint={`${stats.paidCount} paid · ${stats.waivedCount} waived`}
          icon={HandCoins}
        />
        <StatCard
          label="Still unpaid"
          value={formatPaise(stats.expectedPaise - stats.collectedPaise)}
          hint={`${stats.dueCount} member-months`}
          tone={stats.dueCount > 0 ? "negative" : "positive"}
        />
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {MONTHS_SHORT[MONTHS_ELAPSED - 1]} {year} to date
            </p>
            <p className="tabular mt-1 text-2xl font-semibold">
              {elapsedStats.collectionRate.toFixed(0)}%
            </p>
            <Progress value={elapsedStats.collectionRate} className="mt-3" />
            <p className="mt-2 text-xs text-muted-foreground">
              {visibleFundStats.paidCount} of {visibleFundStats.totalCount}{" "}
              contributions settled
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a member"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="success">
                <Check className="size-3" /> Paid
              </Badge>
              <Badge variant="destructive">
                <X className="size-3" /> Unpaid
              </Badge>
              <Badge variant="info">Waived</Badge>
              <span>·</span>
              <span>{grid.length} active members</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-card">Member</TableHead>
                  {MONTHS_SHORT.map((label, i) => {
                    const month = i + 1
                    const isFuture =
                      year === CURRENT_YEAR && month > collectableMonths
                    const isCurrent =
                      year === CURRENT_YEAR && month === TODAY.getMonth() + 1
                    const monthStats = collectionStats(
                      data.contributions,
                      year,
                      month,
                    )
                    return (
                      <TableHead
                        key={label}
                        className={cn(
                          "text-center",
                          isFuture && "opacity-40",
                          isCurrent && "text-primary",
                        )}
                      >
                        <span className="block">{label}</span>
                        <span className="tabular block text-[10px] font-normal normal-case text-muted-foreground">
                          {percent(
                            monthStats.collectedPaise,
                            monthStats.expectedPaise,
                          ).toFixed(0)}
                          %
                        </span>
                      </TableHead>
                    )
                  })}
                  <TableHead className="text-right">Year total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grid.map(({ member, cells }) => {
                  const paid = cells.filter(
                    (c) => c?.status === "paid" || c?.status === "partial",
                  ).length
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="sticky left-0 z-10 bg-card">
                        <span className="block max-w-40 truncate font-medium">
                          {member.name}
                        </span>
                        <span className="tabular text-[11px] text-muted-foreground">
                          {paid} paid
                        </span>
                      </TableCell>

                      {cells.map((cell, i) => {
                        const month = i + 1
                        const isFuture =
                          year === CURRENT_YEAR && month > collectableMonths
                        const status = cell?.status
                        return (
                          <TableCell key={month} className="p-1 text-center">
                            {isFuture ? (
                              <span className="text-muted-foreground/25">—</span>
                            ) : cell ? (
                              <button
                                onClick={() => cycle(cell.id, cell.status)}
                                title={`${member.name} · ${MONTHS_SHORT[month - 1]} ${year} · ${status} · ${formatPaise(cell.amountPaise)}`}
                                className={cn(
                                  "tabular w-full rounded-md px-2 py-1.5 text-[11px] font-medium transition-all hover:scale-105",
                                  status === "paid" &&
                                    "bg-chart-3/15 text-chart-3 hover:bg-chart-3/25",
                                  status === "due" &&
                                    "bg-destructive/10 text-destructive hover:bg-destructive/20",
                                  status === "waived" &&
                                    "bg-chart-2/15 text-chart-2 hover:bg-chart-2/25",
                                  status === "partial" &&
                                    "bg-chart-4/15 text-chart-4 hover:bg-chart-4/25",
                                )}
                              >
                                {formatPaise(cell.amountPaise)}
                              </button>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </TableCell>
                        )
                      })}

                      <TableCell className="tabular text-right text-xs font-medium">
                        {formatPaise(
                          cells.reduce(
                            (acc, c) =>
                              acc +
                              (c &&
                              (c.status === "paid" || c.status === "partial")
                                ? c.amountPaise
                                : 0),
                            0,
                          ),
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Statuses are held in memory for milestone M0. They reset on
              reload — milestone M1 puts Convex behind this.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => markMonthPaid(TODAY.getMonth() + 1)}
            >
              <Check className="size-4" /> Mark this month paid for everyone
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
