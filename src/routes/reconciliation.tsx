import { useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Landmark,
  Lock,
  Scale,
} from "lucide-react"
import { useMutation } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, StatCard } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { useReconciliation } from "@/data/queries"
import { useCurrentUser } from "@/data/store"
import { CURRENT_YEAR, yearsInRange } from "@/data/period"
import { formatDate, formatPaise, parseRupees } from "@/lib/format"
import { canEditBooks, isAdmin } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Reconciliation and fiscal-year close.
 *
 * The screen answers one question per account: *does the bank agree with us?* It
 * cannot be answered by comparing today's ledger balance to a statement from
 * last month, so the treasurer types in the figure printed on the statement
 * along with the date it is dated, and the server works out what the ledger
 * claimed on that date and stores the difference either way.
 *
 * A difference is not a failure. Unrecorded cash, a bank charge, a transfer in
 * flight — all of them produce one. What matters is that it was looked at, so
 * the history is kept and a difference can be closed off with a note rather than
 * deleted.
 *
 * The close panel is deliberately on the same screen as the reconciliation it
 * depends on. Closing a year asserts that it reconciles, and the server refuses
 * to close one while an account still has an unexplained difference.
 */

const today = () => new Date().toISOString().slice(0, 10)

function signed(paise: number): string {
  if (paise === 0) return formatPaise(0)
  return `${paise > 0 ? "+" : "−"}${formatPaise(Math.abs(paise))}`
}

