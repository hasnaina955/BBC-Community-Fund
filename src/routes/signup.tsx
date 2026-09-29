import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useConvexAuth, useAuthActions } from "@convex-dev/auth/react"
import { AlertCircle, Loader2, UserPlus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Create an account.
 *
 * This page creates an *identity*, not a community. That is the whole design
 * and it is worth being explicit about, because the two are easy to conflate
 * and the conflation is where multi-tenancy bugs come from.
 *
 * The auth provider owns the `users` row and writes it with no `orgId` and no
 * `role`, because at this instant there is no organisation to point at and no
 * committee to be on. That is the only moment in the system where a `users` row
 * exists without both, and it is why `requireActor` refuses such an account
 * with "No organisation is linked to this account" — a refusal that is correct
 * and, on its own, would have looked like a broken signup.
 *
 * So signup navigates to `/welcome`, which creates the organisation and makes
 * this person its first administrator. The server is what enforces the
 * sequence: `orgs.createOrganization` refuses a caller who already has an
 * organisation, so there is no way to skip the second step, and no way to
 * create a second organisation from an account that already has one.
 *
 * ## Email is lowercased and trimmed
 *
 * The auth provider matches accounts on the exact string, so the same
 * normalisation the sign-in form does has to happen here. See `convex/auth.ts`.
 */
export default function Signup() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn } = useAuthActions()
  const navigate = useNavigate()

  const [name, setName] = useState("")
  const [community, setCommunity] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Already signed in — and possibly with no organisation, which is exactly
  // where a half-finished signup left off. `/welcome` decides which.
  if (isLoading) return null
  if (isAuthenticated) return <Navigate to="/welcome" replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // The Password provider has one client entry point; `flow` selects the
      // behaviour. See `convex/auth.ts` — the `profile` hook there is what
      // actually stores the name, since the auth library writes the `users` row
      // before any of our code runs.
      await signIn("password", {
        flow: "signUp",
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
      })
      // The community name is carried across rather than typed twice. It is not
      // sent to the server here — the account has no organisation yet, and the
      // only thing that creates one is `orgs.createOrganization`.
      sessionStorage.setItem("cf.pendingOrgName", community.trim())
      navigate("/welcome", { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // The provider does not distinguish "this email is taken" from anything
      // else, and neither should this: an open signup form that confirms which
      // addresses have accounts is an account-enumeration oracle.
      setError(
        /already exists|already registered|Unique/i.test(message)
          ? "That email address cannot be used for a new account. Try signing in instead."
          : message.includes("Password must be")
            ? "Choose a password of at least 8 characters."
            : "Could not create that account. Please try again.",
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
              Set up a community's fund management
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create your account</CardTitle>
            <CardDescription>
              You will name your community on the next screen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ayesha Khan"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="community">Community or organisation</Label>
                <Input
                  id="community"
                  required
                  minLength={2}
                  value={community}
                  onChange={(e) => setCommunity(e.target.value)}
                  placeholder="Andheri Jamaat"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="treasurer@yourcommunity.org"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Creating your
                    account…
                  </>
                ) : (
                  <>
                    <UserPlus className="size-4" /> Create account
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/auth"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
