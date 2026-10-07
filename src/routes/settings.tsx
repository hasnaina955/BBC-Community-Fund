import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Download, Loader2, Lock, Settings as SettingsIcon, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { CollectionModeBadge } from "@/components/shared/status-badge"
import { ReadModelLoader } from "@/components/shared/read-model"
import { useAuditLog, useExportFile, useExportFiles, useFunds } from "@/data/queries"
import { useCurrentUser } from "@/data/store"
import { formatDateTime, formatPaise } from "@/lib/format"
import { COLLECTION_MODE_HINTS, COLLECTION_MODE_LABELS } from "@/lib/types"
import { downloadCsv, toCsv, type CsvValue } from "@/lib/csv"
import type { ExportKey } from "../../convex/lib/exportfiles"

/**
 * The admin screen. The organisation name comes from the signed-in session, the
 * fund list from `aggregate:funds`, and the audit trail from `aggregate:audit`
 * with actor names already resolved.
 *
 * The collection rules card is where the community's real convention is
 * written down — which funds carry dues, and which are simply collected.
 */
export default function Settings() {
  const me = useCurrentUser()
  const fundsModel = useFunds()
  const auditModel = useAuditLog()
  const exportFiles = useExportFiles()

  // The one file the treasurer has asked for, if any. Nothing is fetched until
  // a button is pressed: this is the only query in the app that returns history
  // by design, so it must not run to draw a screen.
  const [wanted, setWanted] = useState<ExportKey | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const exportFile = useExportFile(wanted)

  useEffect(() => {
    if (!wanted || !exportFile) return
    // Through the one CSV writer, so the file gets the BOM, the CRLF records
    // and the formula guard without this screen knowing about any of them.
    const columns = exportFile.columns.map((header) => ({
      header,
      value: (row: Record<string, CsvValue>) => row[header],
    }))
    downloadCsv(exportFile.filename, toCsv(columns, exportFile.rows))
    setOutcome(
      `${exportFile.filename} — ${exportFile.rows.length} row${exportFile.rows.length === 1 ? "" : "s"} downloaded.`,
    )
    setWanted(null)
  }, [wanted, exportFile])

  if (me.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <EmptyState
          icon={Lock}
          title="Admin access required"
          description="Admin-only configuration and data management."
        />
      </div>
    )
  }

  const dueFund = (fundsModel ?? []).find(
    (f) => f.collectionMode === "fixed_monthly",
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Admin-only configuration and data management."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
            <CardDescription>
              Community identity. Multi-organisation support arrives in milestone
              M6.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" defaultValue={me.orgName} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Reference</Label>
              <Input id="org-slug" defaultValue={me.orgSlug} readOnly />
            </div>
            <Button size="sm" disabled>
              Save changes
            </Button>
            <p className="text-xs text-muted-foreground">
              Renaming the organisation is milestone M6 work.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Collection rules</CardTitle>
            <CardDescription>
              Which funds carry dues, and which are simply collected
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Monthly dues fund</Label>
              <div className="rounded-md border px-3 py-2 text-sm">
                {dueFund ? (
                  <span className="flex items-center gap-2">
                    <CollectionModeBadge mode={dueFund.collectionMode} />
                    {dueFund.name} · {formatPaise(dueFund.monthlyAmountPaise ?? 0)}
                  </span>
                ) : (
                  "None configured"
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Every fund and how it is collected</Label>
              {fundsModel === undefined ? (
                <ReadModelLoader label="Loading funds" />
              ) : (
                <ul className="space-y-2">
                  {fundsModel.map((fund) => (
                    <li
                      key={fund.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <CollectionModeBadge mode={fund.collectionMode} />
                      <span className="font-medium">{fund.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {COLLECTION_MODE_HINTS[fund.collectionMode]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>What each mode means</Label>
              <ul className="space-y-1.5 pl-5 text-sm text-muted-foreground">
                {(
                  Object.keys(COLLECTION_MODE_LABELS) as Array<
                    keyof typeof COLLECTION_MODE_LABELS
                  >
                ).map((mode) => (
                  <li key={mode}>
                    <span className="font-medium text-foreground">
                      {COLLECTION_MODE_LABELS[mode]}
                    </span>{" "}
                    — {COLLECTION_MODE_HINTS[mode]}
                  </li>
                ))}
                <li>
                  Members joining mid-year are charged from the month they join —
                  dues are prorated, not charged for the full year.
                </li>
                <li>
                  A waiver requires a reason and is recorded in the audit log.
                </li>
                <li>
                  Financial years are locked when closed, so a closed period
                  cannot be edited afterwards. Closing happens on the{" "}
                  <Link to="/reconciliation" className="underline">
                    reconciliation screen
                  </Link>
                  , which will not let a year close while an account has an
                  unexplained difference.
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" />
            Destructive actions
          </CardTitle>
          <CardDescription>
            The legacy build exposed a single endpoint that reset every balance
            to ₹0. It has not been carried over, and nothing like it should
            exist in a product holding community money.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" size="sm" disabled>
            Reset all data
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Intentionally absent. Financial records are corrected by reversing
            entries, never by deletion.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4" />
            Your data
          </CardTitle>
          <CardDescription>
            Download the community's records as CSV. One file at a time — the
            ledger is every entry this community has ever made, and fetching all
            of it to draw a screen is exactly what milestone M2b spent its time
            removing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportFiles === undefined ? (
            <ReadModelLoader label="Loading the file list" />
          ) : (
            <ul className="space-y-2">
              {exportFiles.map((f) => (
                <li
                  key={f.key}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {f.readsBackAs ? (
                        <>
                          Imports back into another organisation as a{" "}
                          <span className="font-medium text-foreground">
                            {f.readsBackAs}
                          </span>{" "}
                          file.
                        </>
                      ) : (
                        <>Not importable — {f.notImportableBecause}.</>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={wanted === f.key}
                    onClick={() => {
                      setOutcome(null)
                      setWanted(f.key)
                    }}
                  >
                    {wanted === f.key ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    CSV
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {outcome ? (
            <p className="text-xs text-muted-foreground">{outcome}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="size-4" />
            Audit log
          </CardTitle>
          <CardDescription>
            Every mutation, with the person who made it. The legacy build wrote
            audit rows that no endpoint could read; this is that screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {auditModel === undefined ? (
            <ReadModelLoader label="Loading the audit log" />
          ) : auditModel.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing recorded yet.
            </p>
          ) : (
            auditModel.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-0"
              >
                <Badge
                  variant="secondary"
                  className="font-mono text-[10px]"
                >
                  {entry.action}
                </Badge>
                <span className="text-muted-foreground">
                  {entry.entityType}
                  {entry.entityId ? ` · ${entry.entityId}` : ""}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.details}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.actorName} · {formatDateTime(entry.createdAt)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
