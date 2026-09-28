import { useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import {
  BellRing,
  CalendarClock,
  CircleAlert,
  Clock,
  History,
  Mail,
  MessageSquare,
  Send,
  ShieldOff,
  Smartphone,
  Users,
} from "lucide-react"
import { api } from "../../convex/_generated/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatCard, EmptyState } from "@/components/shared/stat-card"
import { PageHeader } from "@/components/shared/page-header"
import { ReadModelLoader } from "@/components/shared/read-model"
import { formatPaise, formatDateTime } from "@/lib/format"

/**
 * Reminders and arrears.
 *
 * This is the screen a treasurer opens on the 11th of the month, and the thing
 * it has to answer is narrow: **who has not paid, and what have we already said
 * to them?** Everything else here serves that.
 *
 * ## Why the ageing is by days, not by months
 *
 * Someone owing ₹100 from 2019 and someone owing ₹1,000 from last month are both
 * "3+ months" under month-counting, and they are not remotely the same problem.
 * The buckets are the standard receivables presentation — current, 30, 60, 90+ —
 * and they come from `lib/arrears`, which the reports page already uses. If the
 * two screens had their own copy of the rule they would eventually disagree
 * about who is a defaulter, and that is a bug you find in front of a committee.
 *
 * ## What this screen does not do
 *
 * **It does not send anything yet.** No notification provider is configured
 * (`lib/notify.ts` ships an offline stub), so pressing *Remind everyone* writes
 * a campaign and queues the messages — the rendered text, the channel, the
 * destination, and the reason anybody was skipped — and stops there. That is
 * deliberate: the record of who we chased is worth having whether or not a
 * message went anywhere, and it means the day a provider is chosen this screen
 * has to change by one button, not by a new page.
 */

const KIND_LABEL: Record<string, string> = {
  due_soon: "Due soon",
  overdue: "Overdue",
  arrears_summary: "Arrears summary",
}

const KIND_HINT: Record<string, string> = {
  due_soon: "Nothing is late yet — a note before the 10th",
  overdue: "One or two months behind; names the month missed",
  arrears_summary: "Three months or more; offers to arrange something",
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: Smartphone,
}

const STATUS_TONE: Record<string, string> = {
  queued: "text-muted-foreground",
  sent: "text-chart-3",
  delivered: "text-chart-3",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
}

type SortKey = "oldest" | "newest" | "amount" | "name"

export default function Reminders() {
  const [sort, setSort] = useState<SortKey>("oldest")
  const [search, setSearch] = useState("")
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null)
  const [preview, setPreview] = useState<typeof plan | null>(null)
  const [confirming, setConfirming] = useState(false)

  const defaulters = useQuery(api.reminders.defaulters, { sort })
  const plan = useQuery(api.reminders.preview, {})
  const runs = useQuery(api.reminders.campaigns, {})
  const run = useMutation(api.reminders.runCampaign)
  const [outcome, setOutcome] = useState<string | null>(null)

  const rows = useMemo(() => {
    const all = defaulters?.rows ?? []
    const needle = search.trim().toLowerCase()
    return needle ? all.filter((r) => r.name.toLowerCase().includes(needle)) : all
  }, [defaulters?.rows, search])

  if (defaulters === undefined || plan === undefined) {
    return <ReadModelLoader label="Loading arrears" />
  }

  const hasProvider = defaulters.providerConfigured

  async function confirmRun() {
    if (!confirming) return
    setConfirming(false)
    const result = await run({ kind: "overdue" })
    if (result) {
      setOutcome(
        result.replayed
          ? "This period has already been run — nothing was sent twice."
          : `${result.queued} reminder${result.queued === 1 ? "" : "s"} queued, ` +
              `${result.skipped} member${result.skipped === 1 ? "" : "s"} skipped.`,
      )
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminders"
        description="Who owes what, how long it has been outstanding, and who has already been chased."
      >
        <Button
          variant="outline"
          onClick={() => setPreview(plan ?? null)}
          disabled={!plan || plan.wouldQueue === 0}
        >
          <CalendarClock className="size-4" />
          Preview this month&rsquo;s run
        </Button>
        <Button onClick={() => setConfirming(true)} disabled={!plan || plan.wouldQueue === 0}>
          <Send className="size-4" />
          Remind everyone unpaid
        </Button>
      </PageHeader>

      {!hasProvider ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldOff className="size-4 text-chart-4" />
              No message provider is connected yet
            </CardTitle>
            <CardDescription>
              A run below is still recorded in full — who it would have chased, on which
              channel, and the exact text each person would have received. Nothing leaves
              this building until a provider is configured, and that is a decision for the
              committee rather than a missing setting.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {outcome ? (
        <p
          className="rounded-lg border border-chart-3/40 bg-chart-3/5 px-3 py-2 text-sm"
          data-testid="run-outcome"
        >
          {outcome}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Outstanding"
          value={formatPaise(defaulters.totalPaise)}
          hint={`across ${defaulters.totalMembers} member${defaulters.totalMembers === 1 ? "" : "s"}`}
          icon={CircleAlert}
          tone={defaulters.totalPaise > 0 ? "negative" : "positive"}
        />
        <StatCard
          label="Would be chased"
          value={String(plan.wouldQueue)}
          hint={`${plan.wouldSkip} skipped this period`}
          icon={BellRing}
        />
        <StatCard
          label="By SMS"
          value={String(plan.byChannel.sms ?? 0)}
          hint={`${plan.byChannel.email ?? 0} by email, ${plan.byChannel.whatsapp ?? 0} by WhatsApp`}
          icon={MessageSquare}
        />
        <StatCard
          label="Last run"
          value={defaulters.lastCampaignAt ? formatDateTime(defaulters.lastCampaignAt) : "never"}
          hint={
            defaulters.lastCampaignAt
              ? "see the history below"
              : "no one has been chased yet"
          }
          icon={Clock}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ageing</CardTitle>
          <CardDescription>
            Buckets are by days past the 10th, not by how many months a member happens to
            owe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {defaulters.buckets.map((bucket) => (
              <div
                key={bucket.key}
                className="rounded-lg border px-3 py-2"
                data-testid={`bucket-${bucket.key}`}
              >
                <p className="text-xs text-muted-foreground">{bucket.label}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatPaise(bucket.totalPaise)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {bucket.members} member{bucket.members === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Who owes what</CardTitle>
              <CardDescription>
                {rows.length} of {defaulters.rows.length} shown
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name"
                className="h-9 w-48"
                aria-label="Search members by name"
              />
              <Select
                value={sort}
                onValueChange={(v) => setSort(v as SortKey)}
              >
                <SelectTrigger className="h-9 w-48" aria-label="Sort the defaulter list">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oldest">Longest outstanding</SelectItem>
                  <SelectItem value="newest">Most recent</SelectItem>
                  <SelectItem value="amount">Largest amount</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={search ? "Nobody matches that" : "Everyone is paid up"}
              description={
                search
                  ? "No member with outstanding dues matches that name."
                  : "No scheduled fund has an unpaid due. Nothing to chase."
              }
            />
          ) : (
            <Table data-testid="defaulter-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Months</TableHead>
                  <TableHead>Oldest</TableHead>
                  <TableHead>Would send</TableHead>
                  <TableHead>Last chased</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const Icon = CHANNEL_ICON[
                    row.reachEmail ? "email" : row.reachSms ? "sms" : "whatsapp"
                  ] ?? MessageSquare
                  return (
                    <TableRow key={row.memberId} data-days={row.daysPastDue}>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.optedOut ? (
                          <Badge variant="outline" className="ml-2 gap-1">
                            <ShieldOff className="size-3" />
                            opted out
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPaise(row.amountPaise)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.months}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.oldestMonth ?? "—"}
                      </TableCell>
                      <TableCell>
                        {row.optedOut ? (
                          <span className="text-muted-foreground">no — asked not to be</span>
                        ) : !row.reachEmail && !row.reachSms ? (
                          <span className="text-muted-foreground">no contact details</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Icon className="size-3.5" />
                            {KIND_LABEL[row.kind]}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.lastRemindedAt ? (
                          <span className="inline-flex flex-col">
                            <span>{formatDateTime(row.lastRemindedAt)}</span>
                            <span className="text-xs">{row.lastReminderState}</span>
                          </span>
                        ) : (
                          "never"
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setHistoryFor({ id: row.memberId, name: row.name })
                          }
                        >
                          <History className="size-4" />
                          <span className="sr-only">Reminder history for {row.name}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs</CardTitle>
          <CardDescription>
            Every run is on record, whether or not anything was sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(runs?.length ?? 0) === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No runs yet"
              description="Pressing the button records a campaign: who was considered, who was queued, and why anybody was skipped."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">Considered</TableHead>
                  <TableHead className="text-right">Queued</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs!.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>{KIND_LABEL[r.kind]}</TableCell>
                    <TableCell className="text-muted-foreground">{r.trigger}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.considered}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.queued}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.skippedOptOut + r.skippedUnreachable}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remind everyone unpaid?</DialogTitle>
            <DialogDescription>
              {plan.wouldQueue} member{plan.wouldQueue === 1 ? "" : "s"} would be queued a
              reminder this period. {plan.wouldSkip} would be skipped — someone who has asked
              not to be contacted, or who has no email or phone on file.
              {!hasProvider
                ? " No provider is connected, so nothing will actually be sent; the run is recorded."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={confirmRun}>
              <Send className="size-4" />
              Queue {plan.wouldQueue} reminder{plan.wouldQueue === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>What this month&rsquo;s run would do</DialogTitle>
            <DialogDescription>
              Computed from the same code that performs the run, on {plan.asOf.slice(0, 10)}.
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium">{preview.considered}</span> active members
                considered, <span className="font-medium">{preview.wouldQueue}</span> queued,{" "}
                <span className="font-medium">{preview.wouldSkip}</span> skipped.
              </p>
              <ul className="space-y-1 text-muted-foreground">
                {Object.entries(KIND_LABEL).map(([key, label]) => (
                  <li key={key} className="flex justify-between gap-4">
                    <span title={KIND_HINT[key]}>{label}</span>
                    <span className="tabular-nums">{preview.byKind[key] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {historyFor ? (
        <HistoryDialog member={historyFor} onClose={() => setHistoryFor(null)} />
      ) : null}
    </div>
  )
}

function HistoryDialog({
  member,
  onClose,
}: {
  member: { id: string; name: string }
  onClose: () => void
}) {
  const rows = useQuery(api.reminders.history, { memberId: member.id as never })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reminder history — {member.name}</DialogTitle>
          <DialogDescription>
            Every message queued for this member, newest first.
          </DialogDescription>
        </DialogHeader>
        {rows === undefined ? (
          <ReadModelLoader label="Loading history" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Never reminded"
            description="No message has ever been queued for this member."
          />
        ) : (
          <ul className="max-h-80 space-y-3 overflow-y-auto text-sm">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{KIND_LABEL[r.kind]}</span>
                  <span className={STATUS_TONE[r.status]}>{r.status}</span>
                </div>
                <p className="text-muted-foreground">{r.subject}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.channel} → {r.destination} · {formatPaise(r.amountPaise)} ·{" "}
                  {formatDateTime(r.sentAt ?? r.deliveredAt ?? 0)}
                </p>
                {r.failureReason ? (
                  <p className="mt-1 text-xs text-destructive">{r.failureReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
