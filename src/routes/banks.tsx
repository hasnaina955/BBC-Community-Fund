import { useState } from "react"
import { Building2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { EmptyState } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { CollectionModeBadge } from "@/components/shared/status-badge"
import { useBankPassbook, useBanks } from "@/data/queries"
import { CURRENT_YEAR, yearsInRange } from "@/data/period"
import { useShell } from "@/data/store"
import { formatPaise, formatDate, monthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The account balance is the materialised `balances` row for that bank, and the
 * passbook is one index-range read of the current year — the server derives the
 * opening balance from the closing balance minus the year's movements rather
 * than scanning back to 2018.
 */
export default function Banks() {
  const shell = useShell()
  const model = useBanks()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [year, setYear] = useState(CURRENT_YEAR)

  const years = yearsInRange(shell.yearRange.from, shell.yearRange.to)

  // Derived before the render prop, because the passbook query is a hook and
  // hooks cannot live inside a conditional callback.
  const needle = query.trim().toLowerCase()
  const filtered = (model ?? []).filter((b) =>
    b.name.toLowerCase().includes(needle),
  )
  const activeId = selected ?? filtered[0]?.id ?? null
  const active = filtered.find((b) => b.id === activeId) ?? null
  const passbook = useBankPassbook(activeId, year)

  return (
    <WithReadModel data={model} label="Loading accounts">
      {() => {
        return (
          <div className="space-y-6">
            <PageHeader
              title="Banks"
              description="Account balances are summed from ledger entries, not typed in by hand."
            />

            {filtered.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No accounts match"
                description="Try a different search."
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-3">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search accounts"
                  />
                  {filtered.map((bank) => (
                    <button
                      key={bank.id}
                      onClick={() => setSelected(bank.id)}
                      className={cn(
                        "w-full rounded-xl border p-4 text-left transition-colors",
                        bank.id === activeId
                          ? "border-primary bg-accent/40"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{bank.name}</p>
                          {bank.branch ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {bank.branch}
                            </p>
                          ) : null}
                        </div>
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <p
                        className={cn(
                          "tabular mt-3 text-xl font-semibold",
                          bank.balancePaise < 0 && "text-destructive",
                        )}
                      >
                        {formatPaise(bank.balancePaise)}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="space-y-4 lg:col-span-2">
                  {active ? (
                    <>
                      <Card>
                        <CardContent className="p-5">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                Account balance
                              </p>
                              <p className="tabular text-3xl font-semibold">
                                {formatPaise(active.balancePaise)}
                              </p>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {active.accountNumber ? (
                                <p className="tabular">
                                  A/C {active.accountNumber}
                                </p>
                              ) : null}
                              {active.ifscCode ? <p>{active.ifscCode}</p> : null}
                            </div>
                          </div>

                          {active.allocation.length > 0 ? (
                            <div className="mt-5 border-t pt-4">
                              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Drawn on by {active.allocation.length} fund
                                {active.allocation.length === 1 ? "" : "s"}
                              </p>
                              <div className="space-y-1.5">
                                {active.allocation.map((fund) => (
                                  <div
                                    key={fund.fundId}
                                    className="flex items-center justify-between gap-2 text-sm"
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span className="truncate text-muted-foreground">
                                        {fund.name}
                                      </span>
                                      <CollectionModeBadge
                                        mode={fund.collectionMode}
                                      />
                                    </span>
                                    <span className="tabular shrink-0 font-medium">
                                      {formatPaise(fund.balancePaise)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {active.notes ? (
                            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                              {active.notes}
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="p-0">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                            <div>
                              <p className="font-medium">Passbook</p>
                              <p className="text-xs text-muted-foreground">
                                Every entry that touched this account in {year}
                              </p>
                            </div>
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
                          </div>

                          {passbook === undefined ? (
                            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                              Loading the {year} passbook…
                            </p>
                          ) : passbook.entries.length === 0 ? (
                            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                              No entries on this account in {year}.
                            </p>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-4 border-b px-5 py-3 text-xs sm:grid-cols-4">
                                <p>
                                  <span className="block text-muted-foreground">
                                    Opening
                                  </span>
                                  <span className="tabular font-medium">
                                    {formatPaise(passbook.openingPaise)}
                                  </span>
                                </p>
                                <p>
                                  <span className="block text-muted-foreground">
                                    In
                                  </span>
                                  <span className="tabular font-medium text-chart-3">
                                    {formatPaise(passbook.totalCreditPaise)}
                                  </span>
                                </p>
                                <p>
                                  <span className="block text-muted-foreground">
                                    Out
                                  </span>
                                  <span className="tabular font-medium text-destructive">
                                    {formatPaise(passbook.totalDebitPaise)}
                                  </span>
                                </p>
                                <p>
                                  <span className="block text-muted-foreground">
                                    Closing
                                  </span>
                                  <span className="tabular font-medium">
                                    {formatPaise(passbook.closingPaise)}
                                  </span>
                                </p>
                              </div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Details</TableHead>
                                    <TableHead className="text-right">
                                      Credit
                                    </TableHead>
                                    <TableHead className="text-right">
                                      Debit
                                    </TableHead>
                                    <TableHead className="text-right">
                                      Balance
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {passbook.entries.map((entry) => (
                                    <TableRow key={entry.id}>
                                      <TableCell className="whitespace-nowrap text-muted-foreground">
                                        {formatDate(entry.date)}
                                      </TableCell>
                                      <TableCell className="max-w-72">
                                        <span className="block truncate font-medium">
                                          {entry.note}
                                        </span>
                                        <span className="text-xs capitalize text-muted-foreground">
                                          {entry.source.replace("_", " ")} ·{" "}
                                          {monthLabel(
                                            new Date(
                                              entry.date,
                                            ).getUTCMonth() + 1,
                                          )}{" "}
                                          {new Date(
                                            entry.date,
                                          ).getUTCFullYear()}
                                        </span>
                                      </TableCell>
                                      <TableCell className="tabular text-right text-chart-3">
                                        {entry.amountPaise > 0
                                          ? formatPaise(entry.amountPaise)
                                          : ""}
                                      </TableCell>
                                      <TableCell className="tabular text-right text-destructive">
                                        {entry.amountPaise < 0
                                          ? formatPaise(-entry.amountPaise)
                                          : ""}
                                      </TableCell>
                                      <TableCell className="tabular text-right font-medium">
                                        {formatPaise(entry.closingPaise)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )
      }}
    </WithReadModel>
  )
}
