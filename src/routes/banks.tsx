import { useMemo, useState } from "react"
import { Building2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { useData } from "@/data/store"
import { bankSummaries, entriesForBank, fundBalance } from "@/lib/selectors"
import { formatPaise, formatDate, monthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function Banks() {
  const data = useData()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)

  const summaries = useMemo(
    () => bankSummaries(data.ledgerEntries, data.banks),
    [data.ledgerEntries, data.banks],
  )

  const filtered = summaries.filter((bank) =>
    bank.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const activeId = selected ?? filtered[0]?.id ?? null
  const active = filtered.find((b) => b.id === activeId)
  const entries = useMemo(
    () => (activeId ? entriesForBank(data.ledgerEntries, activeId) : []),
    [data.ledgerEntries, activeId],
  )

  // How much of this account belongs to each fund drawing on it.
  const allocation = useMemo(() => {
    if (!activeId) return []
    return data.funds
      .filter((f) => f.bankId === activeId)
      .map((fund) => ({
        fund,
        balancePaise: fundBalance(data.ledgerEntries, fund.id),
      }))
  }, [data.funds, data.ledgerEntries, activeId])

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
            {filtered.map((bank) => {
              const isActive = bank.id === activeId
              return (
                <button
                  key={bank.id}
                  onClick={() => setSelected(bank.id)}
                  className={cn(
                    "w-full rounded-xl border p-4 text-left transition-colors",
                    isActive
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
              )
            })}
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

                    {allocation.length > 0 ? (
                      <div className="mt-5 border-t pt-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Drawn on by {allocation.length} fund
                          {allocation.length === 1 ? "" : "s"}
                        </p>
                        <div className="space-y-1.5">
                          {allocation.map(({ fund, balancePaise }) => (
                            <div
                              key={fund.id}
                              className="flex justify-between text-sm"
                            >
                              <span className="truncate text-muted-foreground">
                                {fund.name}
                              </span>
                              <span className="tabular font-medium">
                                {formatPaise(balancePaise)}
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
                    <div className="border-b px-5 py-4">
                      <p className="font-medium">Passbook</p>
                      <p className="text-xs text-muted-foreground">
                        Every entry that touched this account, most recent first
                      </p>
                    </div>
                    {entries.length === 0 ? (
                      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                        No entries on this account yet.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead className="text-right">Credit</TableHead>
                            <TableHead className="text-right">Debit</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entries.slice(0, 40).map((entry) => {
                            const credit = entry.amountPaise >= 0
                            return (
                              <TableRow key={entry.id}>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {formatDate(entry.effectiveDate)}
                                </TableCell>
                                <TableCell className="max-w-72">
                                  <span className="block truncate font-medium">
                                    {entry.note ?? entry.source}
                                  </span>
                                  <span className="text-xs capitalize text-muted-foreground">
                                    {entry.source.replace("_", " ")} ·{" "}
                                    {monthLabel(
                                      new Date(entry.effectiveDate).getUTCMonth() + 1,
                                    )}{" "}
                                    {new Date(entry.effectiveDate).getUTCFullYear()}
                                  </span>
                                </TableCell>
                                <TableCell className="tabular text-right text-chart-3">
                                  {credit ? formatPaise(entry.amountPaise) : ""}
                                </TableCell>
                                <TableCell className="tabular text-right text-destructive">
                                  {!credit ? formatPaise(-entry.amountPaise) : ""}
                                </TableCell>
                                <TableCell className="tabular text-right font-medium">
                                  {formatPaise(
                                    entries
                                      .slice(0, entries.indexOf(entry) + 1)
                                      .reduce((acc, e) => acc + e.amountPaise, 0),
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
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
}
