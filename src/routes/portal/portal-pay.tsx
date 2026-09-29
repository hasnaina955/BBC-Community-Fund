import { ArrowLeft, Info } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BankDetailsPanel } from "@/components/shared/bank-details"
import { WithReadModel } from "@/components/shared/read-model"
import { PortalHeader } from "@/components/portal/portal-shell"
import { usePaymentDetails } from "@/data/queries"

/**
 * "How do I pay?" — the account to send to, and the QR that does it.
 *
 * ## This screen does not take money
 *
 * The committee decided that this application records contributions rather than
 * collecting them (docs/M4-PLAN.md §1). So a member scans the QR in their own
 * UPI app, the money goes to BBC's bank account, and the application never
 * learns that it happened. What it does next is the important part of this
 * screen: the member tells the treasurer, and the treasurer confirms it through
 * the same claim flow as a payment handed over in cash.
 *
 * That gap between "sent" and "recorded" is the honest shape of this product,
 * and this screen says so rather than implying a receipt is automatic. A member
 * who assumes the app knows would stop telling the treasurer, and their
 * contribution would simply never be recorded.
 *
 * The QR therefore carries no amount — see `src/lib/upi.ts` — and this page
 * must never grow an amount field, a "Pay now" button, or a success message.
 *
 * ## Why it is its own page
 *
 * Because it gets printed. A member puts it on the fridge; a treasurer puts it
 * on the noticeboard. A print of the balance screen would be wrong for both.
 */
export default function PortalPay() {
  const details = usePaymentDetails()

  return (
    <WithReadModel data={details} label="Loading the account details">
      {(data) => (
        <div className="space-y-4">
          <PortalHeader title="How to pay" subtitle="Send it from any UPI app" />

          <Button asChild variant="ghost" size="sm" className="print:hidden -ml-2">
            <Link to="/me">
              <ArrowLeft className="size-4" />
              Back to balance
            </Link>
          </Button>

          {data.accounts.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-sm font-medium">No account to pay into yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your contributions are collected in person. Ask the treasurer
                  for the account details.
                </p>
              </CardContent>
            </Card>
          ) : (
            data.accounts.map((account) => (
              <BankDetailsPanel
                key={account.id}
                testId="portal-pay"
                account={{
                  name: account.name,
                  branch: account.branch,
                  accountNumber: account.accountNumber,
                  ifscCode: account.ifscCode,
                  upiId: account.upiId,
                  fundNames: account.fundNames,
                }}
              />
            ))
          )}

          {/*
            Stated on the page rather than in a tooltip, because it is the one
            thing a member gets wrong: they pay, the app says nothing, and they
            assume it worked.
          */}
          <Card className="print:hidden border-primary/30 bg-primary/5">
            <CardContent className="flex items-start gap-3 p-4">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="space-y-2 text-sm">
                <p className="font-medium">After you send it, tell the treasurer</p>
                <p className="text-muted-foreground">{data.howToRecord}</p>
                <Button asChild size="sm" variant="outline">
                  <Link to="/me/requests">I have already paid</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </WithReadModel>
  )
}
