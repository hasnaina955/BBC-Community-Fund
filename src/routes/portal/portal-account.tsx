import { useState } from "react"
import { useMutation } from "convex/react"
import { Link } from "react-router-dom"
import { BadgeCheck, CircleAlert, KeyRound, LogOut, Phone } from "lucide-react"
import { api } from "../../../convex/_generated/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { WithReadModel } from "@/components/shared/read-model"
import { PortalHeader } from "@/components/portal/portal-shell"
import { useMyAccount, usePortalSummary } from "@/data/queries"
import { useCurrentUser } from "@/data/store"
import { useInstallPrompt } from "@/lib/pwa"
import { formatDate } from "@/lib/format"
import { ROLE_LABELS } from "@/lib/types"

/**
 * Linking an account to a member record, and the rest of the account screen.
 *
 * ## Why this screen is mostly an explanation
 *
 * A member who cannot see their balance will assume the app is broken, or that
 * they owe money that does not exist. The single most valuable thing this screen
 * can do is say, precisely, *why* nothing is showing and *what to do next* — so
 * the unlinked state is not a spinner and not an error, it is an instruction
 * with the exact address the community has on file.
 *
 * What it deliberately does not do is let a member browse members, or search for
 * themselves by name. Both would leak the roll — who is in the community, which
 * households, which phone numbers — to anyone who signs up with an email. The
 * claim is a match against the address you already proved you own, or nothing.
 */

export function ClaimCard() {
  const account = useMyAccount()
  const claim = useMutation(api.portal.claim)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClaim = async () => {
    setBusy(true)
    setError(null)
    try {
      await claim({})
    } catch (err) {
      // The server's message is the useful one: it distinguishes "no record uses
      // this address" from "two records do, ask the secretary" from "it is
      // already linked". Re-wording it here would throw that away.
      setError(err instanceof Error ? err.message : "Could not link your account")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PortalHeader
        title="Link your record"
        subtitle="One step before you can see your balance"
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            We could not find a member record for this account. The committee keeps
            the roll, so linking is done by matching the email address on file
            rather than by picking a name out of a list.
          </p>

          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Your account email
            </p>
            <p className="mt-0.5 break-all text-sm font-medium">
              {account?.email ?? "—"}
            </p>
          </div>

          <Button className="h-12 w-full" onClick={onClaim} disabled={busy}>
            <BadgeCheck className="size-5" />
            {busy ? "Looking for your record…" : "This is my record"}
          </Button>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-chart-4" />
              <p className="text-sm">{error}</p>
            </div>
          ) : null}

          <Separator />

          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              <span>
                No match? The secretary can link your account for you — they keep the
                roll, and many members never use an email address at all.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Phone className="mt-0.5 size-4 shrink-0" />
              <span>
                Share a household address with a relative? Say so at the collection
                table and we will record which record is yours. Guessing would show
                you their dues.
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function PortalAccount() {
  const me = useCurrentUser()
  const account = useMyAccount()
  const summary = usePortalSummary()
  const install = useInstallPrompt()

  const isStaff = me.role !== "member"

  return (
    <WithReadModel data={account} label="Loading your account">
      {(data) => (
        <div className="space-y-4">
          <PortalHeader title="Account" subtitle={data.orgName} />

          {isStaff ? (
            <Card className="border-dashed">
              <CardContent className="p-4 text-sm text-muted-foreground">
                You are signed in as {ROLE_LABELS[me.role].toLowerCase()}, so you
                have access to the committee console. A member account sees only
                its own balance.
                <Button asChild variant="link" size="sm" className="mt-2 h-auto p-0">
                  <Link to="/">Go to the console</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-3 p-5">
              <Row label="Name" value={me.name} />
              <Row label="Email" value={me.email} />
              <Row
                label="Role"
                value={
                  <Badge variant="secondary">{ROLE_LABELS[me.role]}</Badge>
                }
              />
              <Row
                label="Member record"
                value={
                  data.memberId ? (
                    <span className="text-right">
                      <span className="block font-medium">{data.memberName}</span>
                      <span className="block text-xs text-muted-foreground">
                        Linked to this account
                      </span>
                    </span>
                  ) : (
                    <span className="text-right text-xs text-muted-foreground">
                      Not linked yet
                    </span>
                  )
                }
              />
              {data.memberId ? (
                <Row
                  label="Member since"
                  value={
                    summary
                      ? formatDate(
                          new Date(
                            Date.UTC(summary.member.joinedYear, summary.member.joinedMonth - 1, 1),
                          ).toISOString(),
                        )
                      : "—"
                  }
                />
              ) : null}
              {summary?.member.phone ? (
                <Row label="Phone on file" value={summary.member.phone} />
              ) : null}
            </CardContent>
          </Card>

          {install.installed ? (
            <Card className="border-chart-3/40 bg-chart-3/5">
              <CardContent className="p-4 text-sm">
                Installed. This opens from your home screen like any other app.
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Who can see this</p>
              <p>
                You see your own dues, your own receipts and your own claims.
                Nothing about anyone else in the community is visible from this
                account, and your balance is never cached on the device — it is read
                from the committee's books every time you open it.
              </p>
              <p>
                Something wrong? Ask the treasurer to check the record. They can see
                which record is linked to your account and change it.
              </p>
            </CardContent>
          </Card>

          <Button asChild variant="outline" className="w-full">
            <Link to="/auth">
              <LogOut className="size-4" />
              Switch account
            </Link>
          </Button>
        </div>
      )}
    </WithReadModel>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{value}</span>
    </div>
  )
}