export default function Reconciliation() {
  const me = useCurrentUser()
  const model = useReconciliation()
  const [selected, setSelected] = useState<string | null>(null)
  const [statementDate, setStatementDate] = useState(today)
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [resolveNote, setResolveNote] = useState("")
  const [closeYear, setCloseYear] = useState(String(CURRENT_YEAR - 1))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const recordStatement = useMutation(api.reconciliation.record)
  const resolveDifference = useMutation(api.reconciliation.resolve)
  const doCloseYear = useMutation(api.reconciliation.closeYear)
  const doReopenYear = useMutation(api.reconciliation.reopenYear)

  const canEdit = canEditBooks(me.role)
  const canReopen = isAdmin(me.role)

  const accounts = model?.accounts ?? []
  const activeId = selected ?? accounts[0]?.id ?? null
  const active = accounts.find((a) => a.id === activeId) ?? null

  // Years that are not yet closed and have actually happened. Offering a year
  // that is still running, or one already closed, produces an error from the
  // server on every attempt — the same lesson as the viewer role mirroring.
  const closableYears = useMemo(() => {
    const from = (model?.closedThrough ?? 0) + 1
    return yearsInRange(
      from,
      (model?.currentYear ?? CURRENT_YEAR) - 1,
    ).filter((y) => y >= from)
  }, [model?.closedThrough, model?.currentYear])

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitStatement = () =>
    run(async () => {
      if (!active) throw new Error("Choose an account first")
      const paise = parseRupees(amount)
      if (paise === null) throw new Error("Enter the balance printed on the statement")
      const result = await recordStatement({
        bankId: active.id as Id<"banks">,
        statementDate,
        statementBalancePaise: paise,
        note: note.trim() || undefined,
      })
      setAmount("")
      setNote("")
      return result.differencePaise === 0
        ? `Reconciled. The books say ${formatPaise(result.ledgerBalancePaise)}, which matches the statement.`
        : `Recorded. The books say ${formatPaise(result.ledgerBalancePaise)} — a difference of ${signed(result.differencePaise)}.`
    })

  return (
    <WithReadModel data={model} label="Loading accounts">
      {(data) => (
        <div className="space-y-6">
          <PageHeader
            title="Reconciliation"
            description="Check the books against the bank, and close the years that agree."
          />

          {/* The close state belongs above everything: it changes what may be
              written at all, so burying it under a form would be misleading. */}
          <Card
            className={cn(
              data.closedThrough === null
                ? "border-chart-4/40 bg-chart-4/5"
                : "border-border",
            )}
          >
            <CardContent className="flex flex-wrap items-center gap-4 p-4 text-sm">
              <Lock
                className={cn(
                  "size-4 shrink-0",
                  data.closedThrough === null
                    ? "text-chart-4"
                    : "text-muted-foreground",
                )}
              />
              <p className="min-w-0 flex-1">
                {data.closedThrough === null ? (
                  <>
                    No financial year has been closed. Entries dated in any year
                    may still be added or reversed.
                  </>
                ) : (
                  <>
                    Books closed through{" "}
                    <span className="font-semibold">{data.closedThrough}</span>.
                    Entries dated {data.closedThrough} or earlier are refused by
                    the ledger, and cannot be reversed.
                  </>
                )}
              </p>
              <Badge variant="secondary">
                {data.reconciledCount}/{accounts.length} accounts checked
              </Badge>
              {data.outstandingCount > 0 ? (
                <Badge
                  variant="outline"
                  className="border-destructive/50 text-destructive"
                >
                  {data.outstandingCount} unexplained
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          {error ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p>{error}</p>
              </CardContent>
            </Card>
          ) : null}
          {notice ? (
            <Card className="border-chart-3/40 bg-chart-3/5">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-chart-3" />
                <p>{notice}</p>
              </CardContent>
            </Card>
          ) : null}

          {accounts.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No bank accounts yet"
              description="Add an account before reconciling — there is nothing to compare the books against."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3">
                {accounts.map((account) => {
                  const latest = account.latest
                  // Three states, not two: a difference that has been explained
                  // is not the same as one still waiting on an explanation, and
                  // painting both red would leave the treasurer with no way to
                  // tell which account still needs them.
                  const state =
                    latest === null
                      ? "unchecked"
                      : latest.differencePaise === 0
                        ? "agrees"
                        : latest.resolvedAt != null
                          ? "explained"
                          : "unexplained"
                  return (
                    <button
                      key={account.id}
                      onClick={() => setSelected(account.id)}
                      className={cn(
                        "w-full rounded-xl border p-4 text-left transition-colors",
                        account.id === activeId
                          ? "border-primary bg-accent/40"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{account.name}</p>
                          {account.branch ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {account.branch}
                            </p>
                          ) : null}
                        </div>
                        {state === "unchecked" ? (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            never checked
                          </Badge>
                        ) : state === "agrees" ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-chart-3/50 text-[10px] text-chart-3"
                          >
                            agrees
                          </Badge>
                        ) : state === "explained" ? (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            explained
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-destructive/50 text-[10px] text-destructive"
                          >
                            differs
                          </Badge>
                        )}
                      </div>
                      <p className="tabular mt-3 text-xl font-semibold">
                        {formatPaise(account.balancePaise)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {latest === null
                          ? "No statement filed yet"
                          : `Statement of ${formatDate(latest.statementDate)}`}
                      </p>
                    </button>
                  )
                })}
              </div>

              <div className="space-y-4 lg:col-span-2">
                {active ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <StatCard
                        label="Books say"
                        value={formatPaise(active.balancePaise)}
                        hint="Ledger balance today"
                      />
                      <StatCard
                        label="Statement said"
                        value={
                          active.latest === null
                            ? "—"
                            : formatPaise(active.latest.statementBalancePaise)
                        }
                        hint={
                          active.latest === null
                            ? "Nothing filed yet"
                            : `As at ${formatDate(active.latest.statementDate)}`
                        }
                      />
                      <StatCard
                        label="Difference"
                        value={
                          active.latest === null ? "—" : signed(active.latest.differencePaise)
                        }
                        hint={
                          active.latest === null
                            ? "Compare the two figures"
                            : active.latest.resolvedAt
                              ? "Closed off"
                              : "Unresolved"
                        }
                        tone={
                          active.latest === null
                            ? "default"
                            : active.latest.differencePaise === 0
                              ? "positive"
                              : "negative"
                        }
                      />
                    </div>

                    {active.latest !== null &&
                    active.latest.differencePaise !== 0 &&
                    // `null`, not `undefined`: the read model normalises an
                    // absent `resolvedAt` to null, and testing for `undefined`
                    // left this card permanently unreachable — the one control
                    // that unblocks closing the year.
                    active.latest.resolvedAt == null ? (
                      <Card className="border-chart-4/40 bg-chart-4/5">
                        <CardContent className="space-y-3 p-4 text-sm">
                          <p>
                            The books and the bank disagree by{" "}
                            <span className="tabular font-semibold">
                              {formatPaise(Math.abs(active.latest.differencePaise))}
                            </span>{" "}
                            as at {formatDate(active.latest.statementDate)}.
                            Find out what it is and close it off — a year cannot
                            be closed while this is open.
                          </p>
                          {canEdit ? (
                            <div className="flex flex-wrap gap-2">
                              <Input
                                value={resolveNote}
                                onChange={(e) => setResolveNote(e.target.value)}
                                placeholder="Bank charges not in our books"
                                className="min-w-64 flex-1"
                              />
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await resolveDifference({
                                      reconciliationId:
                                        active.latest!.id as Id<"reconciliations">,
                                      note: resolveNote,
                                    })
                                    setResolveNote("")
                                    return "Difference closed off. It stays in the history."
                                  })
                                }
                              >
                                Close off
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              View only — a treasurer can close off a difference.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ) : null}

                    {active.movedSincePaise != null &&
                    active.movedSincePaise !== 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Since that statement the books have moved{" "}
                        <span className="tabular font-medium text-foreground">
                          {signed(active.movedSincePaise)}
                        </span>
                        . The comparison above is the one that counts; the drift
                        since is ordinary activity, not a discrepancy.
                      </p>
                    ) : null}

                    <Card>
                      <CardHeader>
                        <CardTitle>File a statement</CardTitle>
                        <CardDescription>
                          Type the balance printed on the bank&apos;s statement for{" "}
                          {active.name}, with the date it is dated. The books are
                          compared as at that date.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {canEdit ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="stmt-date">Statement date</Label>
                              <Input
                                id="stmt-date"
                                type="date"
                                max={today()}
                                value={statementDate}
                                onChange={(e) => setStatementDate(e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="stmt-amount">
                                Balance on the statement (₹)
                              </Label>
                              <Input
                                id="stmt-amount"
                                inputMode="decimal"
                                placeholder="125000"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                              <Label htmlFor="stmt-note">Note (optional)</Label>
                              <Input
                                id="stmt-note"
                                placeholder="Quarterly passbook printout"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={submitStatement}
                              >
                                <Scale className="size-4" /> Record statement
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            View only — a treasurer records statements.
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Statement history</CardTitle>
                        <CardDescription>
                          {active.history.length === 0
                            ? "Nothing filed for this account yet"
                            : active.historyCount > active.history.length
                              ? `Showing the ${active.history.length} most recent of ${active.historyCount} statements on record`
                              : `${active.history.length} statement${
                                  active.history.length === 1 ? "" : "s"
                                } on record`}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        {active.history.length === 0 ? (
                          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                            The first statement you file becomes the baseline the
                            next one is compared against.
                          </p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right">Statement</TableHead>
                                <TableHead className="text-right">Books</TableHead>
                                <TableHead className="text-right">Difference</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {active.history.map((row) => (
                                <TableRow key={row.id}>
                                  <TableCell className="whitespace-nowrap text-muted-foreground">
                                    {formatDate(row.statementDate)}
                                  </TableCell>
                                  <TableCell className="tabular text-right">
                                    {formatPaise(row.statementBalancePaise)}
                                  </TableCell>
                                  <TableCell className="tabular text-right">
                                    {formatPaise(row.ledgerBalancePaise)}
                                  </TableCell>
                                  <TableCell
                                    className={cn(
                                      "tabular text-right font-medium",
                                      row.differencePaise !== 0 &&
                                        "text-destructive",
                                    )}
                                  >
                                    {signed(row.differencePaise)}
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-xs text-muted-foreground">
                                      {row.resolvedAt
                                        ? `Closed off — ${row.note ?? "explained"}`
                                        : row.differencePaise === 0
                                          ? "Agreed"
                                          : row.note ?? "Unresolved"}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              ))}
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck2 className="size-4" />
                Close the financial year
              </CardTitle>
              <CardDescription>
                Closing locks every entry dated in that year or earlier: the
                ledger refuses new ones and refuses to reverse the old ones. The
                server also refuses while any account has an unexplained
                difference.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit ? (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="close-year">Year to close</Label>
                      <Select value={closeYear} onValueChange={setCloseYear}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {closableYears.map((y) => (
                            <SelectItem key={y} value={String(y)}>
                              {y}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || closableYears.length === 0}
                      onClick={() =>
                        run(async () => {
                          const result = await doCloseYear({ year: Number(closeYear) })
                          return `Books closed through ${result.year}. ${result.locked} entries are now locked.`
                        })
                      }
                    >
                      Close {closeYear}
                    </Button>
                    {data.closedThrough !== null && canReopen ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const result = await doReopenYear({
                              year: data.closedThrough!,
                            })
                            return `Books reopened for ${result.year}. ${result.unlocked} entries are editable again.`
                          })
                        }
                      >
                        Reopen {data.closedThrough}
                      </Button>
                    ) : null}
                  </div>
                  {closableYears.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Every completed year is already closed.
                    </p>
                  ) : null}
                  {data.closedThrough !== null && !canReopen ? (
                    <p className="text-xs text-muted-foreground">
                      Reopening a closed year is an admin action — it undoes a
                      sign-off.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  View only — a treasurer closes the books.
                </p>
              )}

              <Separator />

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  What closing does
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>
                    Every entry dated {data.closedThrough ?? "the closed year"} or
                    earlier is stamped as locked, so a reversal dated today
                    cannot quietly back one out.
                  </li>
                  <li>
                    The new entry, payment and approval paths all refuse a date
                    inside a closed year.
                  </li>
                  <li>
                    It is written to the audit log with your name against it.
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </WithReadModel>
  )
}
