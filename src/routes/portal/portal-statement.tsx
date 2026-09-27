import { useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight, Printer, Share2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { WithReadModel } from "@/components/shared/read-model"
import { PortalHeader } from "@/components/portal/portal-shell"
import { useStatement, usePortalSummary } from "@/data/queries"
import { formatDate, formatPaise, MONTHS_SHORT } from "@/lib/format"
import { PAYMENT_METHOD_LABELS, type ContributionStatus, type PaymentMethod } from "@/lib/types"
import { shareBalance } from "@/lib/share"

/**
 * The passbook statement — the thing a member actually keeps.
 *
 * A statement is not a screen. It has three obligations a screen does not:
 *
 *   1. **It is complete.** Every month ever charged, every payment ever received.
 *      No pagination, no "50 most recent", no ellipsis. The `portal:statement`
 *      read model exists for exactly this reason — see its comment.
 *   2. **It is internally consistent.** The figure at the foot is the arithmetic
 *      of the rows above it, computed server-side from the same two lists, so a
 *      member cannot add it up and get a different answer.
 *   3. **It prints.** Everything that is interface rather than record carries
 *      `print:hidden`, and the tables drop their borders back in for paper. The
 *      page it prints is the page on screen — no separate renderer to disagree
 *      with the display, which is the failure mode of the server-HTML approach
 *      this replaced.
 *
 * ## The print is a real print, not a screenshot
 *
 * `window.print()` hands the member the platform sheet, which is where *Save as
 * PDF* and *Share to WhatsApp* live. A member forwarding their statement to a
 * relative is the single most likely thing to happen to this document, and the
 * native sheet is how it happens without a round trip to the treasurer.
 */

const STATUS_LABEL: Record<ContributionStatus, string> = {
  paid: "Paid",
  due: "Unpaid",
  partial: "Part",
  waived: "Waived",
}

export default function PortalStatement() {
  const statement = useStatement()
  const summary = usePortalSummary()
  const [shared, setShared] = useState(false)

  const onShare = async () => {
    const s = summary
    if (!s) return
    await shareBalance({
      name: s.member.name,
      orgName: s.orgName,
      month: s.currentMonth.month,
      year: s.currentMonth.year,
      currentMonthPaise: s.currentMonthPaise,
      arrearsPaise: s.arrearsPaise,
      arrearsMonths: s.arrearsMonths,
      totalOutstandingPaise: s.totalOutstandingPaise,
      totalReceivedPaise: s.totalReceivedPaise,
      paymentCount: s.paymentCount,
    })
    setShared(true)
  }

  return (
    // Null means "unlinked", which is unreachable from the portal's own tabs.
    <WithReadModel data={statement ?? undefined} label="Building your statement">
      {(data) => (
        <div className="space-y-4">
          <div className="print:hidden">
            <PortalHeader
              title="Passbook statement"
              subtitle={`${data.member.name} · ${data.orgName}`}
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => window.print()}>
                <Printer className="size-4" />
                Print or save as PDF
              </Button>
              <Button variant="outline" onClick={onShare}>
                <Share2 className="size-4" />
                Share
              </Button>
              <Button asChild variant="outline" size="icon" aria-label="Back">
                <Link to="/me">
                  <ChevronRight className="size-4 rotate-180" />
                </Link>
              </Button>
            </div>
            {shared ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Shared. Your balance was sent as text — no login needed to read it.
              </p>
            ) : null}
          </div>

          {/* ---- the document ---- */}
          <article className="space-y-5 rounded-xl border bg-card p-6 print:rounded-none print:border-0 print:bg-white print:p-0">
            <header className="border-b-2 border-foreground pb-3">
              <h1 className="text-lg font-semibold">Contribution statement</h1>
              <p className="text-sm text-muted-foreground">{data.orgName}</p>
            </header>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Detail label="Member" value={data.member.name} />
              <Detail
                label="Statement date"
                value={formatDate(data.generatedAt)}
              />
              <Detail
                label="Member since"
                value={`${MONTHS_SHORT[data.member.joinedMonth - 1]} ${data.member.joinedYear}`}
              />
              <Detail
                label="Status"
                value={data.member.isActive ? "Active member" : "Inactive member"}
              />
            </dl>

            <section>
              <h2 className="mb-2 text-sm font-semibold">Summary</h2>
              <table className="w-full text-sm">
                <tbody>
                  <SummaryRow
                    label="Charged to date"
                    value={formatPaise(data.chargedTotalPaise)}
                    note={`${data.charged.length} monthly dues`}
                  />
                  <SummaryRow
                    label="Received to date"
                    value={formatPaise(data.receivedTotalPaise)}
                    note={`${data.received.length} payments`}
                  />
                  <SummaryRow
                    label="Outstanding"
                    value={formatPaise(Math.max(0, data.outstandingPaise))}
                    strong
                    note={
                      data.outstandingPaise <= 0
                        ? "Settled in full"
                        : "Sum of the unpaid months below"
                    }
                  />
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold">Monthly dues</h2>
              {data.charged.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No monthly dues are charged to this member.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 font-medium">Month</th>
                      <th className="py-1.5 font-medium">Fund</th>
                      <th className="py-1.5 text-right font-medium">Charged</th>
                      <th className="py-1.5 pl-3 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.charged.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b last:border-b-0 print:border-foreground/15"
                      >
                        <td className="py-1.5">
                          {MONTHS_SHORT[c.month - 1]} {c.year}
                        </td>
                        <td className="py-1.5 text-muted-foreground">
                          {c.fundName}
                        </td>
                        <td className="tabular py-1.5 text-right">
                          {formatPaise(c.amountPaise)}
                        </td>
                        <td className="py-1.5 pl-3 text-right">
                          <StatusPill status={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold">Payments received</h2>
              {data.received.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No payments have been recorded.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 font-medium">Date</th>
                      <th className="py-1.5 font-medium">Receipt</th>
                      <th className="py-1.5 font-medium">Method</th>
                      <th className="py-1.5 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.received.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b last:border-b-0 print:border-foreground/15"
                      >
                        <td className="py-1.5">{formatDate(p.paidAt)}</td>
                        <td className="tabular py-1.5">
                          <Link
                            to={`/me/receipts/${p.id}`}
                            className="underline decoration-dotted underline-offset-2"
                          >
                            {p.receiptNo}
                          </Link>
                        </td>
                        <td className="py-1.5 text-muted-foreground">
                          {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ??
                            p.method}
                        </td>
                        <td className="tabular py-1.5 text-right">
                          {formatPaise(p.amountPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <footer className="border-t pt-3 text-[11px] text-muted-foreground">
              Generated from the community's own records. Every figure on this page
              is derived from the entries listed on it; nothing here is entered by
              hand. Keep this statement — it is your proof of what has been paid.
            </footer>
          </article>

          <Card className="print:hidden border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground">
              Something on this statement looks wrong? The treasurer can print the
              same statement for any member at the desk, so it is worth comparing
              before you assume the app is at fault.
            </CardContent>
          </Card>
        </div>
      )}
    </WithReadModel>
  )
}

function StatusPill({ status }: { status: ContributionStatus }) {
  const variant =
    status === "paid"
      ? "success"
      : status === "due"
        ? "destructive"
        : status === "partial"
          ? "warning"
          : "info"
  return (
    <Badge variant={variant} className="text-[10px]">
      {STATUS_LABEL[status]}
    </Badge>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  note,
  strong,
}: {
  label: string
  value: string
  note: string
  strong?: boolean
}) {
  return (
    <tr className="border-b last:border-b-0 print:border-foreground/15">
      <td className="py-2">
        <span className={strong ? "font-semibold" : undefined}>{label}</span>
        <span className="block text-[11px] text-muted-foreground">{note}</span>
      </td>
      <td
        className={`tabular py-2 text-right ${
          strong ? "text-base font-semibold" : "font-medium"
        }`}
      >
        {value}
      </td>
    </tr>
  )
}
