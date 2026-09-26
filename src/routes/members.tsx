import { useState } from "react"
import { Link } from "react-router-dom"
import { Search, Users } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { useMemberPassbook, useMembers, type MemberFilter } from "@/data/queries"
import { MONTHS_ELAPSED } from "@/data/period"
import { formatPaise, formatDate, monthLabel } from "@/lib/format"
import { PAYMENT_METHOD_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * `arrearsPaise` and `unpaidMonths` come from `aggregate:members`, which only
 * counts dues on `fixed_monthly` funds. A member who gave nothing to the Friday
 * fund shows a clean sheet, which is the truth.
 *
 * The passbook is a *separate* query, fetched only for the member whose dialog
 * is open. Listing 84 members no longer downloads 84 statements.
 */
export default function Members() {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<MemberFilter>("all")
  const [detailId, setDetailId] = useState<string | null>(null)

  const model = useMembers(filter)
  const passbook = useMemberPassbook(detailId)

  return (
    <WithReadModel data={model} label="Loading members">
      {(members) => {
        const needle = query.trim().toLowerCase()
        const rows = members.filter(
          (m) =>
            !needle ||
            m.name.toLowerCase().includes(needle) ||
            (m.phone ?? "").includes(needle),
        )
        const activeCount = members.filter((m) => m.isActive).length
        const arrearsCount = members.filter((m) => m.arrearsPaise > 0).length
        const arrearsTotal = members.reduce(
          (acc, m) => acc + m.arrearsPaise,
          0,
        )

        return (
          <div className="space-y-6">
            <PageHeader
              title="Members"
              description="Active members appear in the monthly collection grid."
            >
              <Badge variant="secondary">{activeCount} active</Badge>
              {arrearsCount > 0 ? (
                <Badge variant="destructive">
                  {arrearsCount} in arrears · {formatPaise(arrearsTotal)}
                </Badge>
              ) : null}
            </PageHeader>

            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or phone"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={filter}
                  onValueChange={(v) => setFilter(v as MemberFilter)}
                >
                  <SelectTrigger className="sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All members</SelectItem>
                    <SelectItem value="active">Active only</SelectItem>
                    <SelectItem value="inactive">Inactive only</SelectItem>
                    <SelectItem value="arrears">In arrears</SelectItem>
                    <SelectItem value="clear">Fully paid up</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {rows.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No members match"
                description="Try a different search or filter."
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead>Relation</TableHead>
                        <TableHead className="text-right">Unpaid months</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 60).map((member) => (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span className="font-medium">{member.name}</span>
                              {!member.isActive ? (
                                <Badge variant="secondary">Inactive</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {member.phone ?? "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {monthLabel(member.joinedMonth)}{" "}
                            {member.joinedYear}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {member.relation ?? "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "tabular text-right",
                              member.unpaidMonths > 0 &&
                                "font-medium text-destructive",
                            )}
                          >
                            {member.unpaidMonths}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "tabular text-right font-medium",
                              member.arrearsPaise > 0
                                ? "text-destructive"
                                : "text-chart-3",
                            )}
                          >
                            {member.arrearsPaise > 0
                              ? formatPaise(member.arrearsPaise)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <AlertDialog
                              onOpenChange={(o) => !o && setDetailId(null)}
                            >
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDetailId(member.id)}
                                >
                                  Passbook
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="max-w-2xl">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {passbook
                                      ? `${passbook.member.name} — passbook`
                                      : "Loading passbook…"}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {passbook
                                      ? `${passbook.member.relation ?? "Member"} · joined ${monthLabel(
                                          passbook.member.joinedMonth,
                                        )} ${passbook.member.joinedYear} · ${
                                          passbook.outstandingPaise > 0
                                            ? `${formatPaise(
                                                passbook.outstandingPaise,
                                              )} outstanding`
                                            : "fully paid up"
                                        }`
                                      : "Fetching this member's receipts."}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>

                                {passbook === undefined || passbook === null ? (
                                  <p className="py-8 text-center text-sm text-muted-foreground">
                                    Loading receipts…
                                  </p>
                                ) : passbook.payments.length === 0 ? (
                                  <p className="py-8 text-center text-sm text-muted-foreground">
                                    No payments recorded for this member.
                                  </p>
                                ) : (
                                  <div className="max-h-80 space-y-2 overflow-y-auto">
                                    {passbook.payments.map((payment) => (
                                      <div
                                        key={payment.id}
                                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                                      >
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-medium">
                                            Receipt {payment.receiptNo}
                                            {payment.fundName
                                              ? ` · ${payment.fundName}`
                                              : ""}
                                          </p>
                                          <p className="text-xs text-muted-foreground">
                                            {formatDate(payment.paidAt)} ·{" "}
                                            {
                                              PAYMENT_METHOD_LABELS[
                                                payment.method
                                              ]
                                            }
                                            {payment.reference
                                              ? ` · ${payment.reference}`
                                              : ""}
                                          </p>
                                        </div>
                                        <span className="tabular shrink-0 text-sm font-semibold text-chart-3">
                                          {formatPaise(payment.amountPaise)}
                                        </span>
                                      </div>
                                    ))}
                                    <div className="flex justify-between border-t pt-3 text-sm font-medium">
                                      <span>
                                        Total received (
                                        {passbook.paymentCount} payments)
                                      </span>
                                      <span className="tabular">
                                        {formatPaise(
                                          passbook.totalReceivedPaise,
                                        )}
                                      </span>
                                    </div>
                                    {passbook.paymentCount >
                                    passbook.payments.length ? (
                                      <p className="text-xs text-muted-foreground">
                                        Showing the{" "}
                                        {passbook.payments.length} most recent of{" "}
                                        {passbook.paymentCount}.
                                      </p>
                                    ) : null}
                                    <p className="text-xs text-muted-foreground">
                                      {passbook.unpaidMonths} month
                                      {passbook.unpaidMonths === 1 ? "" : "s"}{" "}
                                      outstanding on the monthly fund ·{" "}
                                      {MONTHS_ELAPSED} months elapsed this year
                                    </p>
                                  </div>
                                )}

                                <AlertDialogFooter>
                                  <Button asChild variant="outline" size="sm">
                                    <Link to="/contributions">
                                      Open collection grid
                                    </Link>
                                  </Button>
                                  <Button asChild size="sm">
                                    <Link to="/reports">Statements</Link>
                                  </Button>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {rows.length > 60 ? (
                    <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                      Showing 60 of {rows.length} members. Narrow the search to
                      see more.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>
        )
      }}
    </WithReadModel>
  )
}
