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
}/**
 * The auth user row behind this session, or throw.
 *
 * Split out from `requireActor` so that the one caller which legitimately has
 * no organisation yet — signup onboarding — can resolve an identity without
 * also having to invent a way around the org check. It deliberately checks
 * nothing but authentication, because that is the only thing both callers agree
 * on; every further condition is applied by the function that owns it, so there
 * is no single place where a new rule could be added and quietly skipped by one
 * of them.
 */
async function resolveUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Not signed in")
  const user = await ctx.db.get(userId)
  if (!user) throw new Error("Not signed in")
  return { userId, user }
}

/**
 * Who the caller is, whether or not they belong to an organisation yet.
 *
 * `null` in `orgId` and `role` means "signed in, no organisation yet" — the
 * state every new signup is in between the form and the onboarding screen. It
 * is a normal state, not an error, and it is the only thing `orgs.mySetup`
 * exists to report. See `convex/orgs.ts`.
 */
export interface Identity {
  userId: Id<"users">
  orgId: Id<"organizations"> | null
  role: Role | null
  fundIds: Id<"funds">[] | null
  name: string
  email: string
  isActive: boolean
}

export async function requireIdentity(
  ctx: QueryCtx | MutationCtx,
): Promise<Identity> {
  const { userId, user } = await resolveUser(ctx)
  const base = {
    userId,
    name: user.name ?? "",
    email: user.email ?? "",
    isActive: user.isActive ?? true,
  }
  // A deactivated account is not a valid identity whether or not it has an org,
  // so this is the one condition checked before the org branch.
  if (user.isActive === false) {
    throw new Error("This account has been deactivated")
  }
  if (!user.orgId || !user.role) {
    return { ...base, orgId: null, role: null, fundIds: null }
  }
  return {
    ...base,
    orgId: user.orgId,
    role: user.role,
    fundIds:
      user.role === "fund_manager"
        ? await fundsForUser(ctx.db, user.orgId, userId)
        : null,
  }
}

/**
 * Resolve the caller, or throw. Throwing (rather than returning null) means a
 * handler cannot forget to handle the unauthenticated case.
 */
export async function requireActor(
  ctx: QueryCtx | MutationCtx,
): Promise<Actor> {
  const { userId, user } = await resolveUser(ctx)

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

/**
 * Anyone signed in, member or not.
 *
 * Deliberately permissive, and used in exactly three places: `data:me` (identity
 * and role, which a member needs in order to know what they are), and the portal
 * read models, which are scoped to the caller's *own* member row and so cannot
 * leak anything by being reachable. It is **not** the gate for the committee
 * console — see `requireConsole`.
 */
export const requireMember = (ctx: QueryCtx | MutationCtx) =>
  requireActor(ctx)

/**
 * The committee console: anyone who may see the books.
 *
 * This is the gate M3 had to add, and it looks redundant until you notice what
 * `requireMember` used to do everywhere. Before member accounts existed, "signed
 * in" and "on the committee" were the same set of people, so every read model in
 * `data.ts`, `aggregate.ts` and `reconciliation.ts` was written against
 * `requireMember`. M3 introduces the `member` role — the first role that is
 * signed in but is *not* on the committee — and those same read models would have
 * handed it the org's total balances, every member's arrears and the audit log.
 * The role would have been a new front door onto data that was never meant to
 * have one.
 *
 * So the console is gated separately from identity, and a member who follows a
 * console link gets a refusal from the server rather than a number they should
 * not have. `bun run check` asserts a member is refused.
 */
export const requireConsole = (ctx: QueryCtx | MutationCtx) =>
  requireRole(ctx, "viewer")

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
