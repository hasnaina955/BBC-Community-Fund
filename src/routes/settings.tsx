import { Lock, Settings as SettingsIcon, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { useData } from "@/data/store"
import { formatDateTime, rupeesToPaise } from "@/lib/format"

export default function Settings() {
  const data = useData()
  const isAdmin = data.currentUser.role === "admin"
  const contributionFund = data.funds.find((f) => f.isMemberContribution)

  if (!isAdmin) {
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
              Community identity. Multi-organisation support arrives in
              milestone M6.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" defaultValue="Jamaat Anjuman" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-city">City</Label>
              <Input id="org-city" defaultValue="Mumbai" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-fy">Financial year start</Label>
              <Input id="org-fy" defaultValue="January" />
            </div>
            <Button size="sm" disabled>
              Save changes
            </Button>
            <p className="text-xs text-muted-foreground">
              Settings persistence arrives with the backend in milestone M1.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Collection rules</CardTitle>
            <CardDescription>
              How monthly contributions are derived for members
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Contribution fund</Label>
              <div className="rounded-md border px-3 py-2 text-sm">
                {contributionFund?.name ?? "None configured"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly">Default monthly amount (₹)</Label>
              <Input
                id="monthly"
                inputMode="numeric"
                defaultValue={String((contributionFund?.monthlyPaise ?? 0) / 100)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due-day">Due day of month</Label>
              <Input id="due-day" inputMode="numeric" defaultValue="10" />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Practical rules</Label>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>
                  Members joining mid-year are charged from the month they join —
                  dues are prorated, not charged for the full year.
                </li>
                <li>
                  A waiver requires a reason and is recorded in the audit log.
                </li>
                <li>
                  Financial years are locked when closed, so a closed period
                  cannot be edited afterwards.
                </li>
              </ul>
            </div>
            <Button size="sm" disabled>
              Save changes
            </Button>
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
            <SettingsIcon className="size-4" />
            Audit log
          </CardTitle>
          <CardDescription>
            The legacy build wrote audit rows that no endpoint could read. This
            is that screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.auditLog.map((entry) => {
            const actor = data.users.find((u) => u.id === entry.userId)
            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-0"
              >
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {entry.action}
                </Badge>
                <span className="text-muted-foreground">
                  {entry.entityType}
                  {entry.entityId ? ` · ${entry.entityId}` : ""}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.details}</span>
                <span className="text-xs text-muted-foreground">
                  {actor?.name ?? "system"} · {formatDateTime(entry.createdAt)}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

// Referenced to keep the paise helper imported for the monthly field above,
// which will convert user input to paise once the backend exists.
void rupeesToPaise
