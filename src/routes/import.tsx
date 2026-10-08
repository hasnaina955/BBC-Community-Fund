import { useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Lock,
  Upload,
} from "lucide-react"
import { api } from "../../convex/_generated/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { ReadModelLoader } from "@/components/shared/read-model"
import { useCurrentUser } from "@/data/store"
import { downloadCsv, toCsv } from "@/lib/csv"

/**
 * Importing a community's existing books.
 *
 * ## Two steps, and the order is the safety property
 *
 * Choose a file, then **preview** it, then commit. The preview runs on the
 * server as a *query* — it writes nothing — and it is the same parser the
 * commit uses, so what the preview says is what the commit will do. The import
 * button does not exist until the preview comes back clean.
 *
 * That is the whole design. An import writes to an append-only ledger, and the
 * only way to undo a mistake in one is a reversing entry that somebody has to
 * find later. So a treasurer is never one click away from a half-imported book:
 * they see every problem in the file, by row, before anything moves.
 *
 * ## The bytes go up, the parsing happens on the server
 *
 * Parsing does not happen in the browser, because two parsers drift and the one
 * that drifts is the one nobody tested. `convex/lib/importcsv.ts` is the only
 * implementation, and the preview runs it for real.
 */

const MAX_PREVIEW_ROWS = 200

type RunResult = Awaited<
  ReturnType<NonNullable<(typeof api.imports.runImport)["_fn"]>>
>
type Issue = { row: number; field: string; message: string }

const KIND_LABEL: Record<string, string> = {
  members: "Membership list",
  contributions: "Contribution grid",
  payments: "Payments received",
  ledger: "Ledger entries",
}

const KIND_BLURB: Record<string, string> = {
  members:
    "Who your members are. Only a name is required — a spreadsheet with no email column is the case this is for. It adds people and never edits one, and anybody already on the roster is skipped by name, so importing the same list twice changes nothing.",
  contributions:
    "A row per member per month — what they were charged and whether they paid. Paid months are imported by replaying a payment for each, oldest first, exactly as entering them by hand would.",
  payments:
    "A row per payment received. Each becomes a receipt and a ledger entry, and settles that member's oldest unpaid months.",
  ledger:
    "Opening balances and other movements. Use it for money that was already in the bank before this system existed, and for spending.",
}

/** A key for a file's *contents*, so importing the same file twice is a no-op. */
async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }
  // A fallback for an origin without SubtleCrypto. It only has to be stable and
  // different for different files, not cryptographically strong.
  let h = 2166136261
  for (const b of bytes) h = Math.imul(h ^ b, 16777619)
  return `fnv${(h >>> 0).toString(16)}`
}

