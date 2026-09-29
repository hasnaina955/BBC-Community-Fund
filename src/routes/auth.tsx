import { useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useConvexAuth, useAuthActions } from "@convex-dev/auth/react"
import { AlertCircle, Loader2, Lock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Sign in.
 *
 * Email is lowercased and trimmed before it is sent, because the auth provider
 * matches accounts on the exact string. See convex/auth.ts.
 *
 * ## Where sign-in lands
 *
 * `RequireAuth` in `App.tsx` sends a signed-out visitor to
 * `/auth?returnTo=<the page they asked for>`. This page used to ignore that and
 * always navigate to `/`, which quietly broke every deep link in the app — a
 * treasurer sent to a member's statement by a treasurer, or a member tapping a
 * WhatsApp link to their own passbook, would sign in and land somewhere else
 * with no explanation. So the parameter is honoured here.
 *
 * It is validated before use. `returnTo` is attacker-controllable — anyone can
 * put a link in a WhatsApp message — so only same-origin *paths* are accepted.
 * `//evil.example` and `https://evil.example` are both rejected, because
 * `navigate("//evil.example")` is treated as a protocol-relative URL and would
 * otherwise turn the sign-in form into an open redirect that harvests passwords.
 */
export default function Auth() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn } = useAuthActions()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const returnTo = (() => {
    const raw = params.get("returnTo")
    if (!raw) return "/"
    // Must start with a single "/" and not "//": a path, never a host.
    if (!raw.startsWith("/") || raw.startsWith("//")) return "/"
    return raw
  })()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (isLoading) return null
  if (isAuthenticated) return <Navigate to={returnTo} replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn("password", {
        flow: "signIn",
        email: email.trim().toLowerCase(),
        password,
      })
      navigate(returnTo, { replace: true })
    } catch (err) {
      // Deliberately vague: telling the user which half was wrong would
      // confirm whether an account exists.
      setError(
        err instanceof Error && err.message.includes("InvalidSecret")
          ? "That email and password do not match."
          : "Could not sign in. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cf-grid-bg flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            CF
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              CommunityFund
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to the fund console
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription>
              Use the treasurer account for this community.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="treasurer@jamaat.org"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {error ? (
                <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  <>
                    <Lock className="size-4" /> Sign in
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Setting up a new community?{" "}
          <Link
            to="/signup"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>

        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Demo accounts</p>
          <p className="mt-1">
            With the demo deployment seeded, every account uses
          </p>
          <p className="tabular mt-1 font-medium text-foreground">
            community123
          </p>
          <ul className="mt-2 space-y-0.5">
            <li>secretary@jamaat.org — admin</li>
            <li>treasurer@jamaat.org — treasurer</li>
            <li>farhan@jamaat.org — viewer</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
