import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { useMutation } from "convex/react"
import { AlertCircle, Building2, Loader2 } from "lucide-react"
import { api } from "../../convex/_generated/api"
import { useStore } from "@/data/store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Onboarding: turn a bare account into a community.
 *
 * ## Why this screen exists at all
 *
 * `orgs.createOrganization` is one mutation and could have been a prompt. It
 * is a screen because of what happens *after* it. A community that has just
 * signed up and lands on an empty console has a sidebar of nine destinations,
 * a dashboard full of zeroes and no idea what any of it means. The first bank
 * account and the first fund are asked for here — both optional — because those
 * are the two rows every other screen depends on, and a community that has
 * filled them in on the way past is a community that will recognise the rest of
 * the product.
 *
 * They are genuinely optional. A community that collects donations only has no
 * monthly amount and no account number yet, and being *forced* to invent a bank
 * account to get into their own ledger is a worse product than an empty field.
 *
 * ## The slug is not asked for
 *
 * The organisation's URL identifier is derived from its name on the server
 * (`slugify` in `convex/orgs.ts`) and de-duplicated there. A person naming
 * their own community is not thinking about character sets, and two communities
 * called "Jamaat Anjuman" in different cities both get a working identifier
 * without either being asked to invent one.
 *
 * ## If you already belong to an organisation
 *
 * You cannot get here — `ConsoleGate` and `PortalGate` send anyone with an org
 * to their dashboard, and the server refuses a second call anyway. But the
 * store's `me` is read here rather than through `useCurrentUser`, because that
 * hook is narrowed to callers who have an organisation, which by definition
 * does not include the person this screen is for.
 */
export default function Welcome() {
  const navigate = useNavigate()
  const { me } = useStore()
  const createOrg = useMutation(api.orgs.createOrganization)

  const [name, setName] = useState(
    () => sessionStorage.getItem("cf.pendingOrgName") ?? me?.name ?? "",
  )
  const [bankName, setBankName] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [ifsc, setIfsc] = useState("")
  const [fundName, setFundName] = useState("")
  const [monthly, setMonthly] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Already set up — either they followed a link to here by mistake, or they
  // arrived back after `createOrganization` succeeded but before the reactive
  // `data:me` had pushed the new organisation. Without this, that second case
  // strands them on a form for a community they already have, and submitting
  // it again is refused by the server with "You already belong to an
  // organisation" — a correct refusal that reads as a broken app.
  if (me?.orgId) return <Navigate to="/" replace />

  // Typed here once and consumed by both the org name and the account's own
  // name, rather than in a `useEffect`. The name is the one thing people get
  // wrong most often, and retyping it is the most common reason a community
  // ends up with two slightly different names for itself.
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const monthlyRupees = monthly.trim() === "" ? undefined : Number(monthly)
      if (monthlyRupees !== undefined && !Number.isFinite(monthlyRupees)) {
        throw new Error("Enter the monthly amount as a number, or leave it blank")
      }
      await createOrg({
        name: name.trim(),
        bankName: bankName.trim() || undefined,
        accountNumber: accountNumber.trim() || undefined,
        ifscCode: ifsc.trim() || undefined,
        fundName: fundName.trim() || undefined,
        monthlyRupees,
      })
      sessionStorage.removeItem("cf.pendingOrgName")
      navigate("/", { replace: true })
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not create that organisation. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cf-grid-bg flex min-h-screen items-start justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            CF
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Set up your community
            </h1>
            <p className="text-sm text-muted-foreground">
              {me?.email
                ? `Signed in as ${me.email}. One more step.`
                : "One more step."}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your organisation</CardTitle>
            <CardDescription>
              You will be its first administrator, and can add a treasurer and
              members afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="org-name">Organisation name</Label>
                <Input
                  id="org-name"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Andheri Jamaat"
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium">
                    First bank account
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      optional
                    </span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Where members are told to send money. You can add more later.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bank-name">Bank name</Label>
                  <Input
                    id="bank-name"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="HDFC Bank"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="account-number">Account number</Label>
                    <Input
                      id="account-number"
                      inputMode="numeric"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="00012345678"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ifsc">IFSC</Label>
                    <Input
                      id="ifsc"
                      value={ifsc}
                      onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                      placeholder="HDFC0001234"
                      className="uppercase"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium">
                    First fund
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      optional
                    </span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    A recurring collection is what makes arrears work. Leave the
                    monthly amount blank for a donation-only fund.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fund-name">Fund name</Label>
                  <Input
                    id="fund-name"
                    value={fundName}
                    onChange={(e) => setFundName(e.target.value)}
                    placeholder="Monthly subscription"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="monthly">
                    Monthly amount per member (₹)
                  </Label>
                  <Input
                    id="monthly"
                    inputMode="decimal"
                    value={monthly}
                    onChange={(e) => setMonthly(e.target.value)}
                    placeholder="100"
                  />
                </div>
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
                    <Loader2 className="size-4 animate-spin" /> Setting things
                    up…
                  </>
                ) : (
                  <>
                    <Building2 className="size-4" /> Create organisation
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
