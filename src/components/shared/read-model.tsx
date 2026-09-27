import type { ReactNode } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/**
 * The loading state every screen now has to handle.
 *
 * With aggregation server-side each screen subscribes to its own read model, so
 * a screen can legitimately be waiting on data that the shell has already
 * resolved. Previously the store loaded everything up front and screens could
 * assume data was there; now they cannot, and pretending otherwise is how you
 * ship an `undefined.length` crash to the treasurer at the monthly meeting.
 *
 * Errors are handled by `ErrorBoundary` in the app shell, which catches the
 * rethrow from `useQuery` and renders in place of the screen. What is here is
 * only the loading half.
 *
 * ## The `animate-spin` is load-bearing
 *
 * The spinner must keep its `animate-spin` class. Both visual harnesses wait for
 * a screen to settle by polling `main.querySelector(".animate-spin") === null`,
 * so a loader that stopped animating would read as "loaded" the instant it
 * appeared, and every assertion after it would race the data. It was tempting to
 * replace this with a static skeleton; the skeleton is here *around* the spinner
 * instead, and the reason is written down so the next person does not "tidy" it
 * away.
 */
export function ReadModelLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      {/* Skeleton of the shape most screens take: a heading, a row of tiles,
          then a wide block. It gives the page its geometry back a beat before
          the numbers arrive, so the layout does not jump twice. */}
      <div aria-hidden className="w-full max-w-4xl space-y-4">
        <div className="cf-skeleton h-7 w-52" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="cf-skeleton h-20" />
          <div className="cf-skeleton h-20" />
          <div className="cf-skeleton h-20" />
          <div className="cf-skeleton h-20" />
        </div>
        <div className="cf-skeleton h-56" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}…
      </div>
    </div>
  )
}

export function ReadModelError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium">Could not load this view</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Renders `children` once the read model has arrived, and a loader until then.
 * Screens call this once, at the top, so none of them repeats the check.
 */
export function WithReadModel<T>({
  data,
  label,
  children,
}: {
  data: T | undefined
  label: string
  children: (data: T) => ReactNode
}) {
  if (data === undefined) return <ReadModelLoader label={label} />
  return <>{children(data)}</>
}
