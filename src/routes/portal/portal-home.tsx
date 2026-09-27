import { useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Download,
  HandCoins,
  Share2,
  Smartphone,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { WithReadModel } from "@/components/shared/read-model"
import { PortalHeader } from "@/components/portal/portal-shell"
import { useMyAccount, usePortalSummary } from "@/data/queries"
import { formatPaise, formatDate, monthLabel } from "@/lib/format"
import { shareBalance, type ShareOutcome } from "@/lib/share"
import { useInstallPrompt } from "@/lib/pwa"
import { ClaimCard } from "@/routes/portal/portal-account"

/**
 * "What do I owe?" — the one screen the whole milestone exists for.
 *
 * A member opens this in a queue at the collection table, so it answers in the
 * order a person actually asks: the total, then why it is that total, then what
 * to do about it. The total is the largest thing on the page because it is the
 * only thing that is always relevant — every other figure on this screen is an
 * explanation of it.
 *
 * ## The clear case matters as much as the owing case
 *
 * Most members are not in arrears, and a member who is *up to date* opening a
 * screen called "Balance" deserves a green answer, not a large zero and a red
 * badge. So the settled state is a first-class state here rather than the
 * fall-through of the calculation.
 *
 * Every figure below is read from the server's read model. Nothing is summed in
 * the browser: the number a member argues with at the collection table has to be
 * the same number the treasurer sees, and the only way to guarantee that is for
 * both to be reading the same row.
 */
export default function PortalHome() {
  const account = useMyAccount()
  const summary = usePortalSummary()
  const install = useInstallPrompt()
  const [shareState, setShareState] = useState<ShareOutcome | null>(null)
  const [sharing, setSharing] = useState(false)

  const onShare = async () => {
    if (!summary) return
    setSharing(true)
    setShareState(null)
    const outcome = await shareBalance({
      name: summary.member.name,
      orgName: summary.orgName,
      month: summary.currentMonth.month,
      year: summary.currentMonth.year,
      currentMonthPaise: summary.currentMonthPaise,
      arrearsPaise: summary.arrearsPaise,
      arrearsMonths: summary.arrearsMonths,
      totalOutstandingPaise: summary.totalOutstandingPaise,
      totalReceivedPaise: summary.totalReceivedPaise,
      paymentCount: summary.paymentCount,
    })
    setShareState(outcome)
    setSharing(false)
  }

  return (
    <WithReadModel data={account} label="Checking your account">
      {(me) => {
        if (me.memberId === null) return <ClaimCard />

        return (
          // `summary` is null exactly when the account is unlinked, which the
          // line above has already handled — so past this point `?? undefined`
          // only ever distinguishes "still loading" from "loaded".
          <WithReadModel data={summary ?? undefined} label="Adding up what you owe">
            {(data) => {
              const clear = data.totalOutstandingPaise === 0
              const period = `${monthLabel(data.currentMonth.month)} ${data.currentMonth.year}`

              return (
                <div className="space-y-4">
                  <PortalHeader
                    title={data.member.name}
                    subtitle={data.orgName}
                  />

                  {/* The answer. */}
                  <Card
                    className={
                      clear
                        ? "border-chart-3/40 bg-chart-3/5"
                        : "border-primary/30 bg-primary/5"
                    }
                  >
                    <CardContent className="p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {clear ? "Nothing outstanding" : "Total outstanding"}
                      </p>
                      <p className="tabular mt-1 text-4xl font-semibold tracking-tight">
                        {formatPaise(data.totalOutstandingPaise)}
                      </p>

                      {clear ? (
                        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-chart-3" />
                          <span>
                            You are up to date for {period}. Thank you.
                          </span>
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {data.hasDues
                            ? `Including ${period} and ${data.arrearsMonths} earlier ${data.arrearsMonths === 1 ? "month" : "months"}.`
                            : "Voluntary contributions are never owed — thank you."}
                        </p>
                      )}

                      {data.oldestDueDate ? (
                        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <CalendarClock className="size-3.5 shrink-0" />
                          Oldest unpaid month was due{" "}
                          {formatDate(data.oldestDueDate)}
                          {data.oldestDueDays > 0
                            ? ` · ${data.oldestDueDays} days ago`
                            : ""}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>

                  {/* Where the number comes from. */}
                  <div className="grid grid-cols-2 gap-3">
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          This month
                        </p>
                        <p className="tabular mt-1 text-lg font-semibold">
                          {formatPaise(data.currentMonthPaise)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {period}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Arrears
                        </p>
                        <p className="tabular mt-1 text-lg font-semibold">
                          {formatPaise(data.arrearsPaise)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {data.arrearsMonths === 0
                            ? "None"
                            : `${data.arrearsMonths} ${data.arrearsMonths === 1 ? "month" : "months"}`}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Act on it. */}
                  <div className="space-y-2">
                    <Button asChild className="h-12 w-full text-base">
                      <Link to="/me/requests">
                        <HandCoins className="size-5" />
                        I have paid — send the receipt
                      </Link>
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button asChild variant="outline" className="h-11">
                        <Link to="/me/statement">
                          <Download className="size-4" />
                          Statement
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11"
                        onClick={onShare}
                        disabled={sharing}
                      >
                        <Share2 className="size-4" />
                        {sharing ? "Sharing…" : "Share"}
                      </Button>
                    </div>
                    {shareState === "copied" ? (
                      <p className="text-center text-xs text-muted-foreground">
                        Copied to your clipboard — paste it to whoever you like.
                      </p>
                    ) : null}
                    {shareState === "whatsapp" ? (
                      <p className="text-center text-xs text-muted-foreground">
                        WhatsApp opened in a new tab.
                      </p>
                    ) : null}
                    {shareState === "failed" ? (
                      <p className="text-center text-xs text-destructive">
                        Could not share on this device. The statement page can
                        still be printed or saved.
                      </p>
                    ) : null}
                  </div>

                  {install.canInstall ? (
                    <Card className="border-dashed">
                      <CardContent className="flex items-center gap-3 p-4">
                        <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            Add this to your home screen
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Your balance opens without typing a web address.
                          </p>
                        </div>
                        <Button size="sm" onClick={install.install}>
                          Install
                        </Button>
                      </CardContent>
                    </Card>
                  ) : null}

                  {/* Ageing, so "3 months late" is a fact and not a feeling. */}
                  {data.aging.some((b) => b.totalPaise > 0) ? (
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <p className="text-sm font-medium">How long it has been due</p>
                        {data.aging
                          .filter((b) => b.totalPaise > 0)
                          .map((bucket) => {
                            const worst = Math.max(
                              ...data.aging.map((b) => b.totalPaise),
                            )
                            return (
                              <div key={bucket.key} className="space-y-1">
                                <div className="flex items-baseline justify-between text-xs">
                                  <span className="text-muted-foreground">
                                    {bucket.label}
                                  </span>
                                  <span className="tabular font-medium">
                                    {formatPaise(bucket.totalPaise)}
                                  </span>
                                </div>
                                <Progress
                                  value={worst === 0 ? 0 : (bucket.totalPaise / worst) * 100}
                                />
                              </div>
                            )
                          })}
                        <p className="text-[11px] text-muted-foreground">
                          {data.aging
                            .filter((b) => b.totalPaise > 0)
                            .map((b) => `${b.label}: ${b.count}`)
                            .join(" · ")}{" "}
                          unpaid months
                        </p>
                      </CardContent>
                    </Card>
                  ) : null}

                  {/* What you have paid, most recent first. */}
                  <Card>
                    <CardContent className="p-0">
                      <div className="flex items-baseline justify-between px-4 pb-3 pt-4">
                        <div>
                          <p className="text-sm font-medium">Paid to date</p>
                          <p className="tabular text-xs text-muted-foreground">
                            {formatPaise(data.totalReceivedPaise)} over{" "}
                            {data.paymentCount}{" "}
                            {data.paymentCount === 1 ? "payment" : "payments"}
                          </p>
                        </div>
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/me/receipts">
                            All receipts
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                      {data.receipts.length === 0 ? (
                        <p className="border-t px-4 py-4 text-sm text-muted-foreground">
                          No payments recorded yet.
                        </p>
                      ) : (
                        <ul className="border-t">
                          {data.receipts.slice(0, 3).map((r) => (
                            <li key={r.id}>
                              <Link
                                to={`/me/receipts/${r.id}`}
                                className="flex items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0 hover:bg-accent/50"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium">
                                    {r.receiptNo}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {formatDate(r.paidAt)}
                                    {r.fundName ? ` · ${r.fundName}` : ""}
                                  </p>
                                </div>
                                <span className="tabular font-semibold">
                                  {formatPaise(r.amountPaise)}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  {data.pendingRequests > 0 ? (
                    <Card className="border-warning/40 bg-warning/5">
                      <CardContent className="flex items-start gap-3 p-4">
                        <HandCoins className="mt-0.5 size-5 shrink-0 text-chart-4" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {data.pendingRequests}{" "}
                            {data.pendingRequests === 1 ? "claim" : "claims"} waiting
                          </p>
                          <p className="text-xs text-muted-foreground">
                            A treasurer has to confirm cash collected in person
                            before it reaches your passbook.
                          </p>
                          <Button asChild variant="link" size="sm" className="h-auto p-0">
                            <Link to="/me/requests">See its status</Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  {/* What people can give to without being chased for it. */}
                  {data.voluntaryFunds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.voluntaryFunds.map((f) => (
                        <Badge key={f.id} variant="outline" className="capitalize">
                          {f.name} · optional
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            }}
          </WithReadModel>
        )
      }}
    </WithReadModel>
  )
}
