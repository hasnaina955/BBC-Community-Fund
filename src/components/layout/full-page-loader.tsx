import { Loader2 } from "lucide-react"

/** Full-page loading state, shared by the auth gate and the router. */
export function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="cf-grid-bg flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}…</p>
    </div>
  )
}
