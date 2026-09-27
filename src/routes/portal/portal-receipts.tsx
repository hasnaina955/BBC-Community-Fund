import { Link, useParams } from "react-router-dom"
import { ChevronRight, FileDown, Printer } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { WithReadModel } from "@/components/shared/read-model"
import { PortalHeader } from "@/components/portal/portal-shell"
import { usePortalSummary, useReceipt } from "@/data/queries"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types"

/**
 * A member's receipts, and the printable document behind each one.
 *
 * ## Why printing beats downloading here
 *
 * The obvious implementation of "download my receipt" is an HTML file fetched and
 * saved as a blob. It is worse for the person holding the phone: it bypasses the
 * system share sheet, so they cannot send the receipt to the very person who needs
 * to see it, and it lands in Downloads as an opaque file name. `window.print()`
 * opens the platform's own sheet, which on Android and iOS offers *Save as PDF*
 * and *Share* side by side. That is the behaviour people already have a reflex
 * for.
 *
 * The first version of this was an HTTP route rendering server-side HTML. It was
 * dropped because the local Convex backend serves no HTTP routes at all, so it
 * would have worked only against a cloud deployment — and a receipt that only
 * exists in production is not a receipt. See `convex/receipts.ts`.
 *
 * The page is deliberately a document and nothing else: no tab bar, no "related
 * items", no live numbers that could be mid-update while it is on the paper.
 */
export default function PortalReceipts() {
  const summary = usePortalSummary()

  return (
    // `summary` is null only when the account is unlinked, which cannot be true
    // on a screen reachable from the portal's own tab bar.
    <WithReadModel data={summary ?? undefined} label="Finding your receipts">
      {(data) => (
        <div className="space-y-4">
          <PortalHeader
            title="Receipts"
            subtitle={
              data.paymentCount === 0
                ? "Nothing received yet"
                : `${data.paymentCount} ${data.paymentCount === 1 ? "payment" : "payments"} · ${formatPaise(data.totalReceivedPaise)}`
            }
          />

          {data.receipts.length === 0 ? (
            <Card>
              <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No receipts yet</p>
                <p>
                  A receipt appears here as soon as the treasurer records a
                  payment. If you handed over cash at the collection table and
                  nothing has appeared, tell them — they can record it and the
                  receipt will be waiting.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-1">
                  <Link to="/me/requests">I already paid</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {data.receipts.length === 50 ? (
                // The list is capped server-side; say so rather than letting a
                // member conclude that receipt 51 does not exist.
                <p className="text-xs text-muted-foreground">
                  Showing your 50 most recent receipts. The statement page has every
                  payment ever recorded.
                </p>
              ) : null}

              <ul className="space-y-2">
                {data.receipts.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/me/receipts/${r.id}`}
                      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="tabular truncate text-sm font-semibold">
                            {r.receiptNo}
                          </p>
                          <Badge variant="outline" className="text-[10px]">
                            {PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ??
                              r.method}
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDate(r.paidAt)}
                          {r.fundName ? ` · ${r.fundName}` : ""}
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-semibold">
                        {formatPaise(r.amountPaise)}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </WithReadModel>
  )
}

/**
 * The printable receipt.
 *
 * The amount is the largest thing on the page and the receipt number is on it
 * twice — once in the table, once as the document's own heading — because a
 * receipt that gets separated from its paperwork has to be identifiable on its
 * own.
 */
export function PortalReceipt() {
  const { id } = useParams<{ id: string }>()
  const receipt = useReceipt(id ?? null)

  return (
    <WithReadModel data={id ? receipt : null} label="Fetching your receipt">
      {(data) => {
        if (!data) {
          return (
            <Card>
              <CardContent className="space-y-2 p-5 text-sm">
                <p className="font-medium">Receipt not available</p>
                <p className="text-muted-foreground">
                  This receipt does not exist, or it belongs to another member. If
                  you believe it is yours, ask the treasurer — they can print any
                  receipt for the community.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/me/receipts">Back to your receipts</Link>
                </Button>
              </CardContent>
            </Card>
          )
        }

        return (
          <div className="space-y-4">
            {/* Hidden on paper: the controls are for the screen, not the record. */}
            <div className="print:hidden flex items-center gap-2">
              <Button
                className="flex-1"
                onClick={() => window.print()}
              >
                <Printer className="size-4" />
                Print or save as PDF
              </Button>
              <Button asChild variant="outline" size="icon" aria-label="Back">
                <Link to="/me/receipts">
                  <ChevronRight className="size-4 rotate-180" />
                </Link>
              </Button>
            </div>

            <article className="rounded-xl border bg-card p-6 print:rounded-none print:border-0 print:bg-white print:p-0">
              <header className="border-b-2 border-foreground pb-4">
                <h1 className="text-lg font-semibold">Payment receipt</h1>
                <p className="text-sm text-muted-foreground">{data.orgName}</p>
              </header>

              <div className="my-5 rounded-lg bg-muted/60 py-5 text-center print:bg-transparent">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Received
                </p>
                <p className="tabular text-3xl font-semibold tracking-tight">
                  {formatPaise(data.amountPaise)}
                </p>
              </div>

              <table className="w-full text-sm">
                <tbody>
                  <Field label="Receipt number" value={data.receiptNo} />
                  <Field label="Date of payment" value={formatDate(data.paidAt)} />
                  <Field label="Paid by" value={data.memberName ?? "—"} />
                  <Field label="For" value={data.fundName ?? "General"} />
                  <Field
                    label="Method"
                    value={
                      PAYMENT_METHOD_LABELS[data.method as PaymentMethod] ??
                      data.method
                    }
                  />
                  {data.reference ? (
                    <Field label="Reference" value={data.reference} />
                  ) : null}
                </tbody>
              </table>

              <footer className="mt-6 border-t pt-3 text-[11px] text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <FileDown className="size-3" />
                  Generated from the community's own records
                  {data.printedAt
                    ? ` on ${formatDate(data.printedAt)}`
                    : ""}
                  . The amount above is the amount written to the ledger on the
                  date shown.
                </p>
              </footer>
            </article>
          </div>
        )
      }}
    </WithReadModel>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b last:border-b-0 print:border-foreground/20">
      <td className="w-2/5 py-2 align-top text-muted-foreground">{label}</td>
      <td className="py-2 text-right font-medium">{value}</td>
    </tr>
  )
}
