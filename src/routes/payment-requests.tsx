import { useState } from "react"
import { useMutation } from "convex/react"
import { Check, HandCoins, PartyPopper, X } from "lucide-react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PageHeader } from "@/components/shared/page-header"
import { WithReadModel } from "@/components/shared/read-model"
import { usePaymentRequests, useMemberPassbook } from "@/data/queries"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types"

/**
 * The treasurer's side of mark-as-paid: cash a member says they handed over.
 *
 * ## The queue exists because of a real risk
 *
 * "I paid" is an unverifiable claim from someone with an interest in the outcome.
 * Taken at face value it is a way to erase arrears, so this screen deliberately
 * does more than offer an Approve button — it shows the treasurer the member's
 * *current outstanding balance* next to the claimed amount, so the judgement being
 * made is visible at the moment it is made. A claim for ₹500 against a ₹200
 * balance is a plausible overpayment or a mistyped amount; a claim for ₹5,000
 * against a cleared balance is neither.
 *
 * Approving delegates to `recordPaymentFor` — the same writer the desk uses — so
 * the claim cannot produce a payment the collection path would have refused, and
 * cannot double-count: a replayed idempotency key, a fund from another
 * organisation, or an amount that would overdraw all fail the same way they fail
 * at the desk. If approval throws, the request stays pending for someone to look
 * at, which is the correct outcome for a claim nobody could verify.
 *
 * Refusing is status-only and asks for a reason, because "rejected" with no
 * explanation is the kind of thing a member argues about at the collection table
 * rather than at the next committee meeting.
 */
export default function PaymentRequests() {
  const queue = usePaymentRequests()
  const decide = useMutation(api.portal.decideRequest)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const act = async (id: string, approve: boolean) => {
    setBusyId(id)
    setError(null)
    try {
      await decide({
        requestId: id as Id<"paymentRequests">,
        approve,
        note: notes[id]?.trim() || undefined,
      })
      setNotes((n) => {
        const next = { ...n }
        delete next[id]
        return next
      })
    } catch (err) {
      setError({
        id,
        message: err instanceof Error ? err.message : "Could not record that",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <WithReadModel data={queue} label="Loading the queue">
      {(requests) => (
        <div className="space-y-6">
          <PageHeader
            title="Claimed payments"
            description="Cash members say they handed over, waiting for a treasurer to confirm it against what is actually in the drawer."
          />

          {requests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <PartyPopper className="size-6 text-muted-foreground" />
                <p className="font-medium">Nothing waiting</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  No member has claimed an offline payment. When one does, it
                  appears here rather than reaching the books.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3">
              {requests.map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  busy={busyId === r.id}
                  note={notes[r.id] ?? ""}
                  onNote={(v) => setNotes((n) => ({ ...n, [r.id]: v }))}
                  onAct={(approve) => act(r.id, approve)}
                  error={error?.id === r.id ? error.message : null}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </WithReadModel>
  )
}

type QueueRow = {
  id: string
  memberId: string
  memberName: string
  amountPaise: number
  method: string
  paidAt: string
  reference: string | null
  note: string | null
  createdAt: number
}

/**
 * One claim, with the member's own balance beside it.
 *
 * `MemberOutstand` is a separate component because it is a separate query, and a
 * hook cannot live inside a `.map()` in the parent without either violating the
 * rules of hooks or re-subscribing on every render.
 */
function RequestRow({
  request,
  busy,
  note,
  onNote,
  onAct,
  error,
}: {
  request: QueueRow
  busy: boolean
  note: string
  onNote: (value: string) => void
  onAct: (approve: boolean) => void
  error: string | null
}) {
  return (
    <li>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{request.memberName}</p>
              <p className="text-xs text-muted-foreground">
                Claims {formatPaise(request.amountPaise)} by{" "}
                {PAYMENT_METHOD_LABELS[request.method as PaymentMethod] ??
                  request.method}{" "}
                on {formatDate(request.paidAt)}
                {request.reference ? ` · ref ${request.reference}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-xl font-semibold">
                {formatPaise(request.amountPaise)}
              </p>
              <MemberOutstand memberId={request.memberId} />
            </div>
          </div>

          {request.note ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm italic">
              “{request.note}”
            </p>
          ) : null}

          <Separator />

          <div className="space-y-2">
            <Input
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Note — required in practice if you refuse"
              className="h-9 text-sm"
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                onClick={() => onAct(true)}
                disabled={busy}
                className="flex-1"
              >
                <Check className="size-4" />
                {busy ? "Recording…" : "Confirm — write to the books"}
              </Button>
              <Button
                variant="outline"
                onClick={() => onAct(false)}
                disabled={busy}
              >
                <X className="size-4" />
                Refuse
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <HandCoins className="mt-0.5 size-3 shrink-0" />
              Confirming writes a payment, a receipt number and a ledger entry — the
              same ones a payment taken at the desk would.
            </p>
          </div>
        </CardContent>
      </Card>
    </li>
  )
}

/** What this member currently owes, so the claim can be judged against it. */
function MemberOutstand({ memberId }: { memberId: string }) {
  const passbook = useMemberPassbook(memberId)
  if (!passbook) return null

  return (
    <Badge variant="outline" className="mt-1">
      Owes {formatPaise(passbook.outstandingPaise)}
    </Badge>
  )
}
