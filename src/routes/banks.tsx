import { useState } from "react"
import { useMutation } from "convex/react"
import { Building2, Pencil } from "lucide-react"
import { api } from "../../convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BankDetailsPanel } from "@/components/shared/bank-details"
import { useCurrentUser } from "@/data/store"
import { canEditBooks } from "@/lib/types"
import type { Id } from "../../convex/_generated/dataModel"
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
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { WithReadModel } from "@/components/shared/read-model"
import { CollectionModeBadge } from "@/components/shared/status-badge"
import { useBankPassbook, useBanks } from "@/data/queries"
import { CURRENT_YEAR } from "@/data/period"
import { useYearRange } from "@/data/queries"
import { formatPaise, formatDate, monthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The account balance is the materialised `balances` row for that bank, and the
 * passbook is one index-range read of the current year — the server derives the
 * opening balance from the closing balance minus the year's movements rather
 * than scanning back to 2018.
 */
export default function Banks() {
  const years = useYearRange()
  const model = useBanks()
  const me = useCurrentUser()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [editing, setEditing] = useState(false)

  // The picker offers every year the community has members in. Until that range
  // arrives it offers this one, which always exists.
  const selectable = years ?? [CURRENT_YEAR]

  // Derived before the render prop, because the passbook query is a hook and
  // hooks cannot live inside a conditional callback.
  const needle = query.trim().toLowerCase()
  const filtered = (model ?? []).filter((b) =>
    b.name.toLowerCase().includes(needle),
  )
  const activeId = selected ?? filtered[0]?.id ?? null
  const active = filtered.find((b) => b.id === activeId) ?? null
  const passbook = useBankPassbook(activeId, year)

  return (
    <WithReadModel data={model} label="Loading accounts">
      {() => {
        return (
          <div className="space-y-6">
            <PageHeader
              title="Banks"
              description="Account balances are summed from ledger entries, not typed in by hand."
            />

            {filtered.length === 0 ? (
              <div className="space-y-4">
                {/* The search box has to live outside the result branch. Inside
                    it, a search that matched nothing unmounted the only control
                    that could undo the search, stranding the treasurer on an
                    empty screen with no way back but a reload. */}
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts"
                  className="max-w-xs"
                />
                <EmptyState
                  icon={Building2}
                  title="No accounts match"
                  description="Try a different search — or clear the box above."
                />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-3">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search accounts"
                  />
                  {filtered.map((bank) => (
                    <button
                      key={bank.id}
                      onClick={() => setSelected(bank.id)}
                      className={cn(
                        "w-full rounded-xl border p-4 text-left transition-colors",
                        bank.id === activeId
                          ? "border-primary bg-accent/40"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{bank.name}</p>
                          {bank.branch ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {bank.branch}
                            </p>
                          ) : null}
                        </div>
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <p
                        className={cn(
                          "tabular mt-3 text-xl font-semibold",
                          bank.balancePaise < 0 && "text-destructive",
                        )}
                      >
                        {formatPaise(bank.balancePaise)}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="space-y-4 lg:col-span-2">
                  {active ? (
                    <>
                      <Card>
                        <CardContent className="p-5">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                Account balance
                              </p>
                              <p className="tabular text-3xl font-semibold">
                                {formatPaise(active.balancePaise)}
                              </p>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {active.accountNumber ? (
                                <p className="tabular">
                                  A/C {active.accountNumber}
                                </p>
                              ) : null}
                              {active.ifscCode ? <p>{active.ifscCode}</p> : null}
                              {canEditBooks(me.role) ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 h-7"
                                  onClick={() => setEditing(true)}
                                  data-testid="edit-bank"
                                >
                                  <Pencil className="mr-1.5 size-3" />
                                  Edit details
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          {active.allocation.length > 0 ? (
                            <div className="mt-5 border-t pt-4">
                              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Drawn on by {active.allocation.length} fund
                                {active.allocation.length === 1 ? "" : "s"}
                              </p>
                              <div className="space-y-1.5">
                                {active.allocation.map((fund) => (
                                  <div
                                    key={fund.fundId}
                                    className="flex items-center justify-between gap-2 text-sm"
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span className="truncate text-muted-foreground">
                                        {fund.name}
                                      </span>
                                      <CollectionModeBadge
                                        mode={fund.collectionMode}
                                      />
                                    </span>
                                    <span className="tabular shrink-0 font-medium">
                                      {formatPaise(fund.balancePaise)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {active.notes ? (
                            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                              {active.notes}
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>

                      {/*
                        The account members are told to pay into, with the QR
                        that does it. This is a printed instruction, not a
                        checkout: the app does not take the money and never
                        learns that it arrived, so the QR carries no amount and
                        the treasurer records what lands by hand at the desk
                        below. See src/lib/upi.ts.
                      */}
                      {active.accountNumber || active.upiId ? (
                        <BankDetailsPanel
                          account={{
                            name: active.name,
                            branch: active.branch,
                            accountNumber: active.accountNumber,
                            ifscCode: active.ifscCode,
                            upiId: active.upiId,
                            fundNames: active.allocation.map((f) => f.name),
                          }}
                          testId="bank-details"
                          footer={
                            <p>
                              Members pay from their own UPI app. Nothing is
                              recorded until the treasurer enters it at the
                              collection desk, so keep the reference the member
                              sends with it.
                            </p>
                          }
                        />
                      ) : null}

                      <Card>
                        <CardContent className="p-0">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                            <div>
                              <p className="font-medium">Passbook</p>
                              <p className="text-xs text-muted-foreground">
                                Every entry that touched this account in {year}
                              </p>
                            </div>
                            <Select
                              value={String(year)}
                              onValueChange={(v) => setYear(Number(v))}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {selectable.map((y) => (
                                  <SelectItem key={y} value={String(y)}>
                                    {y}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {passbook === undefined ? (
                            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                              Loading the {year} passbook…
                            </p>
                          ) : passbook.entries.length === 0 ? (
                            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                              No entries on this account in {year}.
                            </p>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-4 border-b px-5 py-3 text-xs sm:grid-cols-4">
                                <p>
                                  <span className="block text-muted-foreground">
                                    Opening
                                  </span>
                                  <span className="tabular font-medium">
                                    {formatPaise(passbook.openingPaise)}
                                  </span>
                                </p>
                                <p>
                                  <span className="block text-muted-foreground">
                                    In
                                  </span>
                                  <span className="tabular font-medium text-chart-3">
                                    {formatPaise(passbook.totalCreditPaise)}
                                  </span>
                                </p>
                                <p>
                                  <span className="block text-muted-foreground">
                                    Out
                                  </span>
                                  <span className="tabular font-medium text-destructive">
                                    {formatPaise(passbook.totalDebitPaise)}
                                  </span>
                                </p>
                                <p>
                                  <span className="block text-muted-foreground">
                                    Closing
                                  </span>
                                  <span className="tabular font-medium">
                                    {formatPaise(passbook.closingPaise)}
                                  </span>
                                </p>
                              </div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Details</TableHead>
                                    <TableHead className="text-right">
                                      Credit
                                    </TableHead>
                                    <TableHead className="text-right">
                                      Debit
                                    </TableHead>
                                    <TableHead className="text-right">
                                      Balance
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {passbook.entries.map((entry) => (
                                    <TableRow key={entry.id}>
                                      <TableCell className="whitespace-nowrap text-muted-foreground">
                                        {formatDate(entry.date)}
                                      </TableCell>
                                      <TableCell className="max-w-72">
                                        <span className="block truncate font-medium">
                                          {entry.note}
                                        </span>
                                        <span className="text-xs capitalize text-muted-foreground">
                                          {entry.source.replace("_", " ")} ·{" "}
                                          {monthLabel(
                                            new Date(
                                              entry.date,
                                            ).getUTCMonth() + 1,
                                          )}{" "}
                                          {new Date(
                                            entry.date,
                                          ).getUTCFullYear()}
                                        </span>
                                      </TableCell>
                                      <TableCell className="tabular text-right text-chart-3">
                                        {entry.amountPaise > 0
                                          ? formatPaise(entry.amountPaise)
                                          : ""}
                                      </TableCell>
                                      <TableCell className="tabular text-right text-destructive">
                                        {entry.amountPaise < 0
                                          ? formatPaise(-entry.amountPaise)
                                          : ""}
                                      </TableCell>
                                      <TableCell className="tabular text-right font-medium">
                                        {formatPaise(entry.closingPaise)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            <EditBankDialog
              bank={
                active
                  ? {
                      id: active.id,
                      name: active.name,
                      branch: active.branch,
                      accountNumber: active.accountNumber,
                      ifscCode: active.ifscCode,
                      upiId: active.upiId,
                    }
                  : null
              }
              open={editing}
              onOpenChange={setEditing}
            />
          </div>
        )
      }}
    </WithReadModel>
  )
}

/**
 * Where the UPI address is set.
 *
 * It is a plain field on a bank account rather than a global setting because
 * each account has its own VPA — a UPI address belongs to the bank account that
 * issued it, and an organisation with a general fund, a zakat fund and a
 * building fund across three branches has three addresses, not one.
 *
 * The validation message matters more than usual here. A VPA that is one
 * character wrong produces a QR that scans perfectly and sends the money to a
 * stranger, and the person who finds out is a member who believed the sign on
 * the wall. So the address is checked on the way in
 * (`normaliseUpiId` in `convex/funds.ts`) as well as here, and the error is
 * shown next to the field rather than as a toast that disappears.
 */
function EditBankDialog({
  bank,
  open,
  onOpenChange,
}: {
  bank: {
    id: string
    name: string
    branch: string | null
    accountNumber: string | null
    ifscCode: string | null
    upiId: string | null
  } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useMutation(api.funds.updateBank)
  const [name, setName] = useState("")
  const [branch, setBranch] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [ifsc, setIfsc] = useState("")
  const [upiId, setUpiId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the form when the dialog opens, so it always shows the account that is
  // actually selected rather than whatever was typed last.
  const [seeded, setSeeded] = useState<string | null>(null)
  if (open && bank && seeded !== bank.id) {
    setSeeded(bank.id)
    setName(bank.name)
    setBranch(bank.branch ?? "")
    setAccountNumber(bank.accountNumber ?? "")
    setIfsc(bank.ifscCode ?? "")
    setUpiId(bank.upiId ?? "")
    setError(null)
  }

  if (!bank) return null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await update({
        bankId: bank.id as Id<"banks">,
        name,
        branch,
        accountNumber,
        ifscCode: ifsc,
        upiId,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSeeded(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Account details</DialogTitle>
          <DialogDescription>
            What members are told to pay into. The UPI address is what the QR
            code is built from.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bank-name">Account name</Label>
            <Input
              id="bank-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-branch">Branch</Label>
            <Input
              id="bank-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-account">Account number</Label>
            <Input
              id="bank-account"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-ifsc">IFSC</Label>
            <Input
              id="bank-ifsc"
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              className="tabular"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-upi">UPI address</Label>
            <Input
              id="bank-upi"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="bbc@okicici"
              className="tabular"
              data-testid="bank-upi-input"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to print the account without a QR code.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid="bank-upi-error">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || name.trim().length < 2}
            data-testid="bank-save"
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
