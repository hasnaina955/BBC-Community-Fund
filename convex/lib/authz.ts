import type { MutationCtx, QueryCtx } from "../_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"
import type { DataModel, Id } from "../_generated/dataModel"

type UserDoc = DataModel["users"]["document"]

export type Role = NonNullable<UserDoc["role"]>

/**
 * Authorization is a gate, not a check inside handlers.
 *
 * Every public function starts by calling one of these helpers. That is the
 * only way org isolation is guaranteed: there is no "remember to add WHERE
 * orgId" convention to forget. See docs/ARCHITECTURE.md -> Authorization.
 */

export interface Actor {
  userId: Id<"users">
  orgId: Id<"organizations">
  role: Role
  /** Funds a `fund_manager` is scoped to. Undefined means "all funds". */
  fundIds: Id<"funds">[] | undefined
}

/** Roles in descending order of privilege. */
const RANK: Record<Role, number> = {
  admin: 4,
  treasurer: 3,
  fund_manager: 2,
  viewer: 1,
  member: 0,
}

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum]
}

function fundsForUser(
  db: QueryCtx["db"] | MutationCtx["db"],
  orgId: Id<"organizations">,
  userId: Id<"users">,
): Promise<Id<"funds">[]> {
  return db
    .query("funds")
    .withIndex("by_org_manager", (q) =>
      q.eq("orgId", orgId).eq("managerId", userId),
    )
    .collect()
    .then((funds) => funds.map((f) => f._id))
}

/**
 * Resolve the caller, or throw. Throwing (rather than returning null) means a
 * handler cannot forget to handle the unauthenticated case.
 */
export async function requireActor(
  ctx: QueryCtx | MutationCtx,
): Promise<Actor> {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Not signed in")

  const user = await ctx.db.get(userId)
  if (!user) throw new Error("Not signed in")

  // A user row exists before it is attached to an organisation (the seeder
  // and signup create the identity first). Such a user has access to nothing.
  if (!user.orgId) throw new Error("No organisation is linked to this account")
  if (user.isActive === false) throw new Error("This account has been deactivated")
  if (!user.role) throw new Error("This account has no role assigned")

  const fundIds =
    user.role === "fund_manager"
      ? await fundsForUser(ctx.db, user.orgId, userId)
      : undefined

  return { userId, orgId: user.orgId, role: user.role, fundIds }
}

/** Require a minimum role, then return the actor. */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  minimum: Role,
): Promise<Actor> {
  const actor = await requireActor(ctx)
  if (!atLeast(actor.role, minimum)) {
    throw new Error(`${minimum} access required`)
  }
  return actor
}

export const requireAdmin = (ctx: QueryCtx | MutationCtx) =>
  requireRole(ctx, "admin")

export const requireTreasurer = (ctx: QueryCtx | MutationCtx) =>
  requireRole(ctx, "treasurer")

/** Anyone who can see the books, including members viewing their own dues. */
export const requireMember = (ctx: QueryCtx | MutationCtx) =>
  requireActor(ctx)

/**
 * True when the actor may write to this fund. Admins, treasurers and viewers'
 * counterparts (members) are handled separately by callers; a fund_manager is
 * scoped to the funds assigned to them.
 */
export function canWriteFund(actor: Actor, fundId: Id<"funds"> | undefined): boolean {
  if (actor.role === "admin" || actor.role === "treasurer") return true
  if (actor.role !== "fund_manager") return false
  return fundId !== undefined && (actor.fundIds ?? []).includes(fundId)
}

/** Throw unless the actor may write to this fund. */
export function assertCanWriteFund(
  actor: Actor,
  fundId: Id<"funds"> | undefined,
): void {
  if (!canWriteFund(actor, fundId)) {
    throw new Error("You are not assigned to this fund")
  }
}

/**
 * Separation of duties: a requester may not approve their own transaction.
 * The legacy schema had `requestedBy` and `approvedBy` but never enforced it.
 */
export function assertNotSelfApproval(
  requestedBy: Id<"users">,
  approver: Id<"users">,
): void {
  if (requestedBy === approver) {
    throw new Error("You cannot approve a transaction you requested")
  }
}
