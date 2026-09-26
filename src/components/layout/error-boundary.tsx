import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertCircle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Catches a failed screen read model and renders it in place of the screen.
 *
 * Convex's `useQuery` rethrows a server error rather than returning it, so a
 * query that fails mid-session would otherwise unmount the whole console — the
 * sidebar, the header, the route. The failure is almost always local: a fund id
 * that no longer resolves, a year with no data, a transient network blip. The
 * right response is to say so on the screen and offer a retry, which is what
 * this does.
 *
 * The two always-on shell queries cannot be protected this way — they run above
 * any boundary — so `data/store.tsx` uses `useQueries`, which returns errors
 * instead of throwing, and `AuthGate` paints them.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen failed to load:", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">This screen could not load</p>
              <p className="text-sm text-muted-foreground">{error.message}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ error: null })}
          >
            <RotateCcw className="size-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    )
  }
}
