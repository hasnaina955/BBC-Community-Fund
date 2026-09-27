import { useState } from "react"
import { Link } from "react-router-dom"
import { Banknote, Check, HandCoins, Search, X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { CollectionModeBadge } from "@/components/shared/status-badge"
import { useActions, useCurrentUser, useShell } from "@/data/store"
import { useCollectionGrid, useFunds } from "@/data/queries"
import { CURRENT_YEAR, TODAY, yearsInRange } from "@/data/period"
import { formatPaise, MONTHS_SHORT, percent } from "@/lib/format"
import { canEditBooks } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The year × month collection grid — the screen the treasurer actually lives in
 * on the night of the monthly meeting. Clicking a cell cycles its status.
 *
 * The whole pivot, including the per-month collection rates in the header, is
 * computed by `aggregate:grid`. At 84 members × 12 months that is 1,008 cells
 * per year; with eight years of history the client no longer receives the dues
 * rows to draw them.
 *
 * **This screen only exists for `fixed_monthly` funds.** The server refuses to
 * build a grid for anything else and explains why, which is what stops the
 * Friday fund from acquiring a column of red "unpaid" cells that mean nothing.
 */
export default function Contributions() {
  const { setContributionStatus } = useActions()
  const me = useCurrentUser()
  const shell = useShell()
  const fundsModel = useFunds()
  const [year, setYear] = useState(CURRENT_YEAR)
  const [fundId, setFundId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const model = useCollectionGrid(year, fundId)
  const years = yearsInRange(shell.yearRange.from, shell.yearRange.to)
  // Only funds that can actually have dues are offered; a voluntary fund in
  // this list would just produce the "not applicable" message every time.
  const dueFunds = (fundsModel ?? []).filter(
    (f) => f.collectionMode === "fixed_monthly",
  )

  // A viewer may look at the grid all day; what they may not do is change it.
  // The server refuses the write either way — this stops the UI from offering
  // a control that could only ever fail.
  const canEdit = canEditBooks(me.role)

  const cycle = async (id: string, current: string) => {
    const order = ["due", "paid", "waived"] as const
    const index = order.indexOf(current as (typeof order)[number])
    const next = order[(index + 1) % order.length]
    setError(null)
    try {
      await setContributionStatus(
        id,
        next,
        next === "waived" ? "Approved by committee — hardship" : undefined,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That change could not be saved.",
      )
    }
  }

  return (
    <WithReadModel data={model} label={`Loading the ${year} grid`}>
      {(grid) => {
        if (grid === null) {
          return (
            <div className="space-y-6">
              <PageHeader title="Monthly Collection Grid" />
              <EmptyState
                icon={X}
                title="No fund to show a grid for"
                description="Create a fund collected as a fixed monthly amount first."
              />
            </div>
          )
        }
        if (!grid.applicable) {
          return (
            <div className="space-y-6">
              <PageHeader title="Monthly Collection Grid" />
              <EmptyState
                icon={X}
                title="No grid for this fund"
                description={grid.reason ?? undefined}
                action={
                  <Button asChild size="sm">
                    <Link to="/funds">Choose a different fund</Link>
                  </Button>
                }
              />
            </div>
          )
        }

        const needle = query.trim().toLowerCase()
        const rows = grid.rows.filter(
          (r) =>
            !needle ||
            r.name.toLowerCase().includes(needle) ||
            String(r.joinedYear).includes(needle),
        )
        const stats = grid.yearStats

        return (
          <div className="space-y-6">
            <PageHeader
              title="Monthly Collection Grid"
              description={
                canEdit
                  ? `${grid.fundName} · click a cell to change its status`
                  : `${grid.fundName} · view only`
              }
            >
              <Select
                value={fundId ?? "auto"}
                onValueChange={(v) => setFundId(v === "auto" ? null : v)}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Default monthly fund
                  </SelectItem>
                  {dueFunds.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

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
                    {MONTHS_SHORT[grid.collectableMonths - 1]} {year} to date
                  </p>
                  <p className="tabular mt-1 text-2xl font-semibold">
                    {grid.rows.length} active members
                  </p>
                  <Progress
                    value={stats.collectionRate}
                    className="mt-3"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatPaise(grid.monthlyAmountPaise)} due per member per
                    month
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
                    <span>{rows.length} members</span>
                    {canEdit ? (
                      <span>· click a cell to change its status</span>
                    ) : (
                      <span>· view only</span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 z-10 bg-card">
                          Member
                        </TableHead>
                        {MONTHS_SHORT.map((label, i) => {
                          const month = i + 1
                          const isFuture =
                            year === CURRENT_YEAR &&
                            month > grid.collectableMonths
                          const isCurrent =
                            year === CURRENT_YEAR && month === TODAY.getMonth() + 1
                          const bucket = grid.monthTotals[month - 1]
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
                                  bucket.collectedPaise,
                                  bucket.expectedPaise,
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
                      {rows.map((row) => (
                        <TableRow key={row.memberId}>
                          <TableCell className="sticky left-0 z-10 bg-card">
                            <span className="block max-w-40 truncate font-medium">
                              {row.name}
                            </span>
                            <span className="tabular text-[11px] text-muted-foreground">
                              {row.paidCount} paid
                            </span>
                          </TableCell>

                          {row.cells.map((cell, i) => {
                            const month = i + 1
                            const isFuture =
                              year === CURRENT_YEAR &&
                              month > grid.collectableMonths
                            const status = cell?.status
                            return (
                              <TableCell
                                key={month}
                                className="p-1 text-center"
                              >
                            {isFuture ? (
                              <span className="text-muted-foreground/25">
                                —
                              </span>
                            ) : cell ? (
                              canEdit ? (
                                <button
                                  onClick={() =>
                                    void cycle(cell.contributionId, cell.status)
                                  }
                                  title={`${row.name} · ${
                                    MONTHS_SHORT[month - 1]
                                  } ${year} · ${status} · ${formatPaise(
                                    cell.amountPaise,
                                  )}`}
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
                                <span
                                  title={`${row.name} · ${
                                    MONTHS_SHORT[month - 1]
                                  } ${year} · ${status} · ${formatPaise(
                                    cell.amountPaise,
                                  )}`}
                                  className={cn(
                                    "tabular block rounded-md px-2 py-1.5 text-[11px] font-medium",
                                    status === "paid" && "bg-chart-3/15 text-chart-3",
                                    status === "due" &&
                                      "bg-destructive/10 text-destructive",
                                    status === "waived" &&
                                      "bg-chart-2/15 text-chart-2",
                                    status === "partial" &&
                                      "bg-chart-4/15 text-chart-4",
                                  )}
                                >
                                  {formatPaise(cell.amountPaise)}
                                </span>
                              )
                            ) : (
                                  <span className="text-muted-foreground/30">
                                    —
                                  </span>
                                )}
                              </TableCell>
                            )
                          })}

                          <TableCell className="tabular text-right text-xs font-medium">
                            {formatPaise(row.paidPaise)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No members match “{query}”.
                  </p>
                ) : null}

                {error ? (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CollectionModeBadge mode={grid.collectionMode} />
                  Why this fund has a grid
                </CardTitle>
                <CardDescription>
                  A grid appears only for a{" "}
                  <strong>fixed_monthly</strong> fund — one where every active
                  member owes a set amount each month. The Friday collection and
                  the reconstruction project are tracked by rounds and pledges
                  instead, so nobody is ever shown as owing them.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )
      }}
    </WithReadModel>
  )
}
