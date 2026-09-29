import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation } from "convex/react"
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  HandCoins,
  PartyPopper,
  QrCode,
  XCircle,
} from "lucide-react"
import { api } from "../../../convex/_generated/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { WithReadModel } from "@/components/shared/read-model"
import { PortalHeader } from "@/components/portal/portal-shell"
import { useMyRequests, usePortalSummary } from "@/data/queries"
import { formatDate, formatPaise, parseRupees } from "@/lib/format"
import { TODAY } from "@/data/period"
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types"
import type { Id } from "../../../convex/_generated/dataModel"

/**
 * "I already paid" — the one thing a member needs that a portal otherwise lacks.
 *
 * ## Why this writes nothing
 *
 * The obvious design is a button that marks the month paid. That would let anyone
 * with a shared phone erase their own arrears, and it would put money in the
 * books from a request nobody verified. So this creates a *request* and stops.
 * A treasurer confirms it, and only then does `recordPaymentFor` — the same
 * function the desk uses — write the payment, the receipt and the ledger entry.
 *
 * That ordering is the whole feature. The member gets a claim number immediately
 * so they can point at it at the next collection, and the books are never wrong
 * in the meantime.
 *
 * ## The form is shaped around the actual conversation
 *
 * "I gave ₹500 cash to Bilal on the 4th." So: an amount in rupees, cash as the
 * default method, and a date that cannot be in the future. A reference field is
 * there for UPI and cheque numbers and is optional everywhere else, because a
 * required field that does not apply is how a form gets abandoned.
 */
