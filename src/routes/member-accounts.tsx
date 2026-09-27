import { useMemo, useState } from "react"
import { useMutation } from "convex/react"
import {
  CircleCheck,
  CircleSlash,
  Link2,
  Link2Off,
  Search,
  UserRound,
  Users,
} from "lucide-react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { useAccountStatus } from "@/data/queries"
import { useCurrentUser } from "@/data/store"
import { canEditBooks } from "@/lib/types"
import { ROLE_LABELS, type Role } from "@/lib/types"

/**
 * Who has a portal account, and — the part that matters — who does not.
 *
 * This is an M3 exit criterion ("a treasurer can see which members have claimed
 * accounts"), and the useful version of it is the inverse. A member without an
 * account cannot see their own balance, will not know they owe anything, and will
 * not chase anyone about it. The committee is therefore blind to them in a way it
 * does not realise, and the number that matters is the "still unlinked" count, not
 * the "claimed" one.
 *
 * ## Why linking is a treasurer's job and not only the member's
 *
 * The portal's self-claim matches on a verified email against the address on
 * file. That is right when it works and useless when it does not: a large share of
 * this community's members have no email at all, several households share one
 * address, and the secretary is the person who actually knows that Iqbal and
 * Yusuf are brothers and not the same person. Refusing an ambiguous match is the
 * only safe behaviour, and it means somebody has to break the tie — so that
 * somebody is given the tool to do it here.
 *
 * Every link and unlink is written to the audit log with the address involved,
 * because "who can see whose dues" is exactly the question an audit exists to
 * answer.
 */
export default function MemberAccounts() {
  const me = useCurrentUser()
  const data = useAccountStatus()
  const assign = useMutation(api.portal.assignAccount)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<{
    id: string
    name: string
    email: string
    linked: boolean
  } | null>(null)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canLink = canEditBooks(me.role)

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? all.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            (r.email ?? "").toLowerCase().includes(needle) ||
            (r.accountEmail ?? "").toLowerCase().includes(needle) ||
            (r.phone ?? "").toLowerCase().includes(needle),
        )
      : all
    // Unlinked first: that is the list worth working through.
    return [...filtered].sort((a, b) => {
      if ((a.userId === null) !== (b.userId === null)) return a.userId === null ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [data, query])

  const submit = async (unlink: boolean) => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await assign({
        memberId: editing.id as Id<"members">,
        // An empty string is the documented "unlink" signal, so both directions
        // produce the same kind of audit row.
        userEmail: unlink ? "" : input.trim(),
      })
      setEditing(null)
      setInput("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the link")
    } finally {
      setBusy(false)
    }
  }

  return (
    <WithReadModel data={data} label="Loading the member list">
      {(model) => (
        <div className="space-y-6">
          <PageHeader
            title="Member accounts"
            description="Who can see their own balance in the member portal, and who cannot yet."
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="With an account"
              value={String(model.linked)}
              hint="Can see their own balance"
              icon={CircleCheck}
            />
            <StatCard
              label="Still to claim"
              value={String(model.unlinked)}
              hint="Cannot see what they owe"
              icon={CircleSlash}
            />
            <StatCard
              label="Active members"
              value={String(model.unlinkedActive)}
              hint="Active, and no way to check"
              icon={Users}
            />
          </div>

          {model.unlinkedActive > 0 ? (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4 text-sm">
                <p className="font-medium">
                  {model.unlinkedActive} active{" "}
                  {model.unlinkedActive === 1 ? "member has" : "members have"} no
                  account
                </p>
                <p className="mt-1 text-muted-foreground">
                  They will not see an arrears figure, and will not chase anyone
                  about one. Link them below, or ask them to sign up with the email
                  address on their record and claim it themselves.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone or email"
              className="pl-9"
            />
          </div>

          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    On file
                  </th>
                  <th className="px-4 py-2.5 font-medium">Portal</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No member matches “{query}”.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {r.email ?? r.phone ?? "—"}
                        </p>
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                        {r.email ?? "—"}
                        {r.phone ? (
                          <span className="block text-xs">{r.phone}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.userId ? (
                          <div className="space-y-1">
                            <Badge variant="success">
                              <Link2 className="size-3" />
                              Linked
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              {r.accountEmail}
                            </p>
                            {r.accountRole && r.accountRole !== ("member" as Role) ? (
                              <Badge variant="outline" className="text-[10px]">
                                {ROLE_LABELS[r.accountRole]}
                              </Badge>
                            ) : null}
                          </div>
                        ) : (
                          <Badge variant="outline">
                            <UserRound className="size-3" />
                            Not claimed
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canLink ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing({
                                id: r.id,
                                name: r.name,
                                email: r.accountEmail ?? "",
                                linked: r.userId !== null,
                              })
                              setInput(r.accountEmail ?? r.email ?? "")
                              setError(null)
                            }}
                          >
                            {r.userId ? "Change" : "Link"}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Dialog
            open={editing !== null}
            onOpenChange={(open: boolean) => !open && setEditing(null)}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing?.linked ? "Change" : "Link"} the account for{" "}
                  {editing?.name}
                </DialogTitle>
                <DialogDescription>
                  The account must already exist — the member signs up first, then
                  you match the address. One account links to one record.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="account-email">Account email</Label>
                <Input
                  id="account-email"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="member@example.org"
                />
                {editing?.linked ? (
                  <p className="text-xs text-muted-foreground">
                    Clearing this box and saving unlinks the account. The member
                    loses access to their own balance and cannot see it again until
                    someone relinks it.
                  </p>
                ) : null}
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </div>

              <DialogFooter>
                {editing?.linked ? (
                  <Button
                    variant="outline"
                    onClick={() => submit(true)}
                    disabled={busy}
                  >
                    <Link2Off className="size-4" />
                    Unlink
                  </Button>
                ) : null}
                <Button onClick={() => submit(false)} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </WithReadModel>
  )
}
