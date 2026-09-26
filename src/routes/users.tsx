import { Lock, UserPlus, Users as UsersIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/stat-card"
import { RoleBadge } from "@/components/shared/status-badge"
import { WithReadModel } from "@/components/shared/read-model"
import { useCurrentUser } from "@/data/store"
import { useDirectory } from "@/data/queries"
import { ROLE_LABELS, type Role } from "@/lib/types"

const CAPABILITIES: Array<{ capability: string; roles: Role[] }> = [
  { capability: "View dashboard and reports", roles: ["admin", "treasurer", "fund_manager", "viewer"] },
  { capability: "Record contributions and payments", roles: ["admin", "treasurer", "fund_manager"] },
  { capability: "Mark paid or waive a contribution", roles: ["admin", "treasurer", "fund_manager"] },
  { capability: "Create transactions", roles: ["admin", "treasurer", "fund_manager"] },
  { capability: "Approve or reject transactions", roles: ["admin", "treasurer"] },
  { capability: "Reconcile a bank account", roles: ["admin", "treasurer"] },
  { capability: "Create and edit funds and banks", roles: ["admin", "treasurer"] },
  { capability: "Manage members", roles: ["admin", "treasurer"] },
  { capability: "Manage users and invites", roles: ["admin"] },
  { capability: "Settings and fiscal-year close", roles: ["admin"] },
  { capability: "View the audit log", roles: ["admin"] },
]

const ALL_ROLES: Role[] = ["admin", "treasurer", "fund_manager", "viewer"]

export default function Users() {
  const me = useCurrentUser()
  const model = useDirectory()
  const isAdmin = me.role === "admin"

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Users" />
        <EmptyState
          icon={Lock}
          title="Admin access required"
          description="Only an admin can manage users and roles."
        />
      </div>
    )
  }

  return (
    <WithReadModel data={model} label="Loading users">
      {(users) => (
        <div className="space-y-6">
          <PageHeader
            title="Users"
            description="Who can see and change the books."
          >
            <Button size="sm" disabled title="Available in milestone M2">
              <UserPlus className="size-4" /> Add user
            </Button>
          </PageHeader>

          <Card>
            <CardHeader>
              <CardTitle>Current users</CardTitle>
              <CardDescription>
                {users.filter((u) => u.isActive).length} active of{" "}
                {users.length} accounts
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.name}
                        {user.id === me.id ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={user.role} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.isActive ? "Active" : "Deactivated"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
          <CardDescription>
            Enforced server-side from milestone M1. A `fund_manager` is scoped to
            the funds assigned to them, and no one can approve a transaction they
            requested.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                {ALL_ROLES.map((role) => (
                  <TableHead key={role} className="text-center">
                    {ROLE_LABELS[role]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CAPABILITIES.map((row) => (
                <TableRow key={row.capability}>
                  <TableCell>{row.capability}</TableCell>
                  {ALL_ROLES.map((role) => (
                    <TableCell key={role} className="text-center">
                      {row.roles.includes(role) ? (
                        <span className="text-chart-3">●</span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <UsersIcon className="size-3.5" />
        Members are not users. They can see their own dues and pay online in
        milestone M3.
      </p>
        </div>
      )}
    </WithReadModel>
  )
}