export default function PortalRequests() {
  const summary = usePortalSummary()
  const requests = useMyRequests()
  const create = useMutation(api.portal.requestPayment)

  const [amount, setAmount] = useState("")
  const [fundId, setFundId] = useState<string>("")
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [paidAt, setPaidAt] = useState(TODAY.toISOString().slice(0, 10))
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const today = TODAY.toISOString().slice(0, 10)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setDone(null)

    const paise = parseRupees(amount)
    if (paise === null) {
      setError("Enter the amount in rupees, like 500")
      return
    }

    setBusy(true)
    try {
      const result = await create({
        amountPaise: paise,
        fundId: fundId ? (fundId as Id<"funds">) : undefined,
        method,
        paidAt: new Date(`${paidAt}T12:00:00.000Z`).toISOString(),
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      })
      setDone(
        `Sent. The treasurer will confirm it, and receipt ${
          result.id.slice(0, 6)
        }… will appear in your passbook.`,
      )
      setAmount("")
      setReference("")
      setNote("")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send your claim",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    // Null means "unlinked", which is unreachable from the portal's own tabs.
    <WithReadModel data={summary ?? undefined} label="Loading your balance">
      {(data) => {
        const hasOpen = (requests ?? []).some((r) => r.status === "pending")

        return (
          <div className="space-y-4">
            <PortalHeader
              title="I have paid"
              subtitle="Tell us, and a treasurer will confirm it"
            />

            {/*
              The order is deliberate. A member arrives here *after* paying, so
              the account they paid into is the thing they may need to name —
              its reference is what the treasurer will match against the bank
              statement. Putting it above the form is also what stops the failure
              this app is built around: a member who believes the app took their
              money and therefore told nobody.
            */}
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to="/me/pay">
                <QrCode className="size-4" />
                Bank details and UPI QR
              </Link>
            </Button>

            {hasOpen ? (
              <Card className="border-warning/40 bg-warning/5">
                <CardContent className="flex items-start gap-3 p-4">
                  <Clock className="mt-0.5 size-5 shrink-0 text-chart-4" />
                  <div>
                    <p className="text-sm font-medium">
                      You already have a claim waiting
                    </p>
                    <p className="text-xs text-muted-foreground">
                      One at a time, so a payment cannot be entered twice. It stays
                      here until a treasurer looks at it.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardContent className="p-5">
                <form className="space-y-4" onSubmit={submit}>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount">How much did you give?</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        ₹
                      </span>
                      <Input
                        id="amount"
                        inputMode="decimal"
                        placeholder="500"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="h-12 pl-7 text-lg"
                        disabled={hasOpen}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {data.totalOutstandingPaise > 0
                        ? `You owe ${formatPaise(data.totalOutstandingPaise)} in total. Pay that, or more if you wish to settle ahead.`
                        : "You are settled up — this is for a voluntary contribution, or a payment made in error."}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="fund">For which fund?</Label>
                    <Select
                      value={fundId}
                      onValueChange={setFundId}
                      disabled={hasOpen}
                    >
                      <SelectTrigger id="fund" className="h-12">
                        <SelectValue placeholder="Monthly contribution" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.dueFunds.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} — {formatPaise(f.monthlyAmountPaise)} a month
                          </SelectItem>
                        ))}
                        {data.voluntaryFunds.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} — optional
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Leave this on the default for a normal monthly payment.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="method">How?</Label>
                      <Select
                        value={method}
                        onValueChange={(v) => setMethod(v as PaymentMethod)}
                        disabled={hasOpen}
                      >
                        <SelectTrigger id="method" className="h-12">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]
                          ).map((m) => (
                            <SelectItem key={m} value={m}>
                              {PAYMENT_METHOD_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="paidAt">On what date?</Label>
                      <Input
                        id="paidAt"
                        type="date"
                        max={today}
                        value={paidAt}
                        onChange={(e) => setPaidAt(e.target.value)}
                        className="h-12"
                        disabled={hasOpen}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reference">
                      Reference{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="reference"
                      placeholder="UPI or cheque number, if you have one"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      disabled={hasOpen}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="note">
                      Anything else{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="note"
                      placeholder="Gave it to Bilal after the prayer"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      disabled={hasOpen}
                    />
                  </div>

                  {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <p className="text-sm">{error}</p>
                    </div>
                  ) : null}

                  {done ? (
                    <div className="flex items-start gap-2 rounded-lg border border-chart-3/40 bg-chart-3/5 p-3">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-chart-3" />
                      <p className="text-sm">{done}</p>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    className="h-12 w-full"
                    disabled={busy || hasOpen}
                  >
                    <HandCoins className="size-5" />
                    {busy
                      ? "Sending…"
                      : hasOpen
                        ? "Waiting for the treasurer"
                        : "Send to the treasurer"}
                  </Button>

                  <p className="text-center text-[11px] text-muted-foreground">
                    Sending this does not change your balance yet. A treasurer has to
                    confirm it against the cash they actually hold.
                  </p>
                </form>
              </CardContent>
            </Card>

            <Separator />

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Your claims</h2>
              <WithReadModel data={requests} label="Loading your claims">
                {(rows) =>
                  rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      You have not claimed any payments.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {rows.map((r) => (
                        <li
                          key={r.id}
                          className="rounded-xl border bg-card p-4"
                        >
                          <div className="flex items-start gap-3">
                            <StatusIcon status={r.status} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <p className="tabular text-sm font-semibold">
                                  {formatPaise(r.amountPaise)}
                                </p>
                                <RequestBadge status={r.status} />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(r.paidAt)} ·{" "}
                                {PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ??
                                  r.method}
                                {r.reference ? ` · ${r.reference}` : ""}
                              </p>
                              {r.note ? (
                                <p className="mt-1 text-xs italic text-muted-foreground">
                                  “{r.note}”
                                </p>
                              ) : null}
                              {r.decisionNote ? (
                                <p className="mt-1.5 rounded bg-muted/60 px-2 py-1 text-xs">
                                  <span className="font-medium">Treasurer:</span>{" "}
                                  {r.decisionNote}
                                </p>
                              ) : null}
                              {r.status === "approved" ? (
                                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-chart-3">
                                  <PartyPopper className="size-3.5" />
                                  Added to your passbook
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </WithReadModel>
            </section>
          </div>
        )
      }}
    </WithReadModel>
  )
}

function RequestBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge variant="success">Confirmed</Badge>
  if (status === "rejected") return <Badge variant="destructive">Not accepted</Badge>
  return <Badge variant="warning">Waiting</Badge>
}

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") {
    return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-chart-3" />
  }
  if (status === "rejected") {
    return <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
  }
  return <Clock className="mt-0.5 size-5 shrink-0 text-chart-4" />
}
