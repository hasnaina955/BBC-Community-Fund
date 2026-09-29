import { Printer, QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { UpiQr } from "@/components/shared/upi-qr"
import { formatAccountNumber, PAYEE_NAME, upiIntentUri } from "@/lib/upi"

export interface BankAccountDetails {
  name: string
  branch?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
  upiId?: string | null
  /** Shown under the account so a member knows what they are paying into. */
  fundNames?: readonly string[]
}

/**
 * The account to pay into, and the QR that does it.
 *
 * ## Nothing here confirms anything
 *
 * This panel shows a bank account and a QR code. It does not take a payment,
 * hold an amount, or mark a contribution paid, and it must never be extended to
 * appear to do so. The money leaves the member's UPI app and lands in the bank;
 * the application learns about it only when the member tells the treasurer,
 * which goes through the same claim flow as a payment handed over in cash.
 *
 * The consequence for the design is that the QR carries no amount. See
 * `src/lib/upi.ts` for why that is a correctness requirement rather than a
 * missing feature.
 *
 * ## Print
 *
 * A treasurer prints this for the noticeboard and a member prints it at home, so
 * the layout is single-column and survives being photocopied in greyscale: the
 * QR is pure black on white, the labels are uppercase and tracked, and the
 * account number is grouped in fours because a 16-digit number read aloud to a
 * bank branch is transcribed wrongly by someone and correctly by nobody.
 */
export function BankDetailsPanel({
  account,
  /** Extra lines under the QR — the portal's "now tell the treasurer" step. */
  footer,
  testId,
  className,
}: {
  account: BankAccountDetails
  footer?: React.ReactNode
  testId?: string
  className?: string
}) {
  const hasQr = typeof account.upiId === "string" && account.upiId.length > 0

  return (
    <Card className={className} data-testid={testId}>
      <CardContent className="p-5">
        <div className="print:hidden flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {account.fundNames && account.fundNames.length > 0
                ? account.fundNames.join(" · ")
                : "Bank account"}
            </p>
            <p className="truncate font-medium">{account.name}</p>
            {account.branch ? (
              <p className="truncate text-xs text-muted-foreground">
                {account.branch}
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            title="Print this page — the account and the QR code"
            data-testid={testId ? `${testId}-print` : undefined}
          >
            <Printer className="mr-1.5 size-3.5" />
            Print
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
          {hasQr ? (
            <div className="shrink-0">
              <UpiQr
                value={upiIntentUri({ vpa: account.upiId as string })}
                size={200}
                testId={testId ? `${testId}-qr` : undefined}
              />
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <QrCode className="size-3" />
                Scan with any UPI app
              </p>
            </div>
          ) : null}

          <dl className="min-w-0 flex-1 space-y-3">
            {account.accountNumber ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Account number
                </dt>
                <dd
                  className="tabular text-lg font-semibold tracking-wide"
                  data-testid={testId ? `${testId}-account` : undefined}
                >
                  {formatAccountNumber(account.accountNumber)}
                </dd>
              </div>
            ) : null}

            {account.ifscCode ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  IFSC
                </dt>
                <dd
                  className="tabular text-sm font-medium"
                  data-testid={testId ? `${testId}-ifsc` : undefined}
                >
                  {account.ifscCode}
                </dd>
              </div>
            ) : null}

            {hasQr ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  UPI address
                </dt>
                <dd
                  className="tabular break-all text-sm font-medium"
                  data-testid={testId ? `${testId}-vpa` : undefined}
                >
                  {account.upiId}
                </dd>
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  Pay to{" "}
                  <strong className="font-medium text-foreground">
                    {PAYEE_NAME}
                  </strong>
                </dd>
              </div>
            ) : null}

            {footer ? (
              <div className="border-t pt-3 text-sm text-muted-foreground">
                {footer}
              </div>
            ) : null}
          </dl>
        </div>
      </CardContent>
    </Card>
  )
}
