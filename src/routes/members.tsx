import { useMemo, useState } from "react"
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
import { useData } from "@/data/store"
import { defaulters, paymentsForMember } from "@/lib/selectors"
import { CURRENT_YEAR, MONTHS_ELAPSED } from "@/data/period"
import { formatPaise, formatDate, monthLabel, percent } from "@/lib/format"
import { PAYMENT_METHOD_LABELS, type Member } from "@/lib/types"
import { cn } from "@/lib/utils"

type Filter = "all" | "active" | "inactive" | "arrears" | "clear"

export default function Members() {
  const data = useData()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [detail, setDetail] = useState<Member | null>(null)

  const arrearsByMember = useMemo(() => {
    const map = new Map<string, number>()
    for (const defaulter of defaulters(
      data.contributions,
      data.members,
      CURRENT_YEAR,
      MONTHS_ELAPSED,
    )) {
      map.set(defaulter.member.id, defaulter.outstandingPaise)
    }
    return map
  }, [data.contributions, data.members])

  const duesByMember = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of defaulters(
      data.contributions,
      data.members,
      CURRENT_YEAR,
      MONTHS_ELAPSED,
    )) {
      map.set(d.member.id, d.months.length)
    }
    return map
  }, [data.contributions, data.members])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.members.filter((member) => {
      if (
        needle &&
        !member.name.toLowerCase().includes(needle) &&
        !(member.phone ?? "").includes(needle)
      ) {
        return false
      }
      const arrears = arrearsByMember.get(member.id) ?? 0
      switch (filter) {
        case "active":
          return member.isActive
        case "inactive":
          return !member.isActive
        case "arrears":
          return arrears > 0
        case "clear":
          return arrears === 0
        default:
          return true
      }
    })
  }, [data.members, query, filter, arrearsByMember])

  const activeCount = data.members.filter((m) => m.isActive).length
  const arrearsCount = arrearsByMember.size
  const arrearsTotal = [...arrearsByMember.values()].reduce((a, b) => a + b, 0)

  const memberPayments = detail ? paymentsForMember(data.payments, detail.id) : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Active members appear in the contributions grid."
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
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
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
                {rows.slice(0, 60).map((member) => {
                  const arrears = arrearsByMember.get(member.id) ?? 0
                  const unpaid = duesByMember.get(member.id) ?? 0
                  return (
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
                        {monthLabel(member.joinedMonth)} {member.joinedYear}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.relation ?? "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right",
                          unpaid > 0 && "font-medium text-destructive",
                        )}
                      >
                        {unpaid}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-medium",
                          arrears > 0 ? "text-destructive" : "text-chart-3",
                        )}
                      >
                        {arrears > 0 ? formatPaise(arrears) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog onOpenChange={(o) => !o && setDetail(null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDetail(member)}
                            >
                              Passbook
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="max-w-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {member.name} — passbook
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {member.relation ?? "Member"} · joined{" "}
                                {monthLabel(member.joinedMonth)} {member.joinedYear}
                                {arrears > 0
                                  ? ` · ${formatPaise(arrears)} outstanding`
                                  : " · fully paid up"}
                              </AlertDialogDescription>
                            </AlertDialogHeader>

                            {memberPayments.length === 0 ? (
                              <p className="py-8 text-center text-sm text-muted-foreground">
                                No payments recorded for this member.
                              </p>
                            ) : (
                              <div className="max-h-80 space-y-2 overflow-y-auto">
                                {memberPayments.map((payment) => (
                                  <div
                                    key={payment.id}
                                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">
                                        Receipt {payment.receiptNo}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatDate(payment.paidAt)} ·{" "}
                                        {PAYMENT_METHOD_LABELS[payment.method]}
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
                                    Total received ({memberPayments.length} payments)
                                  </span>
                                  <span className="tabular">
                                    {formatPaise(
                                      memberPayments.reduce(
                                        (acc, p) => acc + p.amountPaise,
                                        0,
                                      ),
                                    )}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Settled{" "}
                                  {percent(
                                    memberPayments.length,
                                    MONTHS_ELAPSED,
                                  ).toFixed(0)}
                                  % of months elapsed this year
                                </p>
                              </div>
                            )}

                            <AlertDialogFooter>
                              <Button asChild variant="outline" size="sm">
                                <Link to="/contributions">Open collection grid</Link>
                              </Button>
                              <Button asChild size="sm">
                                <Link to="/reports">Statements</Link>
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {rows.length > 60 ? (
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                Showing 60 of {rows.length} members. Narrow the search to see
                more.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
