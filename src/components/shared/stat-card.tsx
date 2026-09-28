import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  testId,
  paise,
}: {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: "default" | "positive" | "negative" | "warning"
  testId?: string
  /**
   * The unformatted amount, for the verification suite.
   *
   * A formatted figure on its own cannot be checked against anything: parsing
   * `₹1,23,456` back out of the DOM and hoping the grouping matches is the
   * assertion re-deriving the formatter under test. The server's own number is
   * published here so a check can compare against it directly.
   */
  paise?: number
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-chart-3",
    negative: "text-destructive",
    warning: "text-chart-4",
  }[tone]

  return (
    <Card data-testid={testId} data-paise={paise}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className={cn("tabular text-2xl font-semibold", toneClass)}>
              {value}
            </p>
            {hint ? (
              <p className="truncate text-xs text-muted-foreground">{hint}</p>
            ) : null}
          </div>
          {Icon ? (
            <div className="rounded-lg bg-accent p-2 text-accent-foreground">
              <Icon className="size-4" />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      {Icon ? (
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
