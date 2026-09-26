import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Search, Wallet } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { FundTypeBadge } from "@/components/shared/status-badge"
import { useActions, useData } from "@/data/store"
import { fundSummaries } from "@/lib/selectors"
import { formatPaise, percent } from "@/lib/format"
import { FUND_TYPE_LABELS, type FundType } from "@/lib/types"
import { cn } from "@/lib/utils"

const TYPES = Object.keys(FUND_TYPE_LABELS) as FundType[]

export default function Funds() {
  const data = useData()
  const { addFund } = useActions()
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | FundType>("all")
  const [name, setName] = useState("")
  const [type, setType] = useState<FundType>("general")
  const [monthly, setMonthly] = useState("500")

  const summaries = useMemo(
    () => fundSummaries(data.ledgerEntries, data.funds),
    [data.ledgerEntries, data.funds],
  )

  const filtered = summaries.filter((fund) => {
    const matchesQuery = fund.name
      .toLowerCase()
      .includes(query.trim().toLowerCase())
    const matchesType = typeFilter === "all" || fund.type === typeFilter
    return matchesQuery && matchesType
  })

  const total = summaries.reduce((acc, f) => acc + f.balancePaise, 0)

  const handleCreate = () => {
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    addFund({ name: trimmed, type, monthlyRupees: Number(monthly) || 0 })
    setName("")
    setMonthly("500")
    setType("general")
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funds"
        description="Each fund holds a purpose, a bank account, and a manager."
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> Add fund
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add fund</AlertDialogTitle>
              <AlertDialogDescription>
                Give the fund a name and type. It can be linked to a bank account
                later.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fund-name">Fund name</Label>
                <Input
                  id="fund-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ramadan relief fund"
                />
              </div>

              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as FundType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {FUND_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fund-monthly">Monthly amount (₹)</Label>
                <Input
                  id="fund-monthly"
                  inputMode="numeric"
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value.replace(/[^0-9]/g, ""))}
                />
                <p className="text-xs text-muted-foreground">
                  Leave at 0 if members do not contribute to this fund.
                </p>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCreate}
                disabled={name.trim().length < 2}
              >
                Create fund
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageHeader>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search funds"
              className="pl-9"
            />
          </div>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as "all" | FundType)}
          >
            <SelectTrigger className="sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FUND_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground sm:text-right">
            <span className="tabular font-medium text-foreground">
              {formatPaise(total)}
            </span>{" "}
            across {filtered.length} fund{filtered.length === 1 ? "" : "s"}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No funds match"
          description="Try a different search or filter, or create a new fund."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((fund) => {
            const bank = data.banks.find((b) => b.id === fund.bankId)
            const manager = data.users.find((u) => u.id === fund.managerId)
            return (
              <Card
                key={fund.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/funds/${fund.id}`}
                        className="block truncate font-semibold hover:underline"
                      >
                        {fund.name}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {fund.description ?? "No description"}
                      </p>
                    </div>
                    <FundTypeBadge type={fund.type} />
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Balance
                    </p>
                    <p
                      className={cn(
                        "tabular text-2xl font-semibold",
                        fund.balancePaise < 0 && "text-destructive",
                      )}
                    >
                      {formatPaise(fund.balancePaise)}
                    </p>
                  </div>

                  {fund.targetPaise ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {percent(fund.balancePaise, fund.targetPaise).toFixed(0)}%
                          of target
                        </span>
                        <span className="tabular">
                          {formatPaise(fund.targetPaise)}
                        </span>
                      </div>
                      <Progress value={fund.progressPaise ?? 0} />
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span className="truncate">{bank?.name ?? "No bank linked"}</span>
                    <span className="shrink-0">{manager?.name ?? "—"}</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
