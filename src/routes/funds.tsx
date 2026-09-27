import { useState } from "react"
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
import {
  CollectionModeBadge,
  FundTypeBadge,
} from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useActions, useCurrentUser } from "@/data/store"
import { useFunds } from "@/data/queries"
import { formatPaise, percent } from "@/lib/format"
import {
  canEditBooks,
  COLLECTION_MODE_HINTS,
  COLLECTION_MODE_LABELS,
  FUND_TYPE_LABELS,
  type CollectionMode,
  type FundType,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const TYPES = Object.keys(FUND_TYPE_LABELS) as FundType[]
const MODES = Object.keys(COLLECTION_MODE_LABELS) as CollectionMode[]

/**
 * Balances, targets and progress all come from `aggregate:funds`, which reads
 * the materialised `balances` table rather than summing the ledger — so this
 * screen is O(funds) on the server instead of O(entries).
 *
 * The fund editor asks for a **collection mode** first, because it is the
 * decision that determines everything else about the fund: a `fixed_monthly`
 * fund will grow dues, arrears and a collection grid; a `voluntary` one never
 * will.
 */
export default function Funds() {
  const { addFund } = useActions()
  const me = useCurrentUser()
  const model = useFunds()
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | FundType>("all")
  const [modeFilter, setModeFilter] = useState<"all" | CollectionMode>("all")
  const [name, setName] = useState("")
  const [type, setType] = useState<FundType>("general")
  const [mode, setMode] = useState<CollectionMode>("fixed_monthly")
  const [monthly, setMonthly] = useState("100")
  const [target, setTarget] = useState("")
  const [error, setError] = useState<string | null>(null)

  const canCreate = canEditBooks(me.role)

  return (
    <WithReadModel data={model} label="Loading funds">
      {(funds) => {
        const needle = query.trim().toLowerCase()
        const filtered = funds.filter((fund) => {
          if (needle && !fund.name.toLowerCase().includes(needle)) return false
          if (typeFilter !== "all" && fund.type !== typeFilter) return false
          if (modeFilter !== "all" && fund.collectionMode !== modeFilter) {
            return false
          }
          return true
        })
        const total = funds.reduce((acc, f) => acc + f.balancePaise, 0)

        const handleCreate = async () => {
          const trimmed = name.trim()
          if (trimmed.length < 2) return
          setError(null)
          try {
            await addFund({
              name: trimmed,
              type,
              collectionMode: mode,
              monthlyRupees:
                mode === "fixed_monthly" ? Number(monthly) || 0 : 0,
              targetRupees: target ? Number(target) : undefined,
            })
            setName("")
            setTarget("")
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "That fund could not be created.",
            )
          }
        }

        return (
          <div className="space-y-6">
            <PageHeader
              title="Funds"
              description="Each fund holds a purpose, a collection mode, a bank account, and a manager."
            >
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  {/* Only a treasurer may create a fund; offering the dialog to
                      a viewer produced a form whose submit button could only
                      ever be refused by the server. */}
                  {canCreate ? (
                    <Button size="sm">
                      <Plus className="size-4" /> Add fund
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled title="Treasurer access required">
                      <Plus className="size-4" /> Add fund
                    </Button>
                  )}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Add fund</AlertDialogTitle>
                    <AlertDialogDescription>
                      The collection mode decides whether members owe this fund
                      anything. It cannot be changed later without consequences,
                      so pick the one that matches how it will actually be
                      collected.
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
                      <Label>How is it collected?</Label>
                      <Select
                        value={mode}
                        onValueChange={(v) => setMode(v as CollectionMode)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {COLLECTION_MODE_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {COLLECTION_MODE_HINTS[mode]}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select
                        value={type}
                        onValueChange={(v) => setType(v as FundType)}
                      >
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

                    {mode === "fixed_monthly" ? (
                      <div className="space-y-2">
                        <Label htmlFor="fund-monthly">
                          Monthly amount per member (₹)
                        </Label>
                        <Input
                          id="fund-monthly"
                          inputMode="numeric"
                          value={monthly}
                          onChange={(e) =>
                            setMonthly(e.target.value.replace(/[^0-9]/g, ""))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Only this mode produces dues, arrears and a collection
                          grid.
                        </p>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <Label htmlFor="fund-target">Target amount (₹)</Label>
                      <Input
                        id="fund-target"
                        inputMode="numeric"
                        value={target}
                        onChange={(e) =>
                          setTarget(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleCreate()}
                      disabled={name.trim().length < 2}
                    >
                      Create fund
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </PageHeader>

            {error ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Card>
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
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
                  value={modeFilter}
                  onValueChange={(v) => setModeFilter(v as "all" | CollectionMode)}
                >
                  <SelectTrigger className="lg:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any collection mode</SelectItem>
                    {MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {COLLECTION_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={typeFilter}
                  onValueChange={(v) => setTypeFilter(v as "all" | FundType)}
                >
                  <SelectTrigger className="lg:w-52">
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
                <div className="text-sm text-muted-foreground lg:text-right">
                  <span className="tabular font-medium text-foreground">
                    {formatPaise(total)}
                  </span>{" "}
                  across {filtered.length} fund
                  {filtered.length === 1 ? "" : "s"}
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
                {filtered.map((fund) => (
                  <Card key={fund.id} className="transition-shadow hover:shadow-md">
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

                      <div className="flex flex-wrap items-center gap-2">
                        <CollectionModeBadge mode={fund.collectionMode} />
                        {fund.collectionMode === "fixed_monthly" &&
                        fund.monthlyAmountPaise ? (
                          <span className="tabular text-xs text-muted-foreground">
                            {formatPaise(fund.monthlyAmountPaise)}/member/month
                          </span>
                        ) : null}
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

                      {fund.targetAmountPaise ? (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>
                              {percent(
                                fund.balancePaise,
                                fund.targetAmountPaise,
                              ).toFixed(0)}
                              % of target
                            </span>
                            <span className="tabular">
                              {formatPaise(fund.targetAmountPaise)}
                            </span>
                          </div>
                          <Progress value={fund.progressPaise ?? 0} />
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <span className="truncate">
                          {fund.bankName ?? "No bank linked"}
                        </span>
                        <span className="shrink-0">
                          {fund.managerName ?? "—"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      }}
    </WithReadModel>
  )
}
