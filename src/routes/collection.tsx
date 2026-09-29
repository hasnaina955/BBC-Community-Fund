import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  HandCoins,
  Plus,
  Receipt,
  Search,
  WifiOff,
} from "lucide-react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatCard } from "@/components/shared/stat-card"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { CollectionModeBadge } from "@/components/shared/status-badge"
import { useDashboard } from "@/data/queries"
import { formatPaise, formatDate, rupeesToPaise } from "@/lib/format"

/**
 * The collection desk.
 *
 * This screen is the whole of what M4a delivers in the console, and it is worth
 * being clear about what it is: **a dated session of cash at a meeting, with a
 * running total and a receipt book, that needs no signal and no gateway.**
 *
 * That is not a consolation prize for the deferred online work. Roughly half of
 * this community's collection is money handed over in a room, and until now a
 * treasurer recording that money had nowhere to put it: the grid is for
 * member-by-month dues, and a Friday sarkar collection is neither. So it went
 * into the ledger with a receipt number and no session, which means there was no
 * way to answer the only question anyone asks at the end of a collection — "how
 * much did we take, and from how many people?"
 *
 * Every rupee recorded here goes through `lib/collection.recordPaymentFor`, the
 * same function the grid and the member portal use. The screen adds a grouping
 * and a total; it does not add an accounting path.
 */

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  upi: "UPI",
  card: "Card",
  transfer: "Transfer",
}

const today = () => new Date().toISOString().slice(0, 10)