export default function ImportData() {
  const me = useCurrentUser()
  const columns = useQuery(api.imports.templateColumns, {})

  const [fileName, setFileName] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [batchKey, setBatchKey] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const runImport = useMutation(api.imports.runImport)

  // The preview re-runs by itself whenever the file changes, so choosing a file
  // is the only thing this screen has to do to start one.
  const previewArgs = useMemo(() => (text === null ? "skip" : { text }), [text])
  const preview = useQuery(api.imports.previewImport, previewArgs)

  const canWrite = me.role === "admin" || me.role === "treasurer"

  const readFile = async (file: File) => {
    setFileName(file.name)
    setResult(null)
    try {
      const body = await file.text()
      setBatchKey(await hashText(body))
      setText(body)
    } catch {
      setFileName(null)
      setText(null)
      setBatchKey(null)
    }
  }

  const issues: Issue[] = preview?.issues ?? []
  const shown = issues.slice(0, MAX_PREVIEW_ROWS)
  const hidden = issues.length - shown.length

  const downloadTemplate = (
    kind: "members" | "contributions" | "payments" | "ledger",
  ) => {
    if (!columns) return
    const spec = columns[kind]
    const sample: Record<string, string | number> = {
      // Membership columns. `joined_year`/`joined_month` are the ones the
      // grid and the app use; `joined` is the date column a spreadsheet
      // usually has, and either spelling is accepted.
      name: "Ayesha Khan",
      email: "ayesha@example.org",
      phone: "+91 98765 43210",
      relation: "Sister",
      joined_year: 2019,
      joined_month: 3,
      joined: "",
      member: kind === "ledger" ? "Imran Shaikh" : "Ayesha Khan",
      fund: "Monthly subscription",
      bank: kind === "payments" ? "HDFC Bank" : "",
      year: 2024,
      month: 3,
      amount: kind === "ledger" ? 12500 : 150,
      status: "paid",
      paid_at: "09/03/2024",
      date: "01/04/2019",
      method: "cash",
      receipt: "",
      reference: "",
      category: "other",
      note: "",
    }
    const all = [...spec.required, ...spec.optional]
    downloadCsv(
      `${kind}-template.csv`,
      toCsv(
        all.map((c) => ({ header: c, value: (r: typeof sample) => r[c] ?? "" })),
        [sample],
      ),
    )
  }

  const commit = async () => {
    if (!text || !batchKey || !preview?.ok) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await runImport({ text, batchKey }))
    } catch (err) {
      // A closed year or a full payment is refused by the writer mid-file. The
      // mutation is transactional, so nothing was written — say that rather
      // than leaving the treasurer thinking half of it landed.
      setResult({
        ok: false,
        imported: 0,
        issues: [
          {
            row: 0,
            field: "import",
            message:
              err instanceof Error
                ? err.message
                : "The import failed and nothing was written.",
          },
        ],
        warnings: [],
        receiptRange: null,
      } as RunResult)
    } finally {
      setBusy(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="space-y-6">
        <PageHeader title="Import" />
        <EmptyState
          icon={Lock}
          title="Treasurer access required"
          description="Importing writes to the ledger, so it is limited to treasurers and administrators."
        />
      </div>
    )
  }

  const totalToImport = preview?.ok
    ? Object.values(preview.summary ?? {}).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import"
        description="Bring a community's existing books in from a spreadsheet."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4" />
            Choose a file
          </CardTitle>
          <CardDescription>
            A CSV export from your spreadsheet. Nothing reaches the books until
            you have read the preview.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void readFile(file)
            }}
            htmlFor="import-file"
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors ${
              dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40"
            }`}
          >
            <Upload className="size-5 text-muted-foreground" />
            {fileName ? (
              <span className="font-medium">{fileName}</span>
            ) : (
              <span className="text-muted-foreground">
                Drop a CSV here, or choose a file
              </span>
            )}
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </label>

          {columns === undefined ? (
            <ReadModelLoader label="Loading the column reference" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(["members", "contributions", "payments", "ledger"] as const).map((kind) => (
                <div key={kind} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{KIND_LABEL[kind]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {KIND_BLURB[kind]}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">Required:</span>{" "}
                    {columns[kind].required.join(", ")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">Optional:</span>{" "}
                    {columns[kind].optional.join(", ")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => downloadTemplate(kind)}
                  >
                    <Download className="size-3.5" /> Example
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Dates</span> may be
              written as 2024-03-09, 09/03/2024 (day first) or "9 Mar 2024".
            </li>
            <li>
              <span className="font-medium text-foreground">Amounts</span> are
              rupees — 150 or 1,500.50. A rupee is 100 paise and nothing smaller
              is ever stored, so a third decimal place is refused rather than
              quietly rounded.
            </li>
            <li>
              <span className="font-medium text-foreground">Members</span> are
              matched by email first, then by phone, then by name. Two rows that
              nothing can tell apart are refused; a row that matches somebody
              already on the roster is skipped and named in the report below.
            </li>
            <li>
              A <span className="font-medium text-foreground">membership list</span>{" "}
              only ever adds people. It never edits an existing member — a
              correction is made on the Members screen.
            </li>
            <li>
              Every problem in the file is reported at once, by row, and{" "}
              <span className="font-medium text-foreground">
                nothing is written unless the file is completely clean
              </span>
              .
            </li>
            <li>
              Importing the same file twice is safe and does nothing the second
              time.
            </li>
          </ul>
        </CardContent>
      </Card>

      {result ? (
        <Card className={result.ok ? "border-chart-3/40" : "border-destructive/40"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.ok ? (
                <CheckCircle2 className="size-4 text-chart-3" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              {result.ok ? "Imported" : "Not imported"}
            </CardTitle>
            <CardDescription>
              {result.ok
                ? `${result.imported} record${result.imported === 1 ? "" : "s"} written.`
                : "Nothing was written. Fix the file and try again."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.ok ? (
              <div className="flex flex-wrap gap-2 text-sm">
                {"members" in result && result.members > 0 ? (
                  <Badge variant="secondary">{result.members} members</Badge>
                ) : null}
                {"contributions" in result && result.contributions > 0 ? (
                  <Badge variant="secondary">
                    {result.contributions} contributions
                  </Badge>
                ) : null}
                {"payments" in result && result.payments > 0 ? (
                  <Badge variant="secondary">{result.payments} payments</Badge>
                ) : null}
                {result.receiptRange ? (
                  <Badge variant="secondary">
                    receipts {result.receiptRange}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            {result.warnings.length > 0 ? (
              <div className="space-y-1.5">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {w}
                  </p>
                ))}
              </div>
            ) : null}

            {result.issues.length > 0 ? <IssueList issues={result.issues} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {preview && text !== null && !result ? (
        <Card
          className={preview.ok ? "border-chart-3/40" : "border-destructive/40"}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {preview.ok ? (
                <CheckCircle2 className="size-4 text-chart-3" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              {preview.ok ? "Ready to import" : "This file cannot be imported"}
            </CardTitle>
            <CardDescription>
              {preview.kind
                ? `Recognised as ${(KIND_LABEL[preview.kind] ?? preview.kind).toLowerCase()} — ${preview.totalRows} row${preview.totalRows === 1 ? "" : "s"}.`
                : "The columns could not be recognised."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.warnings.length > 0 ? (
              <div className="space-y-1.5">
                {preview.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {w}
                  </p>
                ))}
              </div>
            ) : null}

            {issues.length > 0 ? (
              <IssueList issues={shown} hidden={hidden} />
            ) : null}

            {preview.ok ? (
              <Button onClick={() => void commit()} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    <Upload className="size-4" /> Import {totalToImport} record
                    {totalToImport === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                The import button stays unavailable until every problem above is
                fixed. That is deliberate — a ledger cannot be un-imported.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function IssueList({ issues, hidden = 0 }: { issues: Issue[]; hidden?: number }) {
  return (
    <div className="space-y-2">
      <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
        {issues.map((issue, i) => (
          <li key={i} className="flex gap-2">
            <span className="tabular w-14 shrink-0 text-right text-muted-foreground">
              {issue.row > 0 ? `row ${issue.row}` : ""}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-foreground">{issue.field}</span>{" "}
              <span className="text-destructive">{issue.message}</span>
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          and {hidden} more — all of them are reported together, not one at a
          time.
        </p>
      ) : null}
    </div>
  )
}