export default function Collection() {
  const rounds = useQuery(api.collections.rounds, {})
  const dashboard = useDashboard()

  const [selected, setSelected] = useState<Id<"collectionRounds"> | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collection"
        description="A dated session of giving — cash at a meeting, or anything collected away from the grid"
      />

      {/*
        Stated rather than hidden, and stated as a decision rather than a gap.
        A member pays from their own UPI app into the bank account printed on
        the Banks screen, and this desk is where the treasurer records what
        arrived. Nothing here needs a payment provider, and none is coming — the
        committee's answer is that this application keeps records rather than
        taking money (docs/M4-PLAN.md §1).
      */}
      <Card className="border-dashed bg-muted/40">
        <CardContent className="flex items-start gap-3 p-4">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              Money arrives by UPI, and is recorded here by hand
            </p>
            <p className="text-muted-foreground">
              Members pay into the account on the Banks screen. This desk is
              where it enters the books — open a session, enter what came in, and
              the receipt is issued from the same sequence as everything else.
            </p>
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <RoundDetail id={selected} onBack={() => setSelected(null)} />
      ) : (
        <RoundList
          rounds={rounds}
          onOpen={setSelected}
          funds={dashboard?.fundBreakdown ?? []}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ list */

function RoundList({
  rounds,
  onOpen,
  funds,
}: {
  rounds: ReturnType<typeof useQuery<typeof api.collections.rounds>>
  onOpen: (id: Id<"collectionRounds">) => void
  funds: { id: Id<"funds">; name: string; collectionMode: string }[]
}) {
  const createRound = useMutation(api.collections.createRound)
  const [open, setOpen] = useState(false)
  const [fundId, setFundId] = useState<Id<"funds"> | "">("")
  const [date, setDate] = useState(today())
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only funds that can have a session. A round on a scheduled fund would be
  // meaningless and would invite counting the same money twice; the server
  // refuses it, and offering it would just be a way to get an error.
  const eligible = funds.filter((f) =>
    ["voluntary", "donation", "pledge_based"].includes(f.collectionMode ?? ""),
  )

  async function submit() {
    // Narrowed here rather than relied on at the call site: the disabled button
    // is a runtime guard, and TypeScript is right not to trust it across a
    // closure that could run after a re-render cleared the selection.
    if (!fundId) {
      setError("Choose which fund this session is for")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createRound({ fundId, date, label })
      setOpen(false)
      setLabel("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WithReadModel data={rounds ?? undefined} label="Loading collection sessions">
      {(data) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Sessions recorded"
              value={String(data.total)}
              hint={
                data.total > data.shown
                  ? `Showing the most recent ${data.shown}`
                  : "All of them"
              }
              icon={CalendarDays}
            />
            <StatCard
              label="Collected in the sessions shown"
              value={formatPaise(
                data.rounds.reduce((sum, r) => sum + r.totalPaise, 0),
              )}
              hint={`${data.rounds.reduce((s, r) => s + r.memberCount, 0)} members across them`}
              icon={Banknote}
              tone="positive"
            />
            <Card>
              <CardContent className="flex h-full flex-col justify-between gap-3 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Open a session
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start one before the money starts moving, so the total has
                    something to add up to.
                  </p>
                </div>
                <Button
                  onClick={() => setOpen(true)}
                  disabled={eligible.length === 0}
                >
                  <Plus className="size-4" />
                  New session
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>
                Newest first. Open one to add money to it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.rounds.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="No collection sessions yet"
                  description="A session is a dated sitting — the Friday sarkar, a meeting, a door-to-door round. Open one, then record what came in."
                  action={
                    <Button
                      onClick={() => setOpen(true)}
                      disabled={eligible.length === 0}
                    >
                      <Plus className="size-4" />
                      Open the first session
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {data.rounds.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => onOpen(r.id)}
                        className="cf-lift flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          {/*
                            A `div`, not a `p`. `Badge` renders a `div`, and a
                            `div` inside a `p` is invalid HTML — React logs
                            `validateDOMNesting` and the browser is free to
                            close the paragraph early, which puts the date line
                            in the wrong place. Caught by the route sweep's
                            "no runtime error" assertion, which is the only
                            reason a cosmetic-looking nesting mistake counts.
                          */}
                          <div className="flex flex-wrap items-center gap-2 font-medium">
                            <span className="truncate">{r.label}</span>
                            <CollectionModeBadge mode={r.collectionMode} />
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatDate(r.date)} · {r.fundName}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tabular font-semibold">
                            {formatPaise(r.totalPaise)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.paymentCount === 0
                              ? "nothing recorded"
                              : `${r.memberCount} of ${r.paymentCount}`}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Open a collection session</DialogTitle>
                <DialogDescription>
                  Money recorded into this session is totalled here and settled
                  against the fund as usual. It does not need a signal.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="round-fund">Fund</Label>
                  <Select
                    value={fundId}
                    onValueChange={(v) => setFundId(v as Id<"funds">)}
                  >
                    <SelectTrigger id="round-fund">
                      <SelectValue placeholder="Which fund is this for?" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligible.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="round-date">Date</Label>
                  <Input
                    id="round-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="round-label">Label</Label>
                  <Input
                    id="round-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Friday sarkar, 12 September"
                  />
                </div>
                {error ? (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button onClick={submit} disabled={busy || !fundId || label.trim().length < 2}>
                  {busy ? "Opening…" : "Open session"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </WithReadModel>
  )
}

/* ---------------------------------------------------------------- detail */

function RoundDetail({
  id,
  onBack,
}: {
  id: Id<"collectionRounds">
  onBack: () => void
}) {
  const session = useQuery(api.collections.round, { id })
  const record = useMutation(api.collections.recordRoundPayment)
  const [adding, setAdding] = useState(false)

  return (
    <WithReadModel data={session ?? undefined} label="Loading the session">
      {(data) => (
        <div className="space-y-6">
          <div>
            <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
              <ChevronLeft className="size-4" />
              All sessions
            </Button>
          </div>

          <PageHeader
            title={data.label}
            description={`${formatDate(data.date)} · ${data.fundName}`}
          >
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Record money
            </Button>
          </PageHeader>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Total for this session"
              value={formatPaise(data.totalPaise)}
              hint={`${data.paymentCount} receipts`}
              icon={Banknote}
              tone="positive"
            />
            <StatCard
              label="Members"
              value={String(data.memberCount)}
              hint={
                data.paymentCount > data.memberCount
                  ? "includes anonymous gifts"
                  : "everyone is named"
              }
              icon={HandCoins}
            />
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  How it came in
                </p>
                {data.methods.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing recorded yet.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {data.methods.map((m) => (
                      <li
                        key={m.method}
                        className="flex items-baseline justify-between gap-2 text-sm"
                      >
                        <span>
                          {METHOD_LABELS[m.method] ?? m.method}
                          <span className="text-muted-foreground">
                            {" "}
                            × {m.count}
                          </span>
                        </span>
                        <span className="tabular font-medium">
                          {formatPaise(m.amountPaise)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Receipts</CardTitle>
              <CardDescription>
                In the order they were issued, from the same sequence as every
                other receipt in the organisation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.payments.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No money recorded in this session"
                  description="Tap “Record money” as each contribution comes in. Every one gets a receipt number straight away."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Receipt</th>
                        <th className="pb-2 pr-3 font-medium">Member</th>
                        <th className="pb-2 pr-3 font-medium">Method</th>
                        <th className="pb-2 pr-3 font-medium">Reference</th>
                        <th className="pb-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="tabular py-2 pr-3 font-medium">
                            {p.receiptNo}
                          </td>
                          <td className="py-2 pr-3">
                            {p.memberName ?? (
                              <span className="text-muted-foreground">
                                Anonymous
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {METHOD_LABELS[p.method] ?? p.method}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {p.reference ?? "—"}
                          </td>
                          <td className="tabular py-2 text-right font-semibold">
                            {formatPaise(p.amountPaise)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <RecordPaymentDialog
            open={adding}
            onOpenChange={setAdding}
            roundId={id}
            onRecorded={record}
          />
        </div>
      )}
    </WithReadModel>
  )
}

/* --------------------------------------------------------- record money */

function RecordPaymentDialog({
  open,
  onOpenChange,
  roundId,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roundId: Id<"collectionRounds">
  onRecorded: ReturnType<typeof useMutation<typeof api.collections.recordRoundPayment>>
}) {
  // `search` is declared before the query that reads it. The other order is a
  // temporal-dead-zone crash on the first render, not a type error.
  const [search, setSearch] = useState("")
  const [memberId, setMemberId] = useState<Id<"members"> | "">("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<"cash" | "cheque" | "upi" | "card" | "transfer">("cash")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)

  const members = useQuery(
    api.collections.roundMembers,
    open ? { search, limit: 20 } : "skip",
  )

  const paise = rupeesToPaise(Number(amount))
  const valid =
    Number.isFinite(paise) && paise > 0 && !busy && (memberId !== "" || method !== "cash")

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result = await onRecorded({
        roundId,
        memberId: memberId === "" ? undefined : memberId,
        amountPaise: paise,
        method,
        reference: reference || undefined,
      })
      // Shown immediately rather than only in the table below, because the
      // receipt number is the thing being handed over at that moment and a
      // treasurer should not have to go looking for it.
      setReceipt(result.receiptNo)
      setAmount("")
      setReference("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function close() {
    onOpenChange(false)
    setReceipt(null)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record money into this session</DialogTitle>
          <DialogDescription>
            A receipt number is issued immediately. Nothing here needs a signal.
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              <div className="space-y-1">
                <p className="font-medium">Recorded — receipt {receipt}</p>
                <p className="text-sm text-muted-foreground">
                  Hand this number over. The member's balance is settled and the
                  entry is in the ledger.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  ₹
                </span>
                <Input
                  id="pay-amount"
                  inputMode="decimal"
                  className="pl-7"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-member">Member</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pay-member"
                  className="pl-9"
                  value={members?.find((m) => m.id === memberId)?.name ?? ""}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    // Clear the selection when the text no longer matches it,
                    // so the name on the receipt is never stale.
                    if (
                      memberId &&
                      !members?.some(
                        (m) => m.id === memberId && m.name === e.target.value,
                      )
                    ) {
                      setMemberId("")
                    }
                  }}
                  placeholder="Start typing a name"
                />
              </div>
              {search ? (
                <ul className="max-h-40 overflow-y-auto rounded-md border">
                  {members && members.length > 0 ? (
                    members.map((m) => (
                      <li key={m.id}>
                        <button
                          onClick={() => {
                            setMemberId(m.id)
                            setSearch(m.name)
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                        >
                          <span className="truncate">{m.name}</span>
                          {m.phone ? (
                            <span className="tabular shrink-0 text-xs text-muted-foreground">
                              {m.phone}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      No active member matches that.
                    </li>
                  )}
                </ul>
              ) : null}
              {method === "cash" && !memberId ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CircleAlert className="mt-px size-3 shrink-0" />
                  Name a member so the payment settles their dues. An anonymous
                  gift is recorded against the fund only.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger id="pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="transfer">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {method === "cheque" || method === "transfer" ? (
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Reference</Label>
                <Input
                  id="pay-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={
                    method === "cheque" ? "Cheque number" : "UTR / transfer reference"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Without this the money arrives in the bank with nothing to
                  match it to, and reconciliation stops working.
                </p>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button onClick={submit} disabled={!valid}>
                {busy ? "Recording…" : "Record and issue receipt"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
